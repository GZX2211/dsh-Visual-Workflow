// src/host/experience/service.ts
//
// Experience 域的组合根：把主体解析、初始化状态、校验、投影、嵌入、判重与持久化端口串成
// 模型可调用的四个动作（初始化取 Prompt / 提交候选 / 召回 / 编辑与归档）。
//
// 事务边界是硬约束：向量必须在**写事务之外**算完（可能走远程 HTTP 或首次加载本地模型），
// 判重与写入由持久化端口在同一笔事务内完成；因此本类的嵌入调用一律发生在调用端口写入之前，
// 且每个候选的两个文本合成一次批量嵌入（不逐条候选发请求）。
//
// 嵌入能力退化（端口处于 bm25 或调用失败）时写入直接拒绝：V1 的去重门槛是语义相似度，
// 没有向量就无法执行该门槛，绕过它写入会把重复经验堆进库里且事后无法分辨。
import { dotProduct } from "../embedding/engine.js";
import { WfError, messageOf } from "../orchestrator/errors.js";
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE, ERR_EXPERIENCE_NOT_FOUND, ERR_EXPERIENCE_NOT_INITIALIZED, ERR_EXPERIENCE_RECALL_FAILED, } from "../shared/protocol.js";
import { DUPLICATE_SIMILARITY_THRESHOLD, NEUTRAL_STATS } from "./constants.js";
import { ExperienceExecutionState } from "./execution-state.js";
import { submitExperienceFeedback, } from "./feedback.js";
import { buildRecallSummary, buildRetrievalProjection } from "./projection.js";
import { rebuildExperienceStats } from "./rebuild.js";
import { normalizeTopK, recallActiveHits } from "./retrieval.js";
import { rankRecallCandidates } from "./retrieval-ranking.js";
import { resolveExperienceSubject } from "./subject.js";
import { renderTeamExperienceContext } from "./team-context.js";
import { validateExperienceCandidates, validateExperiencePatch } from "./validation.js";
/** 命中与磁盘条目配对（未被读到的命中直接丢弃：召回面只暴露仍然活跃的经验）。 */
function pairScoredEntries(scored, entries) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const pairs = [];
    for (const hit of scored) {
        const entry = byId.get(hit.id);
        if (entry)
            pairs.push({ entry, score: hit.score });
    }
    return pairs;
}
/**
 * 判重判据（同类型 + 活跃由持久化端口保证，本闭包只看决策向量）。
 * 为什么只用决策侧向量：经验是否重复取决于「学到的是不是同一条决策原则」；任务类型、证据与
 * 来源运行都会因项目不同而变化，拿它们参与比较会让同一经验反复入库。
 */
function createDuplicateJudge() {
    return (candidate, existing) => {
        const similarity = dotProduct(candidate.decisionEmbedding, existing.decisionEmbedding);
        if (similarity < DUPLICATE_SIMILARITY_THRESHOLD)
            return { duplicate: false };
        return {
            duplicate: true,
            reason: `与已有经验 ${existing.id} 的决策向量相似度 ${similarity.toFixed(3)} ≥ ${DUPLICATE_SIMILARITY_THRESHOLD}，判定为近似重复，未新增；`
                + "如需保留差异，请改写 decision_domain / principle / recommended_action 后重新提交。",
        };
    };
}
export class ExperienceService {
    deps;
    state;
    constructor(deps) {
        this.deps = deps;
        this.state = new ExperienceExecutionState({ now: deps.now });
    }
    /** 取当前主体该类型的生效生成 Prompt，并记录初始化态（重复调用幂等）。 */
    async initializePrompt(input) {
        const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime });
        const prompt = await this.requireActivePrompt(input.type);
        this.state.markInitialized({
            sessionId: subject.sessionId,
            subjectId: subject.subjectId,
            experienceType: input.type,
            generationPromptId: prompt.id,
            generationPromptVersion: prompt.promptVersion,
        });
        return { prompt };
    }
    /** 提交候选：校验 → 投影 → 事务外批量嵌入 → 判重与写入（同事务，由端口保证）。 */
    async submit(input) {
        const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime });
        const initialization = this.state.readInitialized(subject.sessionId, subject.subjectId, input.type);
        if (!initialization) {
            throw new WfError(`尚未初始化 ${input.type} 经验生成 Prompt：请先调用 wf_experience_learn 并传空数组（type=${input.type}）取得生成 Prompt，`
                + "再按 Prompt 产出候选并重新提交。", ERR_EXPERIENCE_NOT_INITIALIZED);
        }
        const drafts = validateExperienceCandidates(input.candidates, input.type);
        const projections = drafts.map((draft) => buildRetrievalProjection(draft));
        const vectors = await this.embedOutOfTransaction(projections.flatMap((projection) => [projection.taskRetrievalText, projection.decisionRetrievalText]));
        const rows = drafts.map((draft, index) => this.buildInsertRow(draft, projections[index], vectors[index * 2], vectors[index * 2 + 1], subject, initialization));
        return this.deps.store.insertChecked({ rows, duplicateOf: createDuplicateJudge() });
    }
    /**
     * 召回：传 ids 取完整条目（仅活跃），这一步即「显式注入」的使用事实边界；
     * 否则按 query 取候选摘要——候选阶段只读、幂等，不写任何事实。
     */
    async recall(input) {
        const subject = resolveExperienceSubject({ caller: input.caller, type: input.type, runtime: this.deps.runtime });
        const ids = input.ids;
        if (ids !== undefined && ids.length === 0) {
            throw new WfError("ids 不能为空数组：请传第一阶段返回的候选 id，或改用 query 做候选召回。", ERR_EXPERIENCE_BAD_ARGS);
        }
        const query = (input.query ?? "").trim();
        if (ids === undefined && !query) {
            throw new WfError("经验召回需要 query（第一阶段取候选摘要）或 ids（第二阶段取完整内容）：请提供其中之一后重新调用。", ERR_EXPERIENCE_BAD_ARGS);
        }
        try {
            if (ids !== undefined) {
                const entries = await this.deps.store.getRows(ids, { activeOnly: true });
                await this.recordUsage(subject, entries);
                return { kind: "details", entries };
            }
            const { pairs, source } = await this.recallScoredEntries({ subject, query, topK: input.topK });
            const hits = pairs.map((pair) => ({
                id: pair.entry.id,
                score: pair.score,
                summary: buildRecallSummary(pair.entry),
                source,
            }));
            return { kind: "candidates", hits, source };
        }
        catch (error) {
            if (error instanceof WfError)
                throw error;
            throw new WfError(`经验召回失败（${messageOf(error)}）：请稍后重试；若持续失败请检查经验库与嵌入服务是否可用。`, ERR_EXPERIENCE_RECALL_FAILED);
        }
    }
    /**
     * 提交已使用经验的一次评价（§8 / §24）。
     *
     * 编排在 `./feedback.js`：准入判定依赖使用事实，而「逐条跳过」与「一笔事务写评价 + 重算统计」
     * 的语义属同一职责，拆在两处会让准入与写入的边界漂移。
     */
    async feedback(input) {
        return submitExperienceFeedback({ store: this.deps.store, runtime: this.deps.runtime }, input);
    }
    /** 保存可编辑字段：事务外重算投影与向量，事务内落库。 */
    async update(input) {
        const rows = await this.deps.store.getRows([input.experienceId], { activeOnly: false });
        const current = rows[0];
        if (!current) {
            throw new WfError(`经验不存在或已被清理：${input.experienceId}；请刷新经验列表后重试。`, ERR_EXPERIENCE_NOT_FOUND);
        }
        const validated = validateExperiencePatch(current, input.patch);
        const projection = buildRetrievalProjection(validated.fields);
        const vectors = await this.embedOutOfTransaction([projection.taskRetrievalText, projection.decisionRetrievalText]);
        const next = {
            taskRetrievalText: projection.taskRetrievalText,
            decisionRetrievalText: projection.decisionRetrievalText,
            taskEmbedding: vectors[0],
            decisionEmbedding: vectors[1],
            embeddingModel: this.deps.embedding.source,
            embeddingDimension: this.deps.embedding.dimension,
        };
        return this.deps.store.updateFields(input.experienceId, validated.patch, next);
    }
    /** 归档：退出召回面，内容全部保留。 */
    async retire(input) {
        return this.deps.store.setActive(input.experienceId, false);
    }
    /** 恢复：重新进入召回面。 */
    async restore(input) {
        return this.deps.store.setActive(input.experienceId, true);
    }
    /** 列表（活跃 + 归档；上限由调用方给出，存储侧负责实际截断）。 */
    async list(input) {
        if (!Number.isFinite(input.limit) || input.limit < 1) {
            throw new WfError(`列表上限必须是 ≥ 1 的整数（实际为 ${String(input.limit)}）：请传入正整数上限后重试。`, ERR_EXPERIENCE_BAD_ARGS);
        }
        return this.deps.store.listRows(Math.floor(input.limit));
    }
    /**
     * 全量重放评价历史与使用事实，覆盖写入统计投影（§24 / §25）。
     *
     * 为什么是显式动作而不是启动时自动执行：重建是全表读写，且结果与时机无关；暴露成服务方法
     * 后，宿主启动路径不带长事务，调参与修复也能在受控时刻进行。
     */
    async rebuildStats() {
        return rebuildExperienceStats({ store: this.deps.store });
    }
    /** 释放某会话的初始化状态（run 终态 / 插件卸载；幂等，失败不应阻断终态流程）。 */
    clearSession(input) {
        if (!input.sessionId)
            return;
        this.state.clearBySession(input.sessionId);
    }
    /**
     * 协作组共享上下文：按 type="team" 召回一次并渲染为同一份文本（无命中返回 null）。
     *
     * 完整职责校检仍然执行（父代理此刻已承担 Team Leader 职责，标记由编排器在调用前落位）。
     * 失败不向调用方抛错——这是 best-effort 辅助路径，绝不阻断协作组启动；失败原因经日志缝
     * 留下可诊断信息（会话/工作流/组 + 具体错误）。
     */
    async teamExperienceContext(input) {
        const where = `session=${input.sessionId} flow=${input.flowId} group=${input.groupId}`;
        // 该路径不得抛错，因此入参缺失也按「无查询文本」处理，而不是任其成为 TypeError
        const query = (input.query ?? "").trim();
        if (!query) {
            this.deps.logger?.warn(`[visual-workflow] Team 经验共享上下文缺少查询文本（${where}）：已跳过注入。`);
            return null;
        }
        try {
            const subject = resolveExperienceSubject({
                caller: { isChild: false, sessionId: input.sessionId },
                type: "team",
                runtime: this.deps.runtime,
            });
            const { pairs } = await this.recallScoredEntries({ subject, query });
            if (pairs.length === 0)
                return null;
            const text = renderTeamExperienceContext(pairs.map((pair) => pair.entry));
            return text.length > 0 ? text : null;
        }
        catch (error) {
            this.deps.logger?.warn(`[visual-workflow] Team 经验共享上下文召回失败（${where}）：${messageOf(error)}`);
            return null;
        }
    }
    /** 取生效生成 Prompt；缺失属配置事实，给出可行动错误。 */
    async requireActivePrompt(type) {
        const prompt = await this.deps.store.getActivePrompt(type);
        if (!prompt) {
            throw new WfError(`没有 ${type} 类型的生效经验生成 Prompt：生成策略尚未就绪，请确认资产库已写入三类 Prompt 种子后重试。`, ERR_EXPERIENCE_NOT_FOUND);
        }
        return prompt;
    }
    /**
     * 事务外批量嵌入：单次调用算完本批全部文本，任何失败都不得留下部分写入。
     *
     * 为什么先 ensureReady 再读端口 source：source 是「能力事实」，但嵌入引擎惰性加载——
     * 就绪之前 source 恒为 bm25（初始值），直接预读会把「尚未加载」误判成「已降级」并永久
     * 拒绝写入；而真正能触发加载的 embed() 那时还没有机会被调用。就绪后 source 才代表真实能力。
     */
    async embedOutOfTransaction(texts) {
        const { embedding } = this.deps;
        await embedding.ensureReady();
        if (embedding.source === "bm25")
            throw embeddingUnavailable("语义嵌入能力不可用（当前为 BM25 词法检索）");
        let vectors;
        try {
            vectors = await embedding.embed(texts);
        }
        catch (error) {
            throw embeddingUnavailable(`语义嵌入调用失败（${messageOf(error)}）`);
        }
        if (vectors.length !== texts.length) {
            throw embeddingUnavailable(`语义嵌入返回数量不符（期望 ${texts.length}，实际 ${vectors.length}）`);
        }
        for (const vector of vectors) {
            if (vector.length !== embedding.dimension) {
                throw embeddingUnavailable(`语义嵌入维度与端口声明不符（期望 ${embedding.dimension}，实际 ${vector.length}）`);
            }
        }
        return vectors;
    }
    /** 组装完整写入行：语义字段来自草稿，检索投影与向量来自事务外计算，provenance 来自运行事实与初始化记录。 */
    buildInsertRow(draft, projection, taskEmbedding, decisionEmbedding, subject, initialization) {
        return {
            id: this.deps.store.nextId(),
            experienceType: subject.experienceType,
            responsibility: draft.responsibility,
            taskType: draft.taskType,
            decisionDomain: draft.decisionDomain,
            situation: draft.situation,
            trigger: draft.trigger,
            principle: draft.principle,
            recommendedAction: draft.recommendedAction,
            exclusions: draft.exclusions,
            evidence: draft.evidence,
            taskRetrievalText: projection.taskRetrievalText,
            taskEmbedding,
            decisionRetrievalText: projection.decisionRetrievalText,
            decisionEmbedding,
            embeddingModel: this.deps.embedding.source,
            embeddingDimension: this.deps.embedding.dimension,
            sourceRunId: subject.sourceRunId,
            generationPromptId: initialization.generationPromptId,
            generationPromptVersion: initialization.generationPromptVersion,
        };
    }
    /** 单次查询嵌入 + 双通道候选池 + 第二段排序 + 按活跃行补齐条目（摘要与共享上下文共用）。 */
    async recallScoredEntries(input) {
        const rows = await this.deps.store.listActiveEmbeddings(input.subject.experienceType);
        const outcome = await recallActiveHits({ query: input.query, rows, embedding: this.deps.embedding });
        if (outcome.scored.length === 0)
            return { pairs: [], source: outcome.source };
        const scored = outcome.source === "semantic"
            ? await this.rankSemanticCandidates(outcome.scored, input.topK)
            : outcome.scored.slice(0, normalizeTopK(input.topK));
        const entries = await this.deps.store.getRows(scored.map((hit) => hit.id), { activeOnly: true });
        return { pairs: pairScoredEntries(scored, entries), source: outcome.source };
    }
    /**
     * 语义候选池 → 有界信任重排 → MMR（§17～§19）。
     *
     * 为什么词法回退不走这条链：BM25 得分既不是余弦也没有上下界，「归一化相似度」与「候选间
     * 相似度」在词法侧没有对应语义；对它套信任修正等于凭空虚造一套公式，因此回退路径只按词法
     * 得分排序（§35：嵌入失败不修改经验信任，也不因此重排）。
     */
    async rankSemanticCandidates(scored, topK) {
        const qualitySignalById = await this.readQualitySignals(scored.map((hit) => hit.id));
        const candidates = scored.map((hit) => ({
            id: hit.id,
            cosine: hit.score,
            qualitySignal: qualitySignalById.get(hit.id) ?? NEUTRAL_STATS.qualitySignal,
            taskVector: hit.row.taskEmbedding,
            decisionVector: hit.row.decisionEmbedding,
        }));
        return rankRecallCandidates({ candidates, topK: normalizeTopK(topK) });
    }
    /**
     * 读候选的统计质量信号；缺行按中性 0 解释（不伪造统计行）。
     *
     * 降级链（§35 失败隔离）：统计读取失败 → 全部候选按信任中性（qualitySignal = 0）继续语义召回。
     * 统计只是相关性上的 ±20% 修正，绝不能因为它读不到就让经验整体不可用。
     */
    async readQualitySignals(ids) {
        try {
            const rows = await this.deps.store.getStats([...ids]);
            return new Map(rows.map((row) => [row.experienceId, row.qualitySignal]));
        }
        catch (error) {
            this.deps.logger?.warn(`[visual-workflow] 经验统计读取失败，本次召回按信任中性处理：${messageOf(error)}`);
            return new Map();
        }
    }
    /**
     * 记录「经验被显式注入 agent 上下文」这一使用事实（§8 的使用边界）。
     *
     * 降级链（§35 失败隔离）：使用事实写入是 best-effort 辅助路径——它只服务后续统计与反馈准入，
     * 不参与本次返回内容；失败时告警并继续返回经验，绝不使召回失败。
     * 代价是这次注入没有留下使用事实，后续对该经验的反馈会因准入判定失败被跳过（可再次显式召回后补评）。
     */
    async recordUsage(subject, entries) {
        if (entries.length === 0)
            return;
        try {
            await this.deps.store.recordUsage({
                rows: entries.map((entry) => ({
                    experienceId: entry.id,
                    runId: subject.sourceRunId,
                    subjectId: subject.subjectId,
                })),
                neutralStats: NEUTRAL_STATS,
            });
        }
        catch (error) {
            this.deps.logger?.warn(`[visual-workflow] 经验使用事实写入失败（session=${subject.sessionId} subject=${subject.subjectId}）：`
                + `${messageOf(error)}；本次仍返回经验。`);
        }
    }
}
/** 语义嵌入不可用的统一错误：消息必须说明「本次未写入」，调用方才知道可以稍后重试。 */
function embeddingUnavailable(reason) {
    return new WfError(`${reason}：经验入库要求语义去重，本次未写入任何内容；请确认嵌入服务可用后重试。`, ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE);
}
//# sourceMappingURL=service.js.map
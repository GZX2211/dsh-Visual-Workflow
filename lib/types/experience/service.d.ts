import type { ExperienceEntry, ExperienceGenerationPromptEntry, ExperiencePatch, ExperienceRecallHit, ExperienceType } from "../shared/asset-types.js";
import { type ExperienceFeedbackInput, type ExperienceFeedbackResult } from "./feedback.js";
import type { ExperienceCaller, ExperienceEmbeddingPort, ExperienceRuntimePort, ExperienceStorePort } from "./ports.js";
/** 服务依赖（宿主在组合根装配；端口形状见 ./ports.js）。 */
export interface ExperienceServiceDeps {
    store: ExperienceStorePort;
    runtime: ExperienceRuntimePort;
    embedding: ExperienceEmbeddingPort;
    /** 时钟缝（初始化状态时间戳；缺省 Date.now）。 */
    now?: () => number;
    /** 诊断缝：辅助路径（协作组共享上下文召回）失败时留下可诊断信息，不向调用方抛错。 */
    logger?: {
        warn(message: string): void;
    };
}
/** 召回结果：候选阶段（摘要）或详情阶段（完整条目）。 */
export type ExperienceRecallResult = {
    kind: "candidates";
    hits: ExperienceRecallHit[];
    source: "semantic" | "bm25";
} | {
    kind: "details";
    entries: ExperienceEntry[];
};
/** 提交结果（与持久化端口一致：写入条目 + 被判重拦截的说明）。 */
export interface ExperienceSubmitResult {
    inserted: ExperienceEntry[];
    skipped: Array<{
        reason: string;
        decisionRetrievalText: string;
    }>;
}
export declare class ExperienceService {
    private readonly deps;
    private readonly state;
    constructor(deps: ExperienceServiceDeps);
    /** 取当前主体该类型的生效生成 Prompt，并记录初始化态（重复调用幂等）。 */
    initializePrompt(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
    }): Promise<{
        prompt: ExperienceGenerationPromptEntry;
    }>;
    /** 提交候选：校验 → 投影 → 事务外批量嵌入 → 判重与写入（同事务，由端口保证）。 */
    submit(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
        candidates: unknown;
    }): Promise<ExperienceSubmitResult>;
    /**
     * 召回：传 ids 取完整条目（仅活跃），这一步即「显式注入」的使用事实边界；
     * 否则按 query 取候选摘要——候选阶段只读、幂等，不写任何事实。
     */
    recall(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
        query?: string;
        ids?: string[];
        topK?: number;
    }): Promise<ExperienceRecallResult>;
    /**
     * 提交已使用经验的一次评价（§8 / §24）。
     *
     * 编排在 `./feedback.js`：准入判定依赖使用事实，而「逐条跳过」与「一笔事务写评价 + 重算统计」
     * 的语义属同一职责，拆在两处会让准入与写入的边界漂移。
     */
    feedback(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
        evaluations: readonly ExperienceFeedbackInput[];
    }): Promise<ExperienceFeedbackResult>;
    /** 保存可编辑字段：事务外重算投影与向量，事务内落库。 */
    update(input: {
        experienceId: string;
        patch: ExperiencePatch;
    }): Promise<ExperienceEntry>;
    /** 归档：退出召回面，内容全部保留。 */
    retire(input: {
        experienceId: string;
    }): Promise<ExperienceEntry>;
    /** 恢复：重新进入召回面。 */
    restore(input: {
        experienceId: string;
    }): Promise<ExperienceEntry>;
    /** 列表（活跃 + 归档；上限由调用方给出，存储侧负责实际截断）。 */
    list(input: {
        limit: number;
    }): Promise<ExperienceEntry[]>;
    /**
     * 全量重放评价历史与使用事实，覆盖写入统计投影（§24 / §25）。
     *
     * 为什么是显式动作而不是启动时自动执行：重建是全表读写，且结果与时机无关；暴露成服务方法
     * 后，宿主启动路径不带长事务，调参与修复也能在受控时刻进行。
     */
    rebuildStats(): Promise<{
        experienceCount: number;
    }>;
    /** 释放某会话的初始化状态（run 终态 / 插件卸载；幂等，失败不应阻断终态流程）。 */
    clearSession(input: {
        sessionId: string;
    }): void;
    /**
     * 协作组共享上下文：按 type="team" 召回一次并渲染为同一份文本（无命中返回 null）。
     *
     * 完整职责校检仍然执行（父代理此刻已承担 Team Leader 职责，标记由编排器在调用前落位）。
     * 失败不向调用方抛错——这是 best-effort 辅助路径，绝不阻断协作组启动；失败原因经日志缝
     * 留下可诊断信息（会话/工作流/组 + 具体错误）。
     */
    teamExperienceContext(input: {
        sessionId: string;
        flowId: string;
        groupId: string;
        query: string;
    }): Promise<string | null>;
    /** 取生效生成 Prompt；缺失属配置事实，给出可行动错误。 */
    private requireActivePrompt;
    /**
     * 事务外批量嵌入：单次调用算完本批全部文本，任何失败都不得留下部分写入。
     *
     * 为什么先 ensureReady 再读端口 source：source 是「能力事实」，但嵌入引擎惰性加载——
     * 就绪之前 source 恒为 bm25（初始值），直接预读会把「尚未加载」误判成「已降级」并永久
     * 拒绝写入；而真正能触发加载的 embed() 那时还没有机会被调用。就绪后 source 才代表真实能力。
     */
    private embedOutOfTransaction;
    /** 组装完整写入行：语义字段来自草稿，检索投影与向量来自事务外计算，provenance 来自运行事实与初始化记录。 */
    private buildInsertRow;
    /** 单次查询嵌入 + 双通道候选池 + 第二段排序 + 按活跃行补齐条目（摘要与共享上下文共用）。 */
    private recallScoredEntries;
    /**
     * 语义候选池 → 有界信任重排 → MMR（§17～§19）。
     *
     * 为什么词法回退不走这条链：BM25 得分既不是余弦也没有上下界，「归一化相似度」与「候选间
     * 相似度」在词法侧没有对应语义；对它套信任修正等于凭空虚造一套公式，因此回退路径只按词法
     * 得分排序（§35：嵌入失败不修改经验信任，也不因此重排）。
     */
    private rankSemanticCandidates;
    /**
     * 读候选的统计质量信号；缺行按中性 0 解释（不伪造统计行）。
     *
     * 降级链（§35 失败隔离）：统计读取失败 → 全部候选按信任中性（qualitySignal = 0）继续语义召回。
     * 统计只是相关性上的 ±20% 修正，绝不能因为它读不到就让经验整体不可用。
     */
    private readQualitySignals;
    /**
     * 记录「经验被显式注入 agent 上下文」这一使用事实（§8 的使用边界）。
     *
     * 降级链（§35 失败隔离）：使用事实写入是 best-effort 辅助路径——它只服务后续统计与反馈准入，
     * 不参与本次返回内容；失败时告警并继续返回经验，绝不使召回失败。
     * 代价是这次注入没有留下使用事实，后续对该经验的反馈会因准入判定失败被跳过（可再次显式召回后补评）。
     */
    private recordUsage;
}

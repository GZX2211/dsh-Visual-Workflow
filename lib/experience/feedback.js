// src/host/experience/feedback.ts
//
// 反馈编排：把「已使用经验的一次评价」写入评价历史并触发统计重算（§8、§24）。
//
// 为什么把准入判定放在域层而不是工具层：评价的唯一前置条件「该经验确实被显式注入过」是一条
// 历史事实，只能由持久化端口回答（工具层看不到使用事实）。工具层负责参数形状与锚点，
// 域层负责「这条评价有没有资格存在」，两侧职责不重叠。
//
// 为什么单条准入失败只跳过该条：一次复盘里模型可能同时提交多条，其中一条填了未使用过的经验
// 不应废掉整批复盘数据；反之若整批接受，评价历史会掺入「没使用也评价」的假事实，
// 而统计一旦被污染就无法靠重建区分哪些是假的。
import { WfError, messageOf } from "../orchestrator/errors.js";
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_FEEDBACK_FAILED, } from "../shared/protocol.js";
import { EVALUATION_EVIDENCE_LIMIT, MAX_EVALUATIONS_PER_CALL } from "./constants.js";
import { validateEvaluationScores } from "./scoring.js";
import { aggregateExperienceStats } from "./statistics.js";
import { resolveExperienceSubject } from "./subject.js";
/**
 * 准入拒绝的固定语义（文案是产品要求，不是提示词建议）。
 *
 * 用户明确要求只表达「没有使用的经验，不能评价」，不得引导模型「先用 ids 召回再评价」：
 * 该引导会把「补一次召回再评价」变成合法路径，从而让未真正使用过的经验也能被评价。
 */
export const FEEDBACK_ADMISSION_REJECTED_REASON = "没有使用的经验，不能评价";
/**
 * 提交评价：解析主体 → 校验每条评分 → 准入判定 → 一笔事务写评价并重算统计。
 *
 * 失败隔离：写入失败只把错误归一为 `WF_EXPERIENCE_FEEDBACK_FAILED`（保留原始原因），
 * 经验本体与既有评价历史都不受影响；统计可由 rebuild 全量重放修复（§24 / §35）。
 */
export async function submitExperienceFeedback(deps, request) {
    const evaluations = validateFeedbackShape(request.evaluations);
    const subject = resolveExperienceSubject({ caller: request.caller, type: request.type, runtime: deps.runtime });
    const injected = new Set(await deps.store.listInjectedIds({
        subjectId: subject.subjectId,
        experienceType: request.type,
        experienceIds: evaluations.map((evaluation) => evaluation.experienceId),
    }));
    const accepted = [];
    const skipped = [];
    for (const evaluation of evaluations) {
        if (injected.has(evaluation.experienceId)) {
            accepted.push(evaluation);
            continue;
        }
        skipped.push({
            experienceId: evaluation.experienceId,
            reason: `${FEEDBACK_ADMISSION_REJECTED_REASON}：经验 ${evaluation.experienceId} 不在该主体已被显式注入的经验集合内；`
                + "本条已跳过，同批其余条目照常处理。",
        });
    }
    if (accepted.length === 0)
        return { accepted: [], skipped };
    // 评分者模型名一次性读取：写入失败重试时不得因两次读取不同而让同一批评价带上不同 provenance
    const evaluatorModel = deps.runtime.modelForCaller(request.caller);
    const rows = accepted.map((evaluation) => ({
        experienceId: evaluation.experienceId,
        runId: subject.sourceRunId,
        fitScore: evaluation.fitScore,
        decisionEffect: evaluation.decisionEffect,
        informationGain: evaluation.informationGain,
        causalConfidence: evaluation.causalConfidence,
        evidence: evaluation.evidence ?? "",
        evaluatorSubjectId: subject.subjectId,
        evaluatorModel,
    }));
    try {
        const { inserted } = await deps.store.insertEvaluationsChecked({ rows, aggregate: aggregateExperienceStats });
        return { accepted: inserted, skipped };
    }
    catch (error) {
        throw new WfError(`经验反馈写入失败（${messageOf(error)}）：本次评价未落库，经验本体与已有评价历史均未被改动；`
            + "请在任务收尾阶段重试提交。", ERR_EXPERIENCE_FEEDBACK_FAILED);
    }
}
/**
 * 校验评价列表的形状与锚点（域层是唯一校验本体，工具层重复校验只是为了让错误更早出现）。
 *
 * 先整体校验再动存储：任何一条非法都不应留下部分写入。
 */
function validateFeedbackShape(evaluations) {
    if (evaluations.length === 0) {
        throw new WfError("经验反馈需要至少一条评价（evaluations 不能为空）：请提交本次实际使用过并已形成判断的经验。", ERR_EXPERIENCE_BAD_ARGS);
    }
    if (evaluations.length > MAX_EVALUATIONS_PER_CALL) {
        throw new WfError(`单次反馈最多提交 ${MAX_EVALUATIONS_PER_CALL} 条评价（实际为 ${evaluations.length}）：`
            + "请只保留本次任务中真正形成结论的条目后重试。", ERR_EXPERIENCE_BAD_ARGS);
    }
    for (const evaluation of evaluations) {
        const experienceId = typeof evaluation.experienceId === "string" ? evaluation.experienceId.trim() : "";
        if (!experienceId) {
            throw new WfError("经验反馈缺少有效的经验 id（experience_id 必须是非空字符串）：请填写召回结果中给出的经验 id 后重试。", ERR_EXPERIENCE_BAD_ARGS);
        }
        const evidence = evaluation.evidence ?? "";
        if (evidence.length > EVALUATION_EVIDENCE_LIMIT) {
            throw new WfError(`评价证据说明超出长度上限 ${EVALUATION_EVIDENCE_LIMIT} 字符（实际为 ${evidence.length}）：请精简后重试。`, ERR_EXPERIENCE_BAD_ARGS);
        }
        const validation = validateEvaluationScores({
            fitScore: evaluation.fitScore,
            decisionEffect: evaluation.decisionEffect,
            informationGain: evaluation.informationGain,
            causalConfidence: evaluation.causalConfidence,
        });
        if (!validation.ok) {
            throw new WfError(`经验 ${experienceId} 的${validation.reason}`, ERR_EXPERIENCE_BAD_ARGS);
        }
    }
    return [...evaluations];
}
//# sourceMappingURL=feedback.js.map
// src/host/assets/experience-codec.ts
//
// 经验域的两张表与共享契约之间的行编解码：类型收窄、JSON 数组列往返、
// 行 → 条目投影、双通道向量的可用性判定。
//
// 为什么集中在一个文件：同一列在同一模块里出现两种读法（列表读宽容、判重读严格）
// 时，漂移只会在两处口径不一致时才暴露；把「列怎么读」收敛到一处，两处消费方
// 引用同一事实。
import { decodeEmbedding } from "./embedding-blob.js";
import { requireAssetId, toInteger, toNullableInteger, toNullableText } from "./role-check.js";
/** 经验主体类型取值（与 DDL 的 CHECK 约束同域）。 */
const EXPERIENCE_TYPES = ["agent", "team", "orchestrator"];
/**
 * 列值 → 主体类型。
 * CHECK 约束保证取值合法，非法值只在库被外部改坏时出现；此时回落到 agent 而不是抛错，
 * 保证界面列表与召回读不会因单行损坏整次失败（损坏只影响该行的分类精度）。
 */
export function asExperienceType(value) {
    const text = String(value ?? "");
    return EXPERIENCE_TYPES.includes(text) ? text : "agent";
}
/** JSON 数组列读取（缺失、非法 JSON 或非数组一律读成空数组）。 */
export function parseJsonArray(value) {
    if (typeof value !== "string")
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    }
    catch {
        return [];
    }
}
/** JSON 数组列写入（数组字段的磁盘形态固定为字符串数组，空值落 '[]' 而非 NULL）。 */
export function toJsonArray(value) {
    return JSON.stringify(Array.isArray(value) ? value.map((item) => String(item)) : []);
}
/**
 * 行内两条向量独立解码，共用同一记录维度。
 * 为什么不用一个「整体可用」布尔：判重只需要决策侧向量，召回要求两侧都可用，
 * 两个消费方的需求不同，合并判定会让「只有一侧可用」的行在一处可用、另一处凭空消失。
 */
export function decodeRowEmbeddings(row) {
    const dimension = toNullableInteger(row.embedding_dimension);
    return {
        taskEmbedding: decodeEmbedding(row.task_embedding, dimension).vector,
        decisionEmbedding: decodeEmbedding(row.decision_embedding, dimension).vector,
    };
}
/**
 * 经验行 → 契约条目。
 * 向量元信息与「两条向量都可用」同真同假：条目只声明向量元信息而不带向量本身，
 * 若元信息留在一条不可用的行上，调用方会据此认为该行可参与语义召回。
 */
export function experienceRowToEntry(row) {
    const { taskEmbedding, decisionEmbedding } = decodeRowEmbeddings(row);
    const usable = taskEmbedding !== null && decisionEmbedding !== null;
    const embeddingModel = toNullableText(row.embedding_model);
    const dimension = toNullableInteger(row.embedding_dimension);
    return {
        id: requireAssetId(row.id, "experiences.id"),
        active: toInteger(row.is_active, 1) !== 0,
        experienceType: asExperienceType(row.experience_type),
        responsibility: String(row.responsibility ?? ""),
        taskType: String(row.task_type ?? ""),
        decisionDomain: String(row.decision_domain ?? ""),
        situation: String(row.situation ?? ""),
        trigger: String(row.trigger ?? ""),
        principle: String(row.principle ?? ""),
        recommendedAction: String(row.recommended_action ?? ""),
        exclusions: parseJsonArray(row.exclusions),
        evidence: parseJsonArray(row.evidence),
        taskRetrievalText: String(row.task_retrieval_text ?? ""),
        decisionRetrievalText: String(row.decision_retrieval_text ?? ""),
        ...(usable && embeddingModel ? { embeddingModel } : {}),
        ...(usable && dimension !== null ? { embeddingDimension: dimension } : {}),
        sourceRunId: String(row.source_run_id ?? ""),
        generationPromptId: String(row.generation_prompt_id ?? ""),
        generationPromptVersion: String(row.generation_prompt_version ?? ""),
        createdAt: toInteger(row.created_at, 0),
        updatedAt: toInteger(row.updated_at, 0),
    };
}
/** 经验生成 Prompt 行 → 契约条目。 */
export function experiencePromptRowToEntry(row) {
    const description = toNullableText(row.description);
    return {
        id: requireAssetId(row.id, "experience_prompts.id"),
        experienceType: asExperienceType(row.experience_type),
        name: String(row.name ?? ""),
        ...(description ? { description } : {}),
        prompt: String(row.prompt ?? ""),
        promptVersion: String(row.prompt_version ?? ""),
        active: toInteger(row.is_active, 1) !== 0,
        createdAt: toInteger(row.created_at, 0),
        updatedAt: toInteger(row.updated_at, 0),
    };
}
/**
 * 评价行 → 四维评分（聚合器的输入）。
 *
 * 为什么直接按契约收窄而不再校验取值域：`fit_score` 等列的 CHECK 约束已经把取值锁在锚点集合内，
 * 而校验清单的唯一本体在经验域；资产库再造一份锚点表只会变成第三处口径。
 */
export function evaluationScoresFromRow(row) {
    return {
        fitScore: Number(row.fit_score),
        decisionEffect: Number(row.decision_effect),
        informationGain: Number(row.information_gain),
        causalConfidence: Number(row.causal_confidence),
    };
}
//# sourceMappingURL=experience-codec.js.map
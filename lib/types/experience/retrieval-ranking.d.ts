/**
 * 参与第二段排序的候选事实。
 *
 * 为什么同时带两侧向量：MMR 的 diversity 项需要在候选之间算相似度，而「候选间相似度取两通道
 * 归一化相似度的较大者」是用户定案的口径，只给一个标量相似度无法表达。
 */
export interface RecallRankingCandidate {
    id: string;
    /** Stage 1 得到的原始余弦相似度（两通道取较高者，对应 §17 的 cosine）。 */
    cosine: number;
    /** 该经验当前的统计质量信号；无统计行按 0（= 中性）解释。 */
    qualitySignal: number;
    taskVector: Float64Array;
    decisionVector: Float64Array;
}
/** 有界重排后的候选（MMR 阶段的输入）。 */
export interface RelevanceAdjustedCandidate {
    candidate: RecallRankingCandidate;
    adjustedRelevance: number;
}
/** 对外命中：`score` 是对模型可见的得分（= adjustedRelevance，MMR 只决定顺序）。 */
export interface RecallRankingHit {
    id: string;
    score: number;
}
/** MMR 选择入参。 */
export interface MmrSelectionInput {
    ranked: readonly RelevanceAdjustedCandidate[];
    limit: number;
}
/** 候选排序入参（`semanticFloor === undefined` 时取 §20 的全局配置本体）。 */
export interface RecallRankingInput {
    candidates: readonly RecallRankingCandidate[];
    topK: number;
    semanticFloor?: number | null;
}
/** 余弦归一化 `sim01 = (cosine + 1) / 2`（§17），夹回 [0,1] 以吸收浮点舍入。 */
export declare function normalizeSimilarity(cosine: number): number;
/**
 * 有界信任修正 `adjusted_relevance = sim01 × (1 + β × quality_signal)`（§17）。
 *
 * 语义：信任对相关性只有 ±β 的乘性影响，不构成第二个召回轴。
 */
export declare function calculateRecallAdjustment(input: {
    cosine: number;
    qualitySignal: number;
}): number;
/** 候选间相似度：两通道归一化相似度取较大者；通道不可比时按 0 参与取较大值。 */
export declare function pairSimilarity(left: RecallRankingCandidate, right: RecallRankingCandidate): number;
/** 逐候选计算有界修正相关性并稳定排序（此处尚不涉及多样性）。 */
export declare function boundedTrustRerank(candidates: readonly RecallRankingCandidate[]): RelevanceAdjustedCandidate[];
/**
 * MMR 贪心选择（§19）：
 * `relevance_weight × adjusted_relevance - diversity_weight × max_similarity_to_selected`。
 *
 * 已选集合为空时多样性项为 0，因此第一条总是修正相关性最高者；此后高重复候选会被同族已选
 * 候选压下去（多样性项按归一化相似度计）。同分按 id 升序，保证结果确定。
 */
export declare function selectByMmr(input: MmrSelectionInput): RelevanceAdjustedCandidate[];
/**
 * 召回第二段完整链路：语义硬保护过滤 → 有界信任重排 → MMR → topK 截断。
 *
 * `score` 返回 adjustedRelevance（用户定案）：MMR 只决定顺序，模型看到的得分始终是
 * 「语义相关性 × 有界信任修正」，不掺入多样性项。
 */
export declare function rankRecallCandidates(input: RecallRankingInput): RecallRankingHit[];

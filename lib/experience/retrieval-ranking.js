// src/host/experience/retrieval-ranking.ts
//
// 召回的第二段：有界信任重排 + MMR 多样性选择（§15～§20、§30）。
//
// 为什么信任只能乘法修正而不能作为第二个召回轴（§15 / §18）：一旦信任离开乘法项，低相关高信任
// 的经验就能压过明显更相关的经验，召回面会随历史评价自行漂移，而语义相关性——唯一真正回答
// 「这条经验和当前任务有关吗」的信号——会被架空。因此这里把修正幅度写死在 ±β 内，
// 并让 MMR 的 diversity 项只吃几何相似度，完全不吃信任（§19）。
//
// 全部输入即事实：cosine、qualitySignal 与两侧向量都由调用方传入，本文件不读统计、不读时钟。
import { dotProduct } from "../embedding/engine.js";
import { MMR_DIVERSITY_WEIGHT, MMR_RELEVANCE_WEIGHT, SEMANTIC_FLOOR, TRUST_ADJUSTMENT_BETA, } from "./constants.js";
/** 余弦归一化 `sim01 = (cosine + 1) / 2`（§17），夹回 [0,1] 以吸收浮点舍入。 */
export function normalizeSimilarity(cosine) {
    return Math.min(1, Math.max(0, (cosine + 1) / 2));
}
/**
 * 有界信任修正 `adjusted_relevance = sim01 × (1 + β × quality_signal)`（§17）。
 *
 * 语义：信任对相关性只有 ±β 的乘性影响，不构成第二个召回轴。
 */
export function calculateRecallAdjustment(input) {
    return normalizeSimilarity(input.cosine) * (1 + TRUST_ADJUSTMENT_BETA * input.qualitySignal);
}
/** 单通道相似度；维度不一致即不可比较，返回 null（不补零、不截断）。 */
function channelSimilarity(left, right) {
    if (left.length !== right.length)
        return null;
    return normalizeSimilarity(dotProduct(left, right));
}
/** 候选间相似度：两通道归一化相似度取较大者；通道不可比时按 0 参与取较大值。 */
export function pairSimilarity(left, right) {
    const task = channelSimilarity(left.taskVector, right.taskVector) ?? 0;
    const decision = channelSimilarity(left.decisionVector, right.decisionVector) ?? 0;
    return Math.max(task, decision);
}
/** 稳定排序：修正相关性降序，同分按 id 升序（结果必须可复现）。 */
function sortByRelevance(ranked) {
    return [...ranked].sort((left, right) => {
        if (right.adjustedRelevance !== left.adjustedRelevance)
            return right.adjustedRelevance - left.adjustedRelevance;
        return left.candidate.id < right.candidate.id ? -1 : left.candidate.id > right.candidate.id ? 1 : 0;
    });
}
/** 逐候选计算有界修正相关性并稳定排序（此处尚不涉及多样性）。 */
export function boundedTrustRerank(candidates) {
    return sortByRelevance(candidates.map((candidate) => ({
        candidate,
        adjustedRelevance: calculateRecallAdjustment({ cosine: candidate.cosine, qualitySignal: candidate.qualitySignal }),
    })));
}
/**
 * MMR 贪心选择（§19）：
 * `relevance_weight × adjusted_relevance - diversity_weight × max_similarity_to_selected`。
 *
 * 已选集合为空时多样性项为 0，因此第一条总是修正相关性最高者；此后高重复候选会被同族已选
 * 候选压下去（多样性项按归一化相似度计）。同分按 id 升序，保证结果确定。
 */
export function selectByMmr(input) {
    if (input.limit <= 0)
        return [];
    const remaining = [...input.ranked];
    const selected = [];
    while (selected.length < input.limit && remaining.length > 0) {
        let bestIndex = 0;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < remaining.length; index += 1) {
            const item = remaining[index];
            const similarity = selected.reduce((max, chosen) => Math.max(max, pairSimilarity(item.candidate, chosen.candidate)), 0);
            const score = MMR_RELEVANCE_WEIGHT * item.adjustedRelevance - MMR_DIVERSITY_WEIGHT * similarity;
            // bestScore 初值为 -Infinity，因此第一次循环必然走赋值分支，bestIndex 在平局比较时一定有效
            const betterIdOnTie = score === bestScore && item.candidate.id < remaining[bestIndex].candidate.id;
            if (score > bestScore || betterIdOnTie) {
                bestScore = score;
                bestIndex = index;
            }
        }
        selected.push(remaining[bestIndex]);
        remaining.splice(bestIndex, 1);
    }
    return selected;
}
/**
 * 召回第二段完整链路：语义硬保护过滤 → 有界信任重排 → MMR → topK 截断。
 *
 * `score` 返回 adjustedRelevance（用户定案）：MMR 只决定顺序，模型看到的得分始终是
 * 「语义相关性 × 有界信任修正」，不掺入多样性项。
 */
export function rankRecallCandidates(input) {
    if (input.topK <= 0)
        return [];
    const floor = input.semanticFloor === undefined ? SEMANTIC_FLOOR : input.semanticFloor;
    const eligible = floor === null ? input.candidates : input.candidates.filter((candidate) => candidate.cosine >= floor);
    return selectByMmr({ ranked: boundedTrustRerank(eligible), limit: input.topK })
        .map((item) => ({ id: item.candidate.id, score: item.adjustedRelevance }));
}
//# sourceMappingURL=retrieval-ranking.js.map
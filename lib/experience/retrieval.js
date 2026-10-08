// src/host/experience/retrieval.ts
//
// 经验召回评分（§8.2 双通道语义召回 + §8.3 词法回退）。
//
// 为什么对任务侧与决策侧分别取 topK 再取并集：同一经验可能因「任务情形相似」或「决策问题相似」
// 任一侧被回忆，单通道会漏掉另一侧的合理命中。相似度一律复用嵌入引擎的单位向量内积语义，
// 本文件不另写一套余弦实现，避免两处算法漂移。
//
// 为什么回退要显式标注来源：词法得分与语义得分不可比，调用方需要知道本次结果「不是语义检索」，
// 因此回退不是内部细节，而是返回值上的事实。
import { dotProduct } from "../embedding/engine.js";
import { DEFAULT_RECALL_TOP_K, MAX_RECALL_TOP_K } from "./constants.js";
/** BM25 参数（业界常用经验值；此处只用于词法回退排序，不追求与任何实现对齐）。 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** topK 归一化：缺省/非法回落默认值，超上限截到上限。 */
export function normalizeTopK(topK) {
    if (topK === undefined || !Number.isFinite(topK) || topK <= 0)
        return DEFAULT_RECALL_TOP_K;
    return Math.min(Math.floor(topK), MAX_RECALL_TOP_K);
}
/** 稳定排序：分数降序，同分按 id 升序（同分顺序必须确定，否则结果不可复现）。 */
function sortScored(scores) {
    return [...scores].sort((left, right) => {
        if (right.score !== left.score)
            return right.score - left.score;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}
/** 单通道打分：与查询向量维度不一致的行无法比较，直接跳过（不猜测、不补零）。 */
function scoreChannel(rows, queryVector, pick, topK) {
    const scored = [];
    for (const row of rows) {
        const vector = pick(row);
        if (vector.length !== queryVector.length)
            continue;
        scored.push({ id: row.id, score: dotProduct(queryVector, vector) });
    }
    return sortScored(scored).slice(0, topK);
}
/** 并集去重：同一经验取两通道中的较高分。 */
function mergeChannels(channels, topK) {
    const best = new Map();
    for (const channel of channels) {
        for (const hit of channel) {
            const current = best.get(hit.id);
            if (current === undefined || hit.score > current)
                best.set(hit.id, hit.score);
        }
    }
    return sortScored([...best].map(([id, score]) => ({ id, score }))).slice(0, topK);
}
/** 双通道语义召回：各通道取 topK → 并集去重取最高分 → 最终仍按 topK 截断。 */
export function rankByEmbedding(rows, queryVector, topK) {
    const taskChannel = scoreChannel(rows, queryVector, (row) => row.taskEmbedding, topK);
    const decisionChannel = scoreChannel(rows, queryVector, (row) => row.decisionEmbedding, topK);
    return mergeChannels([taskChannel, decisionChannel], topK);
}
/** 词法分词：拉丁词按词切分，中日韩文本按二元组切分（无分词器也能稳定匹配）。 */
export function tokenizeForLexical(text) {
    const tokens = [];
    const pattern = /[a-z0-9]+|[\u4e00-\u9fff]+/gu;
    for (const match of text.toLowerCase().matchAll(pattern)) {
        const piece = match[0];
        if (piece.length === 1 || /^[a-z0-9]+$/u.test(piece)) {
            tokens.push(piece);
            continue;
        }
        for (let index = 0; index + 1 < piece.length; index += 1)
            tokens.push(piece.slice(index, index + 2));
    }
    return tokens;
}
/** BM25 词法评分（按文档顺序返回得分）。 */
export function bm25Scores(query, documents) {
    if (documents.length === 0)
        return [];
    const queryTokens = [...new Set(tokenizeForLexical(query))];
    const documentTokens = documents.map((document) => tokenizeForLexical(document));
    const totalLength = documentTokens.reduce((sum, tokens) => sum + tokens.length, 0);
    const averageLength = totalLength / documentTokens.length;
    const scores = documents.map(() => 0);
    for (const token of queryTokens) {
        const frequencies = documentTokens.map((tokens) => tokens.filter((item) => item === token).length);
        const documentFrequency = frequencies.filter((count) => count > 0).length;
        if (documentFrequency === 0)
            continue;
        const idf = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
        frequencies.forEach((frequency, index) => {
            if (frequency === 0)
                return;
            const length = documentTokens[index].length;
            const lengthRatio = averageLength > 0 ? length / averageLength : 0;
            const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio);
            scores[index] += (idf * frequency * (BM25_K1 + 1)) / denominator;
        });
    }
    return scores;
}
/** 词法回退召回：把两个检索文本拼成一篇文档做 BM25，取 topK。 */
export function rankByBm25(query, rows, topK) {
    const documents = rows.map((row) => `${row.taskRetrievalText}\n${row.decisionRetrievalText}`);
    const scores = bm25Scores(query, documents);
    const scored = rows.map((row, index) => ({ id: row.id, score: scores[index] ?? 0 }));
    return sortScored(scored).slice(0, topK);
}
/**
 * 一次查询嵌入 + 双通道召回；语义不可用（端口退化 bm25 或嵌入调用失败）时回退词法检索。
 * 成功路径只发起一次查询嵌入（不逐条候选发请求）。
 */
export async function recallActiveHits(input) {
    const topK = normalizeTopK(input.topK);
    if (input.rows.length === 0) {
        // 无活跃行时不必付出一次远程嵌入的代价；来源仍如实反映当前端口能力
        return { scored: [], source: input.embedding.source === "bm25" ? "bm25" : "semantic" };
    }
    if (input.embedding.source !== "bm25") {
        try {
            const vectors = await input.embedding.embed([input.query]);
            const queryVector = vectors[0];
            if (!queryVector)
                throw new Error("嵌入服务未返回查询向量");
            return { scored: rankByEmbedding(input.rows, queryVector, topK), source: "semantic" };
        }
        catch {
            // 语义路径不可用即降级词法检索：宁可给词法命中并标注来源，也不要静默返回空结果
        }
    }
    return { scored: rankByBm25(input.query, input.rows, topK), source: "bm25" };
}
//# sourceMappingURL=retrieval.js.map
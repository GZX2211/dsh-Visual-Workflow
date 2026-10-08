import type { ExperienceEmbeddingPort, ExperienceRetrievalRow } from "./ports.js";
/** 单条命中（id + 得分）。 */
export interface ExperienceScoredId {
    id: string;
    score: number;
}
/**
 * 池内命中：得分 + 产生该得分的召回行。
 *
 * 为什么带行本身：第二段排序需要在候选之间算几何相似度（MMR 的 diversity 项），
 * 只传 id 会让调用方再用 id 回查一次行，凭空制造「查不到」这一现实中不存在的分支。
 */
export interface ExperienceScoredRow extends ExperienceScoredId {
    row: ExperienceRetrievalRow;
}
/** 召回结果：已排序的候选池与本次得分的来源通道。 */
export interface ExperienceRecallOutcome {
    scored: ExperienceScoredRow[];
    source: "semantic" | "bm25";
}
/** 召回入参：查询文本 + 已按类型筛好的活跃行 + 嵌入端口。 */
export interface ExperienceRecallInput {
    query: string;
    rows: ExperienceRetrievalRow[];
    embedding: ExperienceEmbeddingPort;
}
/** 最终返回条数归一化：缺省/非法回落默认值，超上限截到上限。 */
export declare function normalizeTopK(topK?: number): number;
/** 双通道语义候选池：各通道取池大小 → 并集去重取最高分 → 仍按池大小截断。 */
export declare function rankByEmbedding(rows: readonly ExperienceRetrievalRow[], queryVector: Float64Array, poolSize: number): ExperienceScoredRow[];
/** 词法分词：拉丁词按词切分，中日韩文本按二元组切分（无分词器也能稳定匹配）。 */
export declare function tokenizeForLexical(text: string): string[];
/** BM25 词法评分（按文档顺序返回得分）。 */
export declare function bm25Scores(query: string, documents: readonly string[]): number[];
/** 词法回退候选池：把两个检索文本拼成一篇文档做 BM25，取池大小。 */
export declare function rankByBm25(query: string, rows: readonly ExperienceRetrievalRow[], poolSize: number): ExperienceScoredRow[];
/**
 * 一次查询嵌入 + 双通道候选池；语义不可用（端口退化 bm25 或嵌入调用失败）时回退词法检索。
 * 成功路径只发起一次查询嵌入（不逐条候选发请求）。
 */
export declare function recallActiveHits(input: ExperienceRecallInput): Promise<ExperienceRecallOutcome>;

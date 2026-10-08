import type { ExperienceEmbeddingPort, ExperienceRetrievalRow } from "./ports.js";
/** 单条命中（id + 得分）。 */
export interface ExperienceScoredId {
    id: string;
    score: number;
}
/** 召回结果：已排序的命中与本次得分的来源通道。 */
export interface ExperienceRecallOutcome {
    scored: ExperienceScoredId[];
    source: "semantic" | "bm25";
}
/** 召回入参：查询文本 + 已按类型筛好的活跃行 + 嵌入端口。 */
export interface ExperienceRecallInput {
    query: string;
    rows: ExperienceRetrievalRow[];
    embedding: ExperienceEmbeddingPort;
    topK?: number;
}
/** topK 归一化：缺省/非法回落默认值，超上限截到上限。 */
export declare function normalizeTopK(topK?: number): number;
/** 双通道语义召回：各通道取 topK → 并集去重取最高分 → 最终仍按 topK 截断。 */
export declare function rankByEmbedding(rows: readonly ExperienceRetrievalRow[], queryVector: Float64Array, topK: number): ExperienceScoredId[];
/** 词法分词：拉丁词按词切分，中日韩文本按二元组切分（无分词器也能稳定匹配）。 */
export declare function tokenizeForLexical(text: string): string[];
/** BM25 词法评分（按文档顺序返回得分）。 */
export declare function bm25Scores(query: string, documents: readonly string[]): number[];
/** 词法回退召回：把两个检索文本拼成一篇文档做 BM25，取 topK。 */
export declare function rankByBm25(query: string, rows: readonly ExperienceRetrievalRow[], topK: number): ExperienceScoredId[];
/**
 * 一次查询嵌入 + 双通道召回；语义不可用（端口退化 bm25 或嵌入调用失败）时回退词法检索。
 * 成功路径只发起一次查询嵌入（不逐条候选发请求）。
 */
export declare function recallActiveHits(input: ExperienceRecallInput): Promise<ExperienceRecallOutcome>;

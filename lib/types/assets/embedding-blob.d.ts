/** 解码结论：`vector` 为 null 表示该列不可用作向量，`reason` 说明不可用的原因。 */
export interface EmbeddingDecode {
    vector: Float64Array | null;
    reason: string | null;
}
/**
 * 向量 → BLOB；空向量（长度 0）表示当前没有向量能力，返回 null 落 NULL 列。
 *
 * 非有限数值直接拒绝（抛可行动错误）：NaN / Infinity 入库后无法与任何向量比较，
 * 还会污染内积结果，属于必须让调用方看到的数据缺陷，不能静默写入。
 */
export declare function encodeEmbedding(vector: Float64Array): Buffer | null;
/** BLOB → 向量；字节长度不是 8 的倍数或与记录维度不符即判为无向量。 */
export declare function decodeEmbedding(blob: unknown, dimension: number | null): EmbeddingDecode;

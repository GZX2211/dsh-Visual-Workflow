/** 编码为 BLOB 字节：维度必须与数值个数一致，且全部数值有限。 */
export declare function encodeEmbedding(vector: Float64Array, dimension: number): Buffer;
/** 解码 BLOB 字节：字节长度必须是 8 的倍数且与声明维度一致，且全部数值有限。 */
export declare function decodeEmbedding(buffer: Uint8Array, dimension: number): Float64Array;

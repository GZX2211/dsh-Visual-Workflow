/** 单个文本块。 */
export interface TextChunk {
    /** 块序号（0 起；稳定标识，索引/检索回显用）。 */
    index: number;
    /** 块文本（已归一化空白）。 */
    text: string;
}
/** 默认分块大小（字符）。 */
export declare const CHUNK_SIZE_DEFAULT = 384;
/** 默认重叠长度（字符）。 */
export declare const CHUNK_OVERLAP_DEFAULT = 128;
/** 归一化空白：连续空白折叠为单空格并 trim（保留换行语义为空格）。 */
export declare function normalizeWhitespace(text: string): string;
/**
 * 把长文本切成重叠窗口块。
 * 规则：
 *   - 空/空白文本 → 空数组；
 *   - 文本长度 ≤ chunkSize → 单块；
 *   - 步长 = chunkSize - overlap（overlap 必须 < chunkSize）；
 *   - overlap ≥ chunkSize 为非法参数（步长 ≤ 0）：旧实现钳制步长为 1 会生成
 *     数量接近文本长度的巨量块（长文本内存飙升），改为 fail-fast 抛 RangeError，
 *     让调用方在源头修正参数（护栏 fail-closed，与 SQL 白名单同姿态）；
 *   - 末块不足 chunkSize 也保留（内容不丢失）。
 */
export declare function chunkText(text: string, chunkSize?: number, overlap?: number): TextChunk[];

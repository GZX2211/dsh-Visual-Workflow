// src/host/embedding/chunker.ts
//
// 文本分块纯函数（本地向量索引的输入预处理）。
//
// 分块策略：定长字符窗口 + 重叠（默认 384 字符/步长 128），重叠保证跨块语义
// 不被窗口边界切断（相邻块共享尾部/头部文本，检索时无论关键词落在哪个窗口
// 都能命中）。分块前归一化空白（连续空白折叠为单空格），避免窗口切在空白
// 碎片上产生视觉噪声；中文按字符窗口天然适配（无需分词）。
//
// 纯函数、无 IO：单测可直接断言窗口/步长/边界行为。

/** 单个文本块。 */
export interface TextChunk {
  /** 块序号（0 起；稳定标识，索引/检索回显用）。 */
  index: number
  /** 块文本（已归一化空白）。 */
  text: string
}

/** 默认分块大小（字符）。 */
export const CHUNK_SIZE_DEFAULT = 384

/** 默认重叠长度（字符）。 */
export const CHUNK_OVERLAP_DEFAULT = 128

/** 归一化空白：连续空白折叠为单空格并 trim（保留换行语义为空格）。 */
export function normalizeWhitespace(text: string): string {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

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
export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE_DEFAULT,
  overlap: number = CHUNK_OVERLAP_DEFAULT,
): TextChunk[] {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return []
  const size = Math.max(1, Math.floor(chunkSize))
  const overlapClamped = Math.max(0, Math.floor(overlap))
  if (overlapClamped >= size) {
    throw new RangeError(`chunkText 参数非法：overlap（${overlapClamped}）必须小于 chunkSize（${size}）`)
  }
  const step = Math.max(1, size - overlapClamped)
  if (normalized.length <= size) return [{ index: 0, text: normalized }]
  const chunks: TextChunk[] = []
  let index = 0
  for (let pos = 0; pos < normalized.length; pos += step) {
    chunks.push({ index, text: normalized.slice(pos, pos + size) })
    index += 1
  }
  return chunks
}

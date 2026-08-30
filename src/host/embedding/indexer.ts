// src/host/embedding/indexer.ts
//
// 向量索引：数据库文本内容的「分块 + 向量化 + 持久化 + 检索」。
//
// 存储：单文件 JSON（<dataDir>/data/vector/<dataId>.json），原子写 + 文件锁，
// 崩溃安全且无垃圾残留；重建为整体替换（数据量级为知识库文本，全量重建
// 简单可靠，满足「增量重建」语义——每次 rebuild 全量重算并原子发布）。
//
// 检索双模式：
//   - embedding：分块向量与查询向量做归一化内积 Top-K（余弦相似度）；
//   - bm25：模型不可用时降级——token 倒排 + BM25 打分（中文按单字符、
//     英文按单词），结果标注 source='bm25'，界面呈现「相似度检索（非语义）」。
//
// 查询缺失/索引未建时返回 null（调用方给明确错误提示）。

import { atomicWriteJson, readJson, withJsonLock } from '../storage/atomic.js'
import { CHUNK_OVERLAP_DEFAULT, CHUNK_SIZE_DEFAULT, chunkText } from './chunker.js'
import { dotProduct, type EmbeddingEngine } from './engine.js'

/** 索引内单个分块（向量与文本同存；source 为源记录标识，如「表名」；rowKey 为源记录主键值）。 */
export interface IndexedChunk {
  index: number
  text: string
  vector?: number[]
  source: string
  /** 源记录主键值（用于把命中映射回整行；无则缺省）。 */
  rowKey?: string
}

/** 索引文件结构（version 1）。 */
export interface VectorIndexFile {
  version: 1
  dataId: string
  /** 实际检索模式：embedding 或 bm25（降级）。 */
  source: 'embedding' | 'bm25'
  /** 向量维度（bm25 模式为 0）。 */
  dimension: number
  chunkSize: number
  overlap: number
  updatedAt: string
  chunks: IndexedChunk[]
}

/** 检索命中。 */
export interface SearchHit {
  index: number
  text: string
  score: number
  /** 源记录主键值（命中映射回整行用；无则缺省）。 */
  rowKey?: string
}

/** 检索结果。 */
export interface SearchResult {
  hits: SearchHit[]
  source: 'embedding' | 'bm25'
}

/**
 * 简易中英混合分词（BM25 词袋）：
 *   - 连续 ASCII 字母/数字/下划线 → 一个词（小写）；
 *   - 中文字符 → 逐字符成词（汉语无空格，字符粒度最稳）；
 * 其余标点剔除。词序无关（BM25 是词袋模型）。
 */
export function tokenizeText(text: string): string[] {
  const tokens: string[] = []
  const ascii = String(text).match(/[A-Za-z0-9_]+/g)
  if (ascii) {
    for (const word of ascii) tokens.push(word.toLowerCase())
  }
  const cjk = String(text).replace(/[A-Za-z0-9_]+/g, ' ').match(/[\u4e00-\u9fff]/g)
  if (cjk) tokens.push(...cjk)
  return tokens
}

/** BM25 打分参数（经典取值：k1 词频饱和、b 文档长度归一）。 */
const BM25_K1 = 1.5
const BM25_B = 0.75

/**
 * BM25 检索：query tokens 对全部块打分取 Top-K。
 * idf = ln(1 + (N - df + 0.5)/(df + 0.5))；词频经 k1/b 饱和归一。
 */
export function bm25Search(chunks: IndexedChunk[], queryTokens: string[], topK: number): SearchHit[] {
  const n = chunks.length
  if (n === 0 || queryTokens.length === 0) return []
  const query = [...new Set(queryTokens)]
  const lengths = chunks.map((chunk) => tokenizeText(chunk.text).length)
  const avgdl = lengths.reduce((sum, len) => sum + len, 0) / n || 1
  const df = new Map<string, number>()
  for (const chunk of chunks) {
    const unique = new Set(tokenizeText(chunk.text))
    for (const token of unique) df.set(token, (df.get(token) ?? 0) + 1)
  }
  const scored: Array<{ index: number; text: string; score: number; rowKey?: string }> = []
  for (let i = 0; i < chunks.length; i += 1) {
    const tokens = tokenizeText(chunks[i].text)
    const tf = new Map<string, number>()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    let score = 0
    for (const token of query) {
      const documentFreq = df.get(token) ?? 0
      if (documentFreq === 0) continue
      const idf = Math.log(1 + (n - documentFreq + 0.5) / (documentFreq + 0.5))
      const termFreq = tf.get(token) ?? 0
      if (termFreq === 0) continue
      const denom = termFreq + BM25_K1 * (1 - BM25_B + BM25_B * (lengths[i] / avgdl))
      score += idf * ((termFreq * (BM25_K1 + 1)) / denom)
    }
    if (score > 0) scored.push({ index: chunks[i].index, text: chunks[i].text, score, rowKey: chunks[i].rowKey })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, topK))
}

/** 索引源记录（rebuild 输入：每条记录独立分块，块携带 source 标识）。 */
export interface IndexRecord {
  /** 记录文本（分块前不做拼接——跨记录语义不应混入同一块）。 */
  text: string
  /** 源记录标识（如「表名」），回显/审计用。 */
  source?: string
  /** 源记录主键值（命中时回传，用于映射回整行）。 */
  rowKey?: string
}

/** 索引重建入参。 */
export interface RebuildInput {
  dataId: string
  /** 源记录列表；每条独立分块，块携带 source。 */
  records: IndexRecord[]
  /** 嵌入引擎；null 或 bm25 降级态 → 纯文本 BM25 索引。 */
  engine?: EmbeddingEngine | null
  chunkSize?: number
  overlap?: number
}

/**
 * 向量索引：重建/读取/检索/删除（单文件原子持久化）。
 */
export class VectorIndex {
  constructor(private readonly filePath: string) {}

  /**
   * 重建索引（全量替换 + 原子发布）。
   * 嵌入可用时写入向量（source=embedding）；不可用/失败时仅存文本（source=bm25）
   * ——降级是产品级路径，不抛错。
   */
  async rebuild(input: RebuildInput): Promise<VectorIndexFile> {
    const chunkSize = input.chunkSize ?? CHUNK_SIZE_DEFAULT
    const overlap = input.overlap ?? CHUNK_OVERLAP_DEFAULT
    const chunks: IndexedChunk[] = []
    for (const record of input.records) {
      for (const piece of chunkText(record.text, chunkSize, overlap)) {
        chunks.push({
          index: chunks.length,
          text: piece.text,
          source: record.source ?? '',
          ...(record.rowKey !== undefined && record.rowKey !== '' ? { rowKey: record.rowKey } : {}),
        })
      }
    }
    let source: 'embedding' | 'bm25' = 'bm25'
    let dimension = 0
    if (input.engine && input.engine.source !== 'bm25' && chunks.length > 0) {
      try {
        const vectors = await input.engine.embed(chunks.map((chunk) => chunk.text))
        for (let i = 0; i < chunks.length; i += 1) {
          chunks[i].vector = Array.from(vectors[i])
        }
        source = 'embedding'
        dimension = input.engine.dimension
      } catch {
        // 嵌入失败 → 降级 BM25（文本已就绪）
      }
    }
    const file: VectorIndexFile = {
      version: 1,
      dataId: input.dataId,
      source,
      dimension,
      chunkSize,
      overlap,
      updatedAt: new Date().toISOString(),
      chunks,
    }
    await withJsonLock(this.filePath, async () => {
      await atomicWriteJson(this.filePath, file)
    })
    return file
  }

  /** 读取索引文件；不存在返回 null；损坏抛 CorruptJsonError。 */
  async load(): Promise<VectorIndexFile | null> {
    return readJson<VectorIndexFile | null>(this.filePath, null)
  }

  /**
   * 检索：embedding 模式用余弦 Top-K；bm25 模式用 BM25 打分。
   * 索引不存在/为空返回 null；查询嵌入失败时回退 BM25（结果标注）。
   * engine 在调用时注入（与 rebuild 的解耦一致；可为 null）。
   * @param options.threshold 相似度阈值（仅保留得分 > 此值；默认 0，兼容原 score>0 语义）。
   */
  async search(
    query: string,
    topK: number,
    engine?: EmbeddingEngine | null,
    options?: { threshold?: number },
  ): Promise<SearchResult | null> {
    const file = await this.load()
    if (!file || file.chunks.length === 0) return null
    const limit = Math.max(1, Math.min(50, topK || 5))
    const threshold = Number(options?.threshold ?? 0) || 0
    if (file.source === 'embedding' && engine && engine.source !== 'bm25') {
      try {
        const [queryVector] = await engine.embed([query])
        const scored = file.chunks
          .map((chunk) => ({
            index: chunk.index,
            text: chunk.text,
            rowKey: chunk.rowKey,
            score: chunk.vector ? dotProduct(queryVector, new Float64Array(chunk.vector)) : 0,
          }))
          .sort((a, b) => b.score - a.score)
        const hits = scored.slice(0, limit).filter((hit) => hit.score > threshold)
        return { hits, source: 'embedding' }
      } catch {
        // 查询嵌入失败 → 降级 BM25（标注）
      }
    }
    const all = bm25Search(file.chunks, tokenizeText(query), limit)
    const hits = all.filter((hit) => hit.score > threshold)
    return { hits, source: 'bm25' }
  }

  /** 删除索引文件（数据节点删除时清理，无垃圾残留）。 */
  async deleteFile(): Promise<void> {
    await withJsonLock(this.filePath, async () => {
      const { rm } = await import('node:fs/promises')
      await rm(this.filePath, { force: true })
    })
  }
}

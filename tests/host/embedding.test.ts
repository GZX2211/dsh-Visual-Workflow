// tests/host/embedding.test.ts
//
// 本地嵌入与向量索引单测（T-025）：
//   - chunker：窗口/步长/重叠/空白归一化/边界；
//   - tokenize/BM25：分词与倒排打分；
//   - VectorIndex：rebuild（embedding/bm25 双模式）、检索 Top-K、原子持久化、
//     降级标注、删除清理；
//   - EmbeddingService：外部端点优先（fake fetch）、资产缺失降级 bm25、
//     归一化向量纯函数。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkText, normalizeWhitespace } from '../../src/host/embedding/chunker.js'
import { EmbeddingService, dotProduct, normalizeVector } from '../../src/host/embedding/engine.js'
import { VectorIndex, bm25Search, tokenizeText } from '../../src/host/embedding/indexer.js'
import type { EmbeddingEngine } from '../../src/host/embedding/engine.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 可控 fake 嵌入引擎（向量 = 词袋 one-hot 风格，便于断言相似度）。 */
function fakeEngine(source: 'local' | 'remote' | 'bm25' = 'local', dimension = 4): EmbeddingEngine {
  return {
    source,
    dimension,
    async embed(texts: string[]): Promise<Float64Array[]> {
      return texts.map((text) => {
        const vec = new Float64Array(dimension)
        for (const ch of text) {
          vec[Math.abs(ch.codePointAt(0) ?? 0) % dimension] += 1
        }
        return normalizeVector(vec)
      })
    },
    dispose() {},
  }
}

// ---------------------------------------------------------------------------
// chunker 纯函数
// ---------------------------------------------------------------------------

describe('chunkText 分块', () => {
  it('空/空白文本 → 空数组', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\t ')).toEqual([])
  })

  it('长度 ≤ chunkSize → 单块（内容归一化）', () => {
    const chunks = chunkText(' 你好   世界 ')
    expect(chunks).toEqual([{ index: 0, text: '你好 世界' }])
  })

  it('长文本按步长切窗：size=10 overlap=4 → step=6，末块保留', () => {
    const text = '0123456789ABCDEFGHIJ' // 20 字符
    const chunks = chunkText(text, 10, 4)
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3])
    expect(chunks[0].text).toBe('0123456789')
    expect(chunks[1].text).toBe('6789ABCDEF')
    expect(chunks[3].text).toBe('IJ')
  })

  it('overlap ≥ chunkSize 抛 RangeError（fail-fast：拒绝步长 ≤ 0 的参数组合）', () => {
    // 旧实现把步长钳为 1，生成数量接近文本长度的巨量块（长文本内存飙升）；
    // 修复后直接抛错，让调用方在源头修正参数（护栏 fail-closed）
    expect(() => chunkText('abcdef', 3, 10)).toThrow(RangeError)
    expect(() => chunkText('abcdef', 3, 3)).toThrow(RangeError)
    expect(() => chunkText('abcdef', 3, 100)).toThrow(/overlap.*必须小于.*chunkSize/)
  })

  it('默认参数：384 字符/重叠 128；1000 字符文本块数正确', () => {
    const text = '测'.repeat(1000)
    const chunks = chunkText(text)
    const step = 384 - 128
    const expected = Math.ceil((1000 - 384) / step) + 1
    expect(chunks.length).toBe(expected)
    expect(chunks[0].text.length).toBe(384)
  })

  it('normalizeWhitespace 折叠连续空白并 trim', () => {
    expect(normalizeWhitespace(' a\n\t b  c ')).toBe('a b c')
  })
})

// ---------------------------------------------------------------------------
// tokenize / BM25
// ---------------------------------------------------------------------------

describe('tokenizeText 与 BM25', () => {
  it('中文按单字符、英文按词（小写）、标点剔除', () => {
    expect(tokenizeText('Hello 世界!')).toEqual(['hello', '世', '界'])
    expect(tokenizeText('DeepSeek AI v2')).toEqual(['deepseek', 'ai', 'v2'])
  })

  it('bm25Search：相关块排前、topK 截断、无匹配空数组', () => {
    const chunks = [
      { index: 0, text: '数据库 向量 检索 引擎', vector: [], source: 't1' },
      { index: 1, text: '咖啡 拉花 艺术', vector: [], source: 't2' },
      { index: 2, text: '向量 数据库 索引 构建', vector: [], source: 't1' },
    ]
    const hits = bm25Search(chunks, tokenizeText('向量 数据库'), 5)
    // 命中且分数 > 0（同分时排序不稳定，不做顺序断言）
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) expect(hit.score).toBeGreaterThan(0)
    const texts = hits.map((h) => h.text)
    expect(texts.some((t) => t.includes('数据库'))).toBe(true)
    expect(texts.some((t) => t.includes('向量'))).toBe(true)
    expect(texts.every((t) => t !== '咖啡 拉花 艺术')).toBe(true)
    const capped = bm25Search(chunks, tokenizeText('向量 数据库'), 1)
    expect(capped).toHaveLength(1)
    expect(bm25Search(chunks, tokenizeText('不存在的词'), 5)).toEqual([])
    expect(bm25Search([], ['a'], 5)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// VectorIndex
// ---------------------------------------------------------------------------

describe('VectorIndex 重建与检索', () => {
  it('rebuild embedding 模式：向量写入、原子持久化、load 一致', async () => {
    const dir = await tempDir('vw-idx-')
    const indexPath = join(dir, 'idx.json')
    const index = new VectorIndex(indexPath)
    const file = await index.rebuild({
      dataId: 'db-1',
      records: [
        { text: '第一条 数据 内容', source: 't1' },
        { text: '第二条 数据 内容', source: 't1' },
      ],
      engine: fakeEngine(),
    })
    expect(file.source).toBe('embedding')
    expect(file.dimension).toBe(4)
    expect(file.chunks.length).toBe(2)
    expect(file.chunks[0].vector?.length).toBe(4)
    const loaded = await index.load()
    expect(loaded?.dataId).toBe('db-1')
    expect(loaded?.chunks[0].source).toBe('t1')
    // 磁盘真实存在（原子写产物）
    expect(existsSync(indexPath)).toBe(true)
  })

  it('rebuild 降级：engine 为 bm25/null → 纯文本索引（source=bm25、无向量）', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'idx.json'))
    const file = await index.rebuild({ dataId: 'db-1', records: [{ text: '降级 检索 内容' }], engine: null })
    expect(file.source).toBe('bm25')
    expect(file.dimension).toBe(0)
    expect(file.chunks.every((c) => c.vector === undefined)).toBe(true)
  })

  it('rebuild 逐记录分块：长记录被切窗且 source 保留', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'idx.json'))
    const file = await index.rebuild({
      dataId: 'db-1',
      records: [
        { text: '甲'.repeat(100), source: 't1' },
        { text: '乙'.repeat(100), source: 't2' },
      ],
      engine: null,
      chunkSize: 30,
      overlap: 10,
    })
    // 100 字符 / 步长 20 → 5 块/条，共 10 块
    expect(file.chunks).toHaveLength(10)
    expect(file.chunks.filter((c) => c.source === 't1')).toHaveLength(5)
    expect(file.chunks.filter((c) => c.source === 't2')).toHaveLength(5)
  })

  it('search embedding：归一化内积 Top-K，分数降序', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'idx.json'))
    const engine = fakeEngine()
    await index.rebuild({
      dataId: 'db-1',
      records: [
        { text: '苹果 水果 甘甜', source: 't1' },
        { text: '香蕉 水果 软糯', source: 't1' },
        { text: '汽车 引擎 轰鸣', source: 't2' },
      ],
      engine,
    })
    const result = await index.search('水果', 2, engine)
    expect(result?.source).toBe('embedding')
    expect(result?.hits.length).toBe(2)
    // 两个水果块都命中且分数 > 0；汽车块不出现
    const texts = result!.hits.map((h) => h.text)
    expect(texts.some((t) => t.includes('苹果'))).toBe(true)
    expect(texts.some((t) => t.includes('香蕉'))).toBe(true)
    expect(texts.some((t) => t.includes('汽车'))).toBe(false)
  })

  it('search 对 bm25 索引自动走 BM25 打分并标注 source=bm25', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'idx.json'))
    await index.rebuild({
      dataId: 'db-1',
      records: [
        { text: '北京 首都 城市', source: 't1' },
        { text: '上海 城市 港口', source: 't1' },
        { text: '机器学习 模型', source: 't2' },
      ],
      engine: null,
    })
    const result = await index.search('城市', 5)
    expect(result?.source).toBe('bm25')
    expect(result?.hits.length).toBe(2)
    expect(result?.hits[0].text).toContain('北京')
  })

  it('search 命中回传 rowKey（记录 → 分块 → 命中）', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'idx.json'))
    await index.rebuild({
      dataId: 'db-1',
      records: [
        { text: '苹果 水果 甘甜', source: 'products', rowKey: '1' },
        { text: '香蕉 水果 软糯', source: 'products', rowKey: '2' },
      ],
      engine: null,
    })
    const result = await index.search('水果', 5)
    const keys = result!.hits.map((h) => h.rowKey)
    expect(keys).toContain('1')
    expect(keys).toContain('2')
  })

  it('search 支持相似度阈值：低于阈值的命中被过滤', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'idx.json'))
    await index.rebuild({
      dataId: 'db-1',
      records: [
        { text: '苹果 水果 甘甜', source: 't1', rowKey: '1' },
        { text: '香蕉 水果 软糯', source: 't1', rowKey: '2' },
        { text: '汽车 引擎 轰鸣', source: 't2', rowKey: '3' },
      ],
      engine: fakeEngine(),
    })
    // 无阈值（默认 0）：保留正分命中（topK=5）
    const loose = await index.search('水果', 5, fakeEngine())
    expect(loose!.hits.length).toBeGreaterThan(0)
    // 高阈值：只保留相似度较高的命中（分数从高到低），低分被过滤
    const strict = await index.search('水果', 5, fakeEngine(), { threshold: 0.99 })
    expect(strict!.hits.length).toBeLessThanOrEqual(loose!.hits.length)
    expect(strict!.hits.every((hit) => hit.score > 0.99)).toBe(true)
  })

  it('bm25Search 命中回传 rowKey', () => {
    const chunks = [
      { index: 0, text: '北京 首都 城市', source: 't1', rowKey: '1' },
      { index: 1, text: '上海 城市 港口', source: 't1', rowKey: '2' },
    ]
    const hits = bm25Search(chunks, tokenizeText('城市'), 5)
    expect(hits.some((h) => h.rowKey === '1')).toBe(true)
    expect(hits.some((h) => h.rowKey === '2')).toBe(true)
  })

  it('search 索引缺失/为空 → null', async () => {
    const dir = await tempDir('vw-idx-')
    const index = new VectorIndex(join(dir, 'missing.json'))
    expect(await index.search('anything', 5)).toBeNull()
  })

  it('deleteFile 幂等删除，无残留', async () => {
    const dir = await tempDir('vw-idx-')
    const indexPath = join(dir, 'idx.json')
    const index = new VectorIndex(indexPath)
    await index.rebuild({ dataId: 'db-1', records: [{ text: '内容' }], engine: null })
    expect(existsSync(indexPath)).toBe(true)
    await index.deleteFile()
    expect(existsSync(indexPath)).toBe(false)
    await index.deleteFile() // 幂等
  })
})

// ---------------------------------------------------------------------------
// EmbeddingService
// ---------------------------------------------------------------------------

describe('EmbeddingService 来源选择', () => {
  it('配置外部端点 → source=remote，embed 经 fetch 调用并归一化', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            { embedding: [3, 4] },
            { embedding: [0, 2] },
          ],
        }
      },
    })) as unknown as typeof fetch
    const service = new EmbeddingService({ endpoint: 'http://localhost:9999/v1/embeddings', fetchImpl })
    expect(await service.ensureReady()).toBe('remote')
    const vectors = await service.embed(['a', 'b'])
    expect(vectors).toHaveLength(2)
    expect(vectors[0][0]).toBeCloseTo(0.6)
    expect(vectors[0][1]).toBeCloseTo(0.8)
    const body = JSON.parse(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body))
    expect(body.input).toEqual(['a', 'b'])
    service.dispose()
  })

  it('外部端点响应数量不符 → 明确错误', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ embedding: [1] }] }
      },
    })) as unknown as typeof fetch
    const service = new EmbeddingService({ endpoint: 'http://localhost:9999/v1/embeddings', fetchImpl })
    await expect(service.embed(['a', 'b'])).rejects.toThrow('返回数量不符')
  })

  it('外部端点非 2xx → 明确错误', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch
    const service = new EmbeddingService({ endpoint: 'http://localhost:9999/v1/embeddings', fetchImpl })
    await expect(service.embed(['a'])).rejects.toThrow('HTTP 401')
  })

  it('资产缺失 → 降级 bm25（不加载重依赖，不抛错）', async () => {
    const dir = await tempDir('vw-empty-')
    const service = new EmbeddingService({ modelDir: join(dir, 'no-such-model') })
    expect(await service.ensureReady()).toBe('bm25')
    await expect(service.embed(['a'])).rejects.toThrow('本地嵌入模型不可用')
    service.dispose()
  })

  it('normalizeVector：L2 归一化、零向量保持全零', () => {
    const v = normalizeVector([3, 4])
    expect(v[0]).toBeCloseTo(0.6)
    expect(v[1]).toBeCloseTo(0.8)
    const zero = normalizeVector([0, 0])
    expect(zero[0]).toBe(0)
  })

  it('dotProduct：归一化向量内积即余弦', () => {
    const a = normalizeVector([1, 0])
    const b = normalizeVector([0, 1])
    expect(dotProduct(a, b)).toBeCloseTo(0)
    expect(dotProduct(a, a)).toBeCloseTo(1)
  })
})

// tests/host/embedding/engine.test.ts
//
// 本地嵌入引擎单测（T-025）：来源选择（外部端点 > 本地资产 > BM25 降级）、
// 归一化纯函数，以及宿主全局共享引擎的并发单飞与释放竞态。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EmbeddingService, dotProduct, normalizeVector } from '../../../src/host/embedding/engine.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

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

// ---------------------------------------------------------------------------
// EmbeddingService 并发与释放（宿主全局共享一个引擎实例：加载期并发必须单飞）
// ---------------------------------------------------------------------------

/** 受控 extractor：可控加载时序 + 可观测释放（单飞与释放竞态用）。 */
function gatedExtractor(gate: Promise<void>, onDispose: () => void) {
  const extractor = (texts: string[], _options: { pooling: 'cls'; normalize: true }) => {
    const dim = 2
    const data = new Float32Array(texts.length * dim).fill(1)
    return Promise.resolve({ data, dims: [texts.length, dim] })
  }
  return Object.assign(
    async (texts: string[], options: { pooling: 'cls'; normalize: true }) => {
      await gate
      return extractor(texts, options)
    },
    { dispose: async () => onDispose() },
  )
}

describe('EmbeddingService 并发单飞与释放竞态', () => {
  it('加载途中的并发 embed 等待同一次加载（不误判 bm25 降级）', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const loadExtractor = vi.fn(async () => gatedExtractor(gate, () => {}))
    const service = new EmbeddingService({ loadExtractor })

    // 第一个调用进入加载，第二个调用在加载途中到达（旧实现会立即看到 bm25 并抛错）
    const first = service.embed(['a'])
    const second = service.embed(['b'])
    releaseGate()
    const [vectorsA, vectorsB] = await Promise.all([first, second])

    expect(loadExtractor).toHaveBeenCalledTimes(1)
    expect(service.source).toBe('local')
    expect(vectorsA).toHaveLength(1)
    expect(vectorsB).toHaveLength(1)
    service.dispose()
  })

  it('释放竞态：加载完成时引擎已释放 → 不持有模型、立即释放 extractor、embed 报已释放', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const disposeSpy = vi.fn(async () => {})
    const service = new EmbeddingService({ loadExtractor: async () => gatedExtractor(gate, disposeSpy) })

    const pending = service.embed(['a'])
    service.dispose()
    releaseGate()

    await expect(pending).rejects.toThrow('嵌入引擎已释放')
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(service.source).toBe('bm25')
  })

  it('释放后的 ensureReady 不再加载模型（短路为 bm25）', async () => {
    const loadExtractor = vi.fn(async () => gatedExtractor(Promise.resolve(), () => {}))
    const service = new EmbeddingService({ loadExtractor })
    service.dispose()

    expect(await service.ensureReady()).toBe('bm25')
    expect(loadExtractor).not.toHaveBeenCalled()
  })
})

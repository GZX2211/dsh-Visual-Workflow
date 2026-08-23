// src/host/embedding/engine.ts
//
// 嵌入引擎：为本地向量检索提供「文本 → 512 维归一化句向量」能力。
//
// 来源优先级（配置/资产驱动）：
//   1. remote —— 配置了外部 OpenAI 兼容 /embeddings 端点（embeddingEndpoint）时
//      优先使用（需求：可配置外部嵌入端点优先）；
//   2. local —— 本地 bge-small-zh-v1.5 ONNX 量化资产经 transformers.js 推理
//      （CPU；随包分发约 25MB，见 assets/models/bge-small-zh-v1.5）；
//   3. bm25 —— 资产缺失/加载失败时降级：engine 不再提供向量，调用方（索引器）
//      自动改用 BM25 相似度检索并在结果中标注「非语义」。
//
// 为什么惰性加载：transformers.js 及其 onnxruntime 后端是重依赖，仅在真正
// 需要本地嵌入时才动态 import；配置了外部端点或资产缺失时完全不加载，缩短
// 启动时间并避免无谓报错。
//
// 池化策略：bge 系列官方语义为 CLS token 句向量（资产内 1_Pooling 配置
// pooling_mode_cls_token=true），故显式 pooling: 'cls' + normalize: true。

import { fileURLToPath } from 'node:url'

/** 嵌入来源：local 本地模型 / remote 外部端点 / bm25 降级（无向量能力）。 */
export type EmbeddingSource = 'local' | 'remote' | 'bm25'

/** 嵌入引擎接口（索引器/数据工具依赖；单测可注入 fake）。 */
export interface EmbeddingEngine {
  /** 当前来源。 */
  readonly source: EmbeddingSource
  /** 向量维度（bm25 降级时为 0）。 */
  readonly dimension: number
  /** 批量嵌入（返回单位长度向量；bm25 降级时抛明确错误）。 */
  embed(texts: string[]): Promise<Float64Array[]>
  /** 释放本地模型等资源（幂等）。 */
  dispose(): void
}

/** L2 归一化（内积即余弦相似度；零向量返回全零）。 */
export function normalizeVector(values: number[] | Float64Array | Float32Array): Float64Array {
  const out = new Float64Array(values.length)
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]) || 0
    out[i] = v
    sum += v * v
  }
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < out.length; i += 1) out[i] /= norm
  }
  return out
}

/** 向量内积（两向量均归一化时即余弦相似度）。 */
export function dotProduct(a: Float64Array, b: Float64Array): number {
  const len = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < len; i += 1) sum += a[i] * b[i]
  return sum
}

/** 远程端点（OpenAI 兼容 /embeddings）的最小响应形状。 */
interface RemoteEmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>
}

/** 本地 transformers.js feature-extraction pipeline 的最小使用面（惰性 import）。 */
interface LocalExtractorLike {
  (texts: string[], options: { pooling: 'cls'; normalize: true }): Promise<{
    data: Float32Array | Float64Array
    dims: number[]
  }>
  dispose?(): Promise<void>
}

/** 嵌入引擎配置。 */
export interface EmbeddingServiceOptions {
  /** 本地模型资产目录；null 用随包分发资产。 */
  modelDir?: string | null
  /** 外部 OpenAI 兼容 /embeddings 端点 URL；非空时优先。 */
  endpoint?: string | null
  /** 日志缝。 */
  logger?: { warn(message: string): void }
  /** fetch 实现注入（单测远程端点用；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch
  /** 资产目录定位注入（单测降级路径用临时目录）。 */
  assetDir?: string
}

/**
 * 嵌入服务实现：按配置与资产可用性惰性选择来源。
 * - embed() 在 bm25 降级态抛错（调用方据此降级检索并标注）；
 * - dispose() 释放本地模型（幂等，多调用安全）。
 */
export class EmbeddingService implements EmbeddingEngine {
  readonly source: EmbeddingSource = 'bm25'
  readonly dimension = 0

  private local: LocalExtractorLike | null = null
  private ready = false
  private disposed = false

  constructor(private readonly options: EmbeddingServiceOptions = {}) {}

  /**
   * 确保嵌入能力就绪（惰性、幂等）：
   * remote 端点存在 → 采用 remote；否则尝试本地资产；再失败 → bm25 降级。
   * 加载失败不抛错——降级是产品级路径（界面标注「相似度检索（非语义）」）。
   */
  async ensureReady(): Promise<EmbeddingSource> {
    if (this.ready) return this.source
    this.ready = true

    if (this.options.endpoint) {
      ;(this as { source: EmbeddingSource }).source = 'remote'
      return this.source
    }

    try {
      const extractor = await this.loadLocal()
      this.local = extractor
      ;(this as { source: EmbeddingSource }).source = 'local'
      ;(this as { dimension: number }).dimension = 512
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn(`[visual-workflow] 本地嵌入模型加载失败，降级 BM25 相似度检索：${message}`)
    }
    return this.source
  }

  /** 批量嵌入（单位长度向量）。bm25 降级态抛明确错误。 */
  async embed(texts: string[]): Promise<Float64Array[]> {
    if (this.disposed) throw new Error('嵌入引擎已释放')
    await this.ensureReady()
    if (this.source === 'remote') {
      return this.embedRemote(texts)
    }
    if (this.source === 'local' && this.local) {
      return this.embedLocal(texts)
    }
    throw new Error('本地嵌入模型不可用（资产缺失或加载失败），请使用 BM25 相似度检索')
  }

  /** 释放本地模型（幂等）。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.local?.dispose) {
      try {
        void this.local.dispose()
      } catch {
        // 释放尽力而为
      }
    }
    this.local = null
  }

  /** 解析本地资产目录：显式配置 > 注入定位 > 随包分发资产。 */
  private resolveModelDir(): string {
    const explicit = this.options.modelDir?.trim()
    if (explicit) return explicit
    if (this.options.assetDir) return this.options.assetDir
    // 编译产物位于 lib/embedding/，随包资产位于包根 assets/——上两级即包根
    return fileURLToPath(new URL('../../assets/models/bge-small-zh-v1.5', import.meta.url))
  }

  /** 惰性加载 transformers.js 并构造 feature-extraction pipeline。 */
  private async loadLocal(): Promise<LocalExtractorLike> {
    const dir = this.resolveModelDir()
    // 快速失败：目录/配置缺失时不加载重依赖（transformers.js + onnxruntime），
    // 让降级路径（BM25）零开销——资产未随包分发时避免无谓的模块加载。
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    if (!existsSync(join(dir, 'config.json')) || !existsSync(join(dir, 'tokenizer.json'))) {
      throw new Error(`本地嵌入模型资产缺失：${dir}`)
    }
    // 动态 import：本地模式才加载重依赖（transformers.js + onnxruntime）
    const { pipeline } = await import('@huggingface/transformers')
    const extractor = await pipeline('feature-extraction', dir, {
      dtype: 'q8',
      local_files_only: true,
    }) as unknown as LocalExtractorLike
    return extractor
  }

  /** 本地推理：CLS 池化 + 归一化，产出 [batch, 512]。 */
  private async embedLocal(texts: string[]): Promise<Float64Array[]> {
    const out = await this.local!(texts, { pooling: 'cls', normalize: true })
    const data = out.data
    const dim = out.dims?.[1] ?? 0
    if (!data || dim <= 0) throw new Error('本地嵌入输出异常（维度为 0）')
    const vectors: Float64Array[] = []
    for (let row = 0; row < out.dims[0]; row += 1) {
      vectors.push(normalizeVector(data.subarray(row * dim, (row + 1) * dim)))
    }
    return vectors
  }

  /** 外部端点：POST {input: texts}，解析 { data: [{ embedding }] } 并归一化。 */
  private async embedRemote(texts: string[]): Promise<Float64Array[]> {
    const endpoint = this.options.endpoint!
    const fetchImpl = this.options.fetchImpl ?? fetch
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: texts }),
    })
    if (!response.ok) {
      throw new Error(`外部嵌入端点响应异常（HTTP ${response.status}）`)
    }
    const json = (await response.json()) as RemoteEmbeddingsResponse
    const rows = Array.isArray(json.data) ? json.data : []
    if (rows.length !== texts.length) {
      throw new Error(`外部嵌入端点返回数量不符（期望 ${texts.length}，实际 ${rows.length}）`)
    }
    return rows.map((row) => normalizeVector(Array.isArray(row.embedding) ? row.embedding : []))
  }
}

/** 便捷构造：确保就绪后返回引擎（embed 前必须 await ensureReady）。 */
export async function createEmbeddingEngine(options: EmbeddingServiceOptions): Promise<EmbeddingEngine> {
  const service = new EmbeddingService(options)
  await service.ensureReady()
  return service
}

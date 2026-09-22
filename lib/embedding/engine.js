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
// 并发契约：宿主全局共享一个引擎实例，而索引重建（编排开始）与检索
// （wf_db_query）可能并发发生。就绪探测必须是**单飞**——同一时刻只加载一次
// 本地模型，其余调用者等待同一次加载结果；否则后到者会在加载期间看到
// bm25 降级态，把可用向量错写成非语义 BM25 索引。
//
// 池化策略：bge 系列官方语义为 CLS token 句向量（资产内 1_Pooling 配置
// pooling_mode_cls_token=true），故显式 pooling: 'cls' + normalize: true。
import { fileURLToPath } from 'node:url';
/** L2 归一化（内积即余弦相似度；零向量返回全零）。 */
export function normalizeVector(values) {
    const out = new Float64Array(values.length);
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
        const v = Number(values[i]) || 0;
        out[i] = v;
        sum += v * v;
    }
    const norm = Math.sqrt(sum);
    if (norm > 0) {
        for (let i = 0; i < out.length; i += 1)
            out[i] /= norm;
    }
    return out;
}
/** 向量内积（两向量均归一化时即余弦相似度）。 */
export function dotProduct(a, b) {
    const len = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < len; i += 1)
        sum += a[i] * b[i];
    return sum;
}
/**
 * 嵌入服务实现：按配置与资产可用性惰性选择来源。
 * - ensureReady() 单飞（同一时刻只加载一次），不抛错：降级 bm25 是产品级路径；
 * - embed() 在 bm25 降级态或已释放时抛错（调用方据此降级检索并标注）；
 * - dispose() 释放本地模型（幂等，多调用安全；加载途中释放则加载完成后立即释放模型）。
 */
export class EmbeddingService {
    options;
    source = 'bm25';
    dimension = 0;
    local = null;
    /** 就绪单飞：同一实例的并发就绪/嵌入请求共享同一次加载。 */
    readyPromise = null;
    disposed = false;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * 确保嵌入能力就绪（惰性、幂等、单飞）：
     * remote 端点存在 → 采用 remote；否则尝试本地资产；再失败 → bm25 降级。
     * 加载失败不抛错——降级是产品级路径（界面标注「相似度检索（非语义）」）。
     * 并发调用共享同一次加载（后到者等待，不会看到加载中的 bm25 中间态）。
     */
    async ensureReady() {
        if (this.disposed)
            return this.source;
        this.readyPromise ??= this.prepare();
        return this.readyPromise;
    }
    /** 批量嵌入（单位长度向量）。bm25 降级态或引擎已释放时抛明确错误。 */
    async embed(texts) {
        if (this.disposed)
            throw new Error('嵌入引擎已释放');
        await this.ensureReady();
        // 加载期间引擎可能已被释放：此处复检，避免把「已释放」报成「模型不可用」
        if (this.disposed)
            throw new Error('嵌入引擎已释放');
        if (this.source === 'remote') {
            return this.embedRemote(texts);
        }
        if (this.source === 'local' && this.local) {
            return this.embedLocal(texts);
        }
        throw new Error('本地嵌入模型不可用（资产缺失或加载失败），请使用 BM25 相似度检索');
    }
    /** 释放本地模型（幂等）。 */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        if (this.local?.dispose) {
            try {
                void this.local.dispose();
            }
            catch {
                // 释放尽力而为
            }
        }
        this.local = null;
    }
    /** 就绪准备（单飞入口内的实际加载；只由 ensureReady 触发一次）。 */
    async prepare() {
        if (this.disposed)
            return this.source;
        if (this.options.endpoint) {
            ;
            this.source = 'remote';
            return this.source;
        }
        try {
            const extractor = await this.loadLocal();
            // 释放竞态：加载完成时引擎已被释放——不持有模型引用，立即释放尽到清理责任
            if (this.disposed) {
                try {
                    await extractor.dispose?.();
                }
                catch {
                    // 释放尽力而为
                }
                return this.source;
            }
            this.local = extractor;
            this.source = 'local';
            this.dimension = 512;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.options.logger?.warn(`[visual-workflow] 本地嵌入模型加载失败，降级 BM25 相似度检索：${message}`);
        }
        return this.source;
    }
    /** 解析本地资产目录：显式配置 > 随包分发资产。 */
    resolveModelDir() {
        const explicit = this.options.modelDir?.trim();
        if (explicit)
            return explicit;
        // 编译产物位于 lib/embedding/，随包资产位于包根 assets/——上两级即包根
        return fileURLToPath(new URL('../../assets/models/bge-small-zh-v1.5', import.meta.url));
    }
    /** 惰性加载本地 extractor（加载缝缺省走真实路径：快速失败校验 + 动态 import）。 */
    async loadLocal() {
        const dir = this.resolveModelDir();
        if (this.options.loadExtractor)
            return this.options.loadExtractor(dir);
        // 快速失败：目录/配置缺失时不加载重依赖（transformers.js + onnxruntime），
        // 让降级路径（BM25）零开销——资产未随包分发时避免无谓的模块加载。
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        if (!existsSync(join(dir, 'config.json')) || !existsSync(join(dir, 'tokenizer.json'))) {
            throw new Error(`本地嵌入模型资产缺失：${dir}`);
        }
        // 动态 import：本地模式才加载重依赖（transformers.js + onnxruntime）
        const { pipeline } = await import('@huggingface/transformers');
        const extractor = await pipeline('feature-extraction', dir, {
            dtype: 'q8',
            local_files_only: true,
        });
        return extractor;
    }
    /** 本地推理：CLS 池化 + 归一化，产出 [batch, 512]。 */
    async embedLocal(texts) {
        const out = await this.local(texts, { pooling: 'cls', normalize: true });
        const data = out.data;
        const dim = out.dims?.[1] ?? 0;
        if (!data || dim <= 0)
            throw new Error('本地嵌入输出异常（维度为 0）');
        const vectors = [];
        for (let row = 0; row < out.dims[0]; row += 1) {
            vectors.push(normalizeVector(data.subarray(row * dim, (row + 1) * dim)));
        }
        return vectors;
    }
    /** 外部端点：POST {input: texts}，解析 { data: [{ embedding }] } 并归一化。 */
    async embedRemote(texts) {
        const endpoint = this.options.endpoint;
        const fetchImpl = this.options.fetchImpl ?? fetch;
        const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ input: texts }),
        });
        if (!response.ok) {
            throw new Error(`外部嵌入端点响应异常（HTTP ${response.status}）`);
        }
        const json = (await response.json());
        const rows = Array.isArray(json.data) ? json.data : [];
        if (rows.length !== texts.length) {
            throw new Error(`外部嵌入端点返回数量不符（期望 ${texts.length}，实际 ${rows.length}）`);
        }
        return rows.map((row) => normalizeVector(Array.isArray(row.embedding) ? row.embedding : []));
    }
}
/**
 * 便捷构造：确保就绪后返回引擎（embed 前必须 await ensureReady）。
 * 供非 TS 侧的维护脚本复用「就绪后引擎」这一契约（scripts/build-products-index.mjs）。
 */
export async function createEmbeddingEngine(options) {
    const service = new EmbeddingService(options);
    await service.ensureReady();
    return service;
}
//# sourceMappingURL=engine.js.map
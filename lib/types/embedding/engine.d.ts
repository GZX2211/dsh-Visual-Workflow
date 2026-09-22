/** 嵌入来源：local 本地模型 / remote 外部端点 / bm25 降级（无向量能力）。 */
export type EmbeddingSource = 'local' | 'remote' | 'bm25';
/** 嵌入引擎接口（索引器/数据工具依赖；单测可注入 fake）。 */
export interface EmbeddingEngine {
    /** 当前来源。 */
    readonly source: EmbeddingSource;
    /** 向量维度（bm25 降级时为 0）。 */
    readonly dimension: number;
    /** 批量嵌入（返回单位长度向量；bm25 降级时抛明确错误）。 */
    embed(texts: string[]): Promise<Float64Array[]>;
    /** 释放本地模型等资源（幂等）。 */
    dispose(): void;
}
/** L2 归一化（内积即余弦相似度；零向量返回全零）。 */
export declare function normalizeVector(values: number[] | Float64Array | Float32Array): Float64Array;
/** 向量内积（两向量均归一化时即余弦相似度）。 */
export declare function dotProduct(a: Float64Array, b: Float64Array): number;
/** 本地 transformers.js feature-extraction pipeline 的最小使用面（惰性 import；加载缝亦复用）。 */
export interface LocalExtractorLike {
    (texts: string[], options: {
        pooling: 'cls';
        normalize: true;
    }): Promise<{
        data: Float32Array | Float64Array;
        dims: number[];
    }>;
    dispose?(): Promise<void>;
}
/** 嵌入引擎配置。 */
export interface EmbeddingServiceOptions {
    /** 本地模型资产目录；null 用随包分发资产。 */
    modelDir?: string | null;
    /** 外部 OpenAI 兼容 /embeddings 端点 URL；非空时优先。 */
    endpoint?: string | null;
    /** 日志缝。 */
    logger?: {
        warn(message: string): void;
    };
    /** fetch 实现注入（单测远程端点用；缺省全局 fetch）。 */
    fetchImpl?: typeof fetch;
    /**
     * 本地 extractor 加载缝（单测用受控加载：验证并发单飞与释放竞态）。
     * 缺省走真实路径：资产快速失败校验 + 动态 import transformers.js。
     */
    loadExtractor?: (modelDir: string) => Promise<LocalExtractorLike>;
}
/**
 * 嵌入服务实现：按配置与资产可用性惰性选择来源。
 * - ensureReady() 单飞（同一时刻只加载一次），不抛错：降级 bm25 是产品级路径；
 * - embed() 在 bm25 降级态或已释放时抛错（调用方据此降级检索并标注）；
 * - dispose() 释放本地模型（幂等，多调用安全；加载途中释放则加载完成后立即释放模型）。
 */
export declare class EmbeddingService implements EmbeddingEngine {
    private readonly options;
    readonly source: EmbeddingSource;
    readonly dimension = 0;
    private local;
    /** 就绪单飞：同一实例的并发就绪/嵌入请求共享同一次加载。 */
    private readyPromise;
    private disposed;
    constructor(options?: EmbeddingServiceOptions);
    /**
     * 确保嵌入能力就绪（惰性、幂等、单飞）：
     * remote 端点存在 → 采用 remote；否则尝试本地资产；再失败 → bm25 降级。
     * 加载失败不抛错——降级是产品级路径（界面标注「相似度检索（非语义）」）。
     * 并发调用共享同一次加载（后到者等待，不会看到加载中的 bm25 中间态）。
     */
    ensureReady(): Promise<EmbeddingSource>;
    /** 批量嵌入（单位长度向量）。bm25 降级态或引擎已释放时抛明确错误。 */
    embed(texts: string[]): Promise<Float64Array[]>;
    /** 释放本地模型（幂等）。 */
    dispose(): void;
    /** 就绪准备（单飞入口内的实际加载；只由 ensureReady 触发一次）。 */
    private prepare;
    /** 解析本地资产目录：显式配置 > 随包分发资产。 */
    private resolveModelDir;
    /** 惰性加载本地 extractor（加载缝缺省走真实路径：快速失败校验 + 动态 import）。 */
    private loadLocal;
    /** 本地推理：CLS 池化 + 归一化，产出 [batch, 512]。 */
    private embedLocal;
    /** 外部端点：POST {input: texts}，解析 { data: [{ embedding }] } 并归一化。 */
    private embedRemote;
}
/**
 * 便捷构造：确保就绪后返回引擎（embed 前必须 await ensureReady）。
 * 供非 TS 侧的维护脚本复用「就绪后引擎」这一契约（scripts/build-products-index.mjs）。
 */
export declare function createEmbeddingEngine(options: EmbeddingServiceOptions): Promise<EmbeddingEngine>;

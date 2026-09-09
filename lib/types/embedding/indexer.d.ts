import { type EmbeddingEngine } from './engine.js';
/** 索引内单个分块（向量与文本同存；source 为源记录标识，如「表名」；rowKey 为源记录主键值）。 */
export interface IndexedChunk {
    index: number;
    text: string;
    vector?: number[];
    source: string;
    /** 源记录主键值（用于把命中映射回整行；无则缺省）。 */
    rowKey?: string;
}
/** 索引文件结构（version 1）。 */
export interface VectorIndexFile {
    version: 1;
    dataId: string;
    /** 实际检索模式：embedding 或 bm25（降级）。 */
    source: 'embedding' | 'bm25';
    /** 向量维度（bm25 模式为 0）。 */
    dimension: number;
    chunkSize: number;
    overlap: number;
    updatedAt: string;
    chunks: IndexedChunk[];
}
/** 检索命中。 */
export interface SearchHit {
    index: number;
    text: string;
    score: number;
    /** 源记录主键值（命中映射回整行用；无则缺省）。 */
    rowKey?: string;
}
/** 检索结果。 */
export interface SearchResult {
    hits: SearchHit[];
    source: 'embedding' | 'bm25';
}
/**
 * 简易中英混合分词（BM25 词袋）：
 *   - 连续 ASCII 字母/数字/下划线 → 一个词（小写）；
 *   - 中文字符 → 逐字符成词（汉语无空格，字符粒度最稳）；
 * 其余标点剔除。词序无关（BM25 是词袋模型）。
 */
export declare function tokenizeText(text: string): string[];
/**
 * BM25 检索：query tokens 对全部块打分取 Top-K。
 * idf = ln(1 + (N - df + 0.5)/(df + 0.5))；词频经 k1/b 饱和归一。
 */
export declare function bm25Search(chunks: IndexedChunk[], queryTokens: string[], topK: number): SearchHit[];
/** 索引源记录（rebuild 输入：每条记录独立分块，块携带 source 标识）。 */
export interface IndexRecord {
    /** 记录文本（分块前不做拼接——跨记录语义不应混入同一块）。 */
    text: string;
    /** 源记录标识（如「表名」），回显/审计用。 */
    source?: string;
    /** 源记录主键值（命中时回传，用于映射回整行）。 */
    rowKey?: string;
}
/** 索引重建入参。 */
export interface RebuildInput {
    dataId: string;
    /** 源记录列表；每条独立分块，块携带 source。 */
    records: IndexRecord[];
    /** 嵌入引擎；null 或 bm25 降级态 → 纯文本 BM25 索引。 */
    engine?: EmbeddingEngine | null;
    chunkSize?: number;
    overlap?: number;
}
/**
 * 向量索引：重建/读取/检索/删除（单文件原子持久化）。
 */
export declare class VectorIndex {
    private readonly filePath;
    constructor(filePath: string);
    /**
     * 重建索引（全量替换 + 原子发布）。
     * 嵌入可用时写入向量（source=embedding）；不可用/失败时仅存文本（source=bm25）
     * ——降级是产品级路径，不抛错。
     */
    rebuild(input: RebuildInput): Promise<VectorIndexFile>;
    /** 读取索引文件；不存在返回 null；损坏抛 CorruptJsonError。 */
    load(): Promise<VectorIndexFile | null>;
    /**
     * 检索：embedding 模式用余弦 Top-K；bm25 模式用 BM25 打分。
     * 索引不存在/为空返回 null；查询嵌入失败时回退 BM25（结果标注）。
     * engine 在调用时注入（与 rebuild 的解耦一致；可为 null）。
     * @param options.threshold 相似度阈值（仅保留得分 > 此值；默认 0，兼容原 score>0 语义）。
     */
    search(query: string, topK: number, engine?: EmbeddingEngine | null, options?: {
        threshold?: number;
    }): Promise<SearchResult | null>;
    /** 删除索引文件（数据节点删除时清理，无垃圾残留）。 */
    deleteFile(): Promise<void>;
}

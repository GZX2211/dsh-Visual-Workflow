import type { ExperienceEntry, ExperienceEvaluationEntry, ExperienceEvaluationInsertInput, ExperienceGenerationPromptEntry, ExperienceInsertCheckedInput, ExperiencePatch, ExperienceRetrievalUpdate, ExperienceStatsEntry, ExperienceStatsRebuildInput, ExperienceType, ExperienceUsageRecordInput } from "../shared/asset-types.js";
/**
 * 调用方身份（唯一本体）。
 *
 * 子代理时 `childId` 为官方子代理会话的 agent.id；父代理省略。
 * 父代理的 `sessionId` 即会话 id；子代理的 `sessionId` 为其父会话 id（用于定位运行所属会话）。
 */
export interface ExperienceCaller {
    isChild: boolean;
    sessionId: string;
    childId?: string;
}
/**
 * 召回与判重所需的活跃经验行（纯数据，禁止把 BLOB 暴露为 Buffer 给域层）。
 *
 * 为什么必须同时带两个通道的向量与检索文本：召回按 §8.2 对任务侧与决策侧分别打分后取并集，
 * 判重只看决策侧；两者读的是同一批行，因此由同一次读盘给出，避免重复查询与两批数据不一致。
 */
export interface ExperienceRetrievalRow {
    id: string;
    taskEmbedding: Float64Array;
    taskRetrievalText: string;
    decisionEmbedding: Float64Array;
    decisionRetrievalText: string;
}
/** 经验持久化端口（由资产库适配）。 */
export interface ExperienceStorePort {
    /** 生成经验行 id（前缀 id 规则由资产库持有）。 */
    nextId(): string;
    /** 取某类型当前生效的生成 Prompt；无则 null。 */
    getActivePrompt(type: ExperienceType): Promise<ExperienceGenerationPromptEntry | null>;
    /** 列出全部生成 Prompt（含历史版本与归档）。 */
    listPrompts(): Promise<ExperienceGenerationPromptEntry[]>;
    /** 列出经验行（活跃 + 归档，条目自带 active 标记）。 */
    listRows(limit: number): Promise<ExperienceEntry[]>;
    /** 按 id 取经验行；activeOnly 时归档行不返回。 */
    getRows(ids: string[], options?: {
        activeOnly?: boolean;
    }): Promise<ExperienceEntry[]>;
    /** 取某类型全部活跃行的检索数据（召回与判重共用）。 */
    listActiveEmbeddings(type: ExperienceType): Promise<ExperienceRetrievalRow[]>;
    /** 判重与写入同事务完成；判据由域层注入。 */
    insertChecked(input: ExperienceInsertCheckedInput): Promise<{
        inserted: ExperienceEntry[];
        skipped: Array<{
            reason: string;
            decisionRetrievalText: string;
        }>;
    }>;
    /**
     * 就地改写语义字段并写入域层在事务外算好的检索投影与向量。
     * 必填字段被清空由资产库拒绝（经验没有版本，改坏无从回滚）。
     */
    updateFields(id: string, patch: ExperiencePatch, next: ExperienceRetrievalUpdate): Promise<ExperienceEntry>;
    /** 置活跃 / 归档（两个方向同一操作，避免两套写入路径）。 */
    setActive(id: string, active: boolean): Promise<ExperienceEntry>;
    /**
     * 记录使用事实（经验被显式注入 agent 上下文），同一笔事务内同步 recalled_count。
     *
     * 为什么由持久化端口承担：使用事实是可重建统计的输入之一，必须与「首次建立统计行」原子，
     * 且经验本体不得因统计写入失败而受影响。
     */
    recordUsage(input: ExperienceUsageRecordInput): Promise<{
        recorded: number;
    }>;
    /** 指定主体在给定经验类型下「已被显式注入」的经验 id（feedback 的准入判据；保持入参顺序）。 */
    listInjectedIds(input: {
        subjectId: string;
        experienceType: ExperienceType;
        experienceIds: string[];
    }): Promise<string[]>;
    /**
     * 批量写入评价并重算对应经验的统计（同一笔事务，失败整批回滚）。
     *
     * 聚合器由经验域以闭包注入：公式属经验域且会演进，而「读全部历史 → 聚合 → 写入」必须原子。
     */
    insertEvaluationsChecked(input: ExperienceEvaluationInsertInput): Promise<{
        inserted: ExperienceEvaluationEntry[];
        stats: ExperienceStatsEntry[];
    }>;
    /** 读统计投影（缺行不返回：无统计即「证据不足」，读侧按中性解释，不伪造行）。 */
    getStats(experienceIds: string[]): Promise<ExperienceStatsEntry[]>;
    /**
     * 全量重建统计投影（首次上线 / 调参 / 修复 / 迁移）。
     * 一笔事务内读全部评价与使用事实、重放聚合器、覆盖写入；失败不留半成品。
     */
    rebuildStats(input: ExperienceStatsRebuildInput): Promise<{
        experienceCount: number;
    }>;
}
/**
 * 运行事实端口（由编排器适配）。
 *
 * 语义固定为「当前运行实例内」：会话的活跃 run、子代理所属 run、本 run 内是否启动过协作组。
 */
export interface ExperienceRuntimePort {
    activeRunForSession(sessionId: string): {
        runId: string;
        flowId: string;
        sessionId: string;
    } | null;
    runForChild(childId: string): {
        runId: string;
        flowId: string;
        sessionId: string;
        nodeId: string;
    } | null;
    hasTeamInCurrentRun(sessionId: string): boolean;
    hasActiveRun(sessionId: string): boolean;
    /**
     * 调用方当前使用的模型名（评价的评分者模型，用于未来的评分者校准）。
     *
     * 为什么无法确定时返回空串而不是省略：`evaluator_model` 是评价行的必填列，
     * 而「不知道模型名」是一个真实事实；伪造一个默认模型名会让校准数据变成假证据。
     */
    modelForCaller(caller: ExperienceCaller): string;
}
/**
 * 语义嵌入端口（由嵌入引擎适配）。
 *
 * `source === "bm25"` 表示嵌入能力已退化：此时无向量可用，召回走词法回退、写入直接拒绝，
 * 因此 source 是能力事实而非实现细节，必须在端口上可见。
 */
export interface ExperienceEmbeddingPort {
    readonly source: "local" | "remote" | "bm25";
    readonly dimension: number;
    embed(texts: string[]): Promise<Float64Array[]>;
}

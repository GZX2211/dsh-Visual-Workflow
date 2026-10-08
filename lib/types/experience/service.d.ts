import type { ExperienceEntry, ExperienceGenerationPromptEntry, ExperiencePatch, ExperienceRecallHit, ExperienceType } from "../shared/asset-types.js";
import type { ExperienceCaller, ExperienceEmbeddingPort, ExperienceRuntimePort, ExperienceStorePort } from "./ports.js";
/** 服务依赖（宿主在组合根装配；端口形状见 ./ports.js）。 */
export interface ExperienceServiceDeps {
    store: ExperienceStorePort;
    runtime: ExperienceRuntimePort;
    embedding: ExperienceEmbeddingPort;
    /** 时钟缝（初始化状态时间戳；缺省 Date.now）。 */
    now?: () => number;
    /** 诊断缝：辅助路径（协作组共享上下文召回）失败时留下可诊断信息，不向调用方抛错。 */
    logger?: {
        warn(message: string): void;
    };
}
/** 召回结果：候选阶段（摘要）或详情阶段（完整条目）。 */
export type ExperienceRecallResult = {
    kind: "candidates";
    hits: ExperienceRecallHit[];
    source: "semantic" | "bm25";
} | {
    kind: "details";
    entries: ExperienceEntry[];
};
/** 提交结果（与持久化端口一致：写入条目 + 被判重拦截的说明）。 */
export interface ExperienceSubmitResult {
    inserted: ExperienceEntry[];
    skipped: Array<{
        reason: string;
        decisionRetrievalText: string;
    }>;
}
export declare class ExperienceService {
    private readonly deps;
    private readonly state;
    constructor(deps: ExperienceServiceDeps);
    /** 取当前主体该类型的生效生成 Prompt，并记录初始化态（重复调用幂等）。 */
    initializePrompt(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
    }): Promise<{
        prompt: ExperienceGenerationPromptEntry;
    }>;
    /** 提交候选：校验 → 投影 → 事务外批量嵌入 → 判重与写入（同事务，由端口保证）。 */
    submit(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
        candidates: unknown;
    }): Promise<ExperienceSubmitResult>;
    /** 召回：传 ids 取完整条目（仅活跃）；否则按 query 取候选摘要。 */
    recall(input: {
        caller: ExperienceCaller;
        type: ExperienceType;
        query?: string;
        ids?: string[];
        topK?: number;
    }): Promise<ExperienceRecallResult>;
    /** 保存可编辑字段：事务外重算投影与向量，事务内落库。 */
    update(input: {
        experienceId: string;
        patch: ExperiencePatch;
    }): Promise<ExperienceEntry>;
    /** 归档：退出召回面，内容全部保留。 */
    retire(input: {
        experienceId: string;
    }): Promise<ExperienceEntry>;
    /** 恢复：重新进入召回面。 */
    restore(input: {
        experienceId: string;
    }): Promise<ExperienceEntry>;
    /** 列表（活跃 + 归档；上限由调用方给出，存储侧负责实际截断）。 */
    list(input: {
        limit: number;
    }): Promise<ExperienceEntry[]>;
    /** 释放某会话的初始化状态（run 终态 / 插件卸载；幂等，失败不应阻断终态流程）。 */
    clearSession(input: {
        sessionId: string;
    }): void;
    /**
     * 协作组共享上下文：按 type="team" 召回一次并渲染为同一份文本（无命中返回 null）。
     *
     * 完整职责校检仍然执行（父代理此刻已承担 Team Leader 职责，标记由编排器在调用前落位）。
     * 失败不向调用方抛错——这是 best-effort 辅助路径，绝不阻断协作组启动；失败原因经日志缝
     * 留下可诊断信息（会话/工作流/组 + 具体错误）。
     */
    teamExperienceContext(input: {
        sessionId: string;
        flowId: string;
        groupId: string;
        query: string;
    }): Promise<string | null>;
    /** 取生效生成 Prompt；缺失属配置事实，给出可行动错误。 */
    private requireActivePrompt;
    /** 事务外批量嵌入：单次调用算完本批全部文本，任何失败都不得留下部分写入。 */
    private embedOutOfTransaction;
    /** 组装完整写入行：语义字段来自草稿，检索投影与向量来自事务外计算，provenance 来自运行事实与初始化记录。 */
    private buildInsertRow;
    /** 单次查询嵌入 + 双通道召回 + 按活跃行补齐条目（摘要与共享上下文共用）。 */
    private recallScoredEntries;
}

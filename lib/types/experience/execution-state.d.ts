import type { ExperienceType } from "../shared/asset-types.js";
/** 一条初始化记录（Prompt 行 id 与版本用于经验 provenance）。 */
export interface ExperienceInitializationRecord {
    sessionId: string;
    subjectId: string;
    experienceType: ExperienceType;
    generationPromptId: string;
    generationPromptVersion: string;
    initialized: true;
    /** 首次标记时间（同一主体同一类型重复初始化时保持不变）。 */
    initializedAt: number;
    /** 最近一次刷新时间（重复初始化只刷新这里与 Prompt 版本）。 */
    refreshedAt: number;
}
/** 标记入参。 */
export interface ExperienceInitializationInput {
    sessionId: string;
    subjectId: string;
    experienceType: ExperienceType;
    generationPromptId: string;
    generationPromptVersion: string;
}
/** 状态表构造参数。 */
export interface ExperienceExecutionStateOptions {
    now?: () => number;
    /** 会话数上界（缺省取域常量；最小 1）。 */
    maxSessions?: number;
}
/**
 * 按「会话 → 主体 + 类型」组织的初始化状态表。
 * 读操作返回副本，调用方无法通过返回值改写内部状态。
 */
export declare class ExperienceExecutionState {
    private readonly sessions;
    private readonly now;
    private readonly maxSessions;
    constructor(options?: ExperienceExecutionStateOptions);
    /** 读取初始化记录；未初始化返回 null。 */
    readInitialized(sessionId: string, subjectId: string, experienceType: ExperienceType): ExperienceInitializationRecord | null;
    /** 标记初始化（幂等：同一键重复标记只刷新，不新增记录）。 */
    markInitialized(input: ExperienceInitializationInput): ExperienceInitializationRecord;
    /** 释放某会话的全部记录（run 终态清理）；返回释放条数（幂等）。 */
    clearBySession(sessionId: string): number;
    /** 释放全部记录（插件卸载）。 */
    clearAll(): void;
    /** 当前会话数（诊断与上界断言用）。 */
    get sessionCount(): number;
    /** 当前记录数（诊断与幂等断言用）。 */
    get recordCount(): number;
    /** 会话数超上界时逐出最早会话（Map 迭代顺序即插入顺序）。 */
    private evictOldestSessions;
}

// src/host/experience/execution-state.ts
//
// 初始化状态表（进程内内存）。
//
// 为什么状态在内存而不落盘：它表达的是「本次会话内，某主体是否已经取过该类型的生成 Prompt」，
// 属于运行期协议执行状态而非经验事实；落盘会引入与运行生命周期不一致的持久状态清理问题。
// 状态的释放路径有两条：会话数上界逐出（长驻宿主进程兜底）与插件卸载时整体清空。
// 为什么不随运行终态清理（用户裁决 2026-10-11）：经验体系不得与工作流的运行状态强绑定——
// 按 run 终态失效会让「跑完流程再复盘录入」被迫重新取一次生成 Prompt。
import { MAX_INITIALIZED_SESSIONS } from "./constants.js";
function subjectKey(subjectId, experienceType) {
    return `${subjectId}\u0000${experienceType}`;
}
/**
 * 按「会话 → 主体 + 类型」组织的初始化状态表。
 * 读操作返回副本，调用方无法通过返回值改写内部状态。
 */
export class ExperienceExecutionState {
    sessions = new Map();
    now;
    maxSessions;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.maxSessions = Math.max(1, Math.floor(options.maxSessions ?? MAX_INITIALIZED_SESSIONS));
    }
    /** 读取初始化记录；未初始化返回 null。 */
    readInitialized(sessionId, subjectId, experienceType) {
        const record = this.sessions.get(sessionId)?.get(subjectKey(subjectId, experienceType));
        return record ? { ...record } : null;
    }
    /** 标记初始化（幂等：同一键重复标记只刷新，不新增记录）。 */
    markInitialized(input) {
        let records = this.sessions.get(input.sessionId);
        if (!records) {
            records = new Map();
            this.sessions.set(input.sessionId, records);
            this.evictOldestSessions();
        }
        const key = subjectKey(input.subjectId, input.experienceType);
        const now = this.now();
        const record = {
            sessionId: input.sessionId,
            subjectId: input.subjectId,
            experienceType: input.experienceType,
            generationPromptId: input.generationPromptId,
            generationPromptVersion: input.generationPromptVersion,
            initialized: true,
            initializedAt: records.get(key)?.initializedAt ?? now,
            refreshedAt: now,
        };
        records.set(key, record);
        return { ...record };
    }
    /** 释放全部记录（插件卸载）；幂等。 */
    clearAll() {
        this.sessions.clear();
    }
    /** 当前会话数（诊断与上界断言用）。 */
    get sessionCount() {
        return this.sessions.size;
    }
    /** 当前记录数（诊断与幂等断言用）。 */
    get recordCount() {
        let total = 0;
        for (const records of this.sessions.values())
            total += records.size;
        return total;
    }
    /** 会话数超上界时逐出最早会话（Map 迭代顺序即插入顺序）。 */
    evictOldestSessions() {
        while (this.sessions.size > this.maxSessions) {
            const oldest = this.sessions.keys().next().value;
            if (oldest === undefined)
                return;
            this.sessions.delete(oldest);
        }
    }
}
//# sourceMappingURL=execution-state.js.map
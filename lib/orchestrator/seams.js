// src/host/orchestrator/seams.ts
//
// 编排运行时的依赖缝（DI seams）与公共常量/错误：
//   - 常量：GLOBAL_RUN_CALL_LIMIT（全局调用上限）与 subagent/end 迟到缓冲参数；
//   - WfError：稳定 code 的编排错误（工具层转 isError 工具结果/测试断言共用）；
//   - 依赖缝接口：NodeRunner（节点子代理执行引擎）、AgentHost（父代理服务）、
//     消息/配置/日志缝等——全部经依赖注入接入，单测用 fake 替代；
//   - 基础身份类型：FlowLockInfo（运行锁信息）、CallerInfo（工具调用方身份）、
//     ChildMeta（childId → 运行位置反查）。
// ---------------------------------------------------------------------------
// 常量与错误
// ---------------------------------------------------------------------------
/** 单次运行 wf_run_node 调用总上限（编排护栏）。 */
export const GLOBAL_RUN_CALL_LIMIT = 500;
/**
 * subagent/end 迟到缓冲参数：childIndex 登记的窗口（startNodeTask 派发 → 编排器
 * 拿到 childId 登记）只有数个事件循环轮转，10ms × 20 次 = 200ms 远宽于窗口，
 * 同时有界（不无限重试；超限告警丢弃，避免无主事件常驻）。
 */
export const SUBAGENT_END_RETRY_DELAY_MS = 10;
export const SUBAGENT_END_RETRY_MAX = 20;
/** 编排器错误：稳定 code（工具层转 isError 工具结果/测试断言共用）。 */
export class WfError extends Error {
    code;
    constructor(message, code, extras) {
        super(message);
        this.name = 'WfError';
        this.code = code;
        if (extras)
            Object.assign(this, extras);
    }
}
export const consoleLogger = {
    warn: (message, ...args) => console.warn(message, ...args),
    info: (message, ...args) => console.info(message, ...args),
    debug: (message, ...args) => console.debug(message, ...args),
};
//# sourceMappingURL=seams.js.map
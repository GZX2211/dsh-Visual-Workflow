import type { FlowStore } from '../storage/flow-store.js';
import type { OrchestratorRuntime } from './runtime.js';
/** 看护扫描间隔（旧项目 15s；护栏兜底，非实时通道）。 */
export declare const WATCHDOG_INTERVAL_MS = 15000;
/**
 * 启动全局看护定时器（返回 disposer；host 经 ctx.effect 持有）。
 * 定时扫描 + 父代理回合报错快速路径（agent/error 事件在 index.ts 直接调用）。
 */
export declare function scheduleIdleWatchdog(runtime: OrchestratorRuntime, options?: {
    intervalMs?: number;
}): () => void;
/**
 * 单次看护扫描（抽出便于测试）：空闲超时停（无 inflight 才计）+ 父代理回合出错自动 failed。
 */
export declare function sweepWatchdogOnce(runtime: OrchestratorRuntime): Promise<void>;
/**
 * 宿主重启后对账：把持久化历史里残留的 running/paused 记录标记为 interrupted
 * （进程已死，可恢复）。返回处理的记录数（Host init 时调用；旧项目 reconcileStaleRuns 同构）。
 */
export declare function reconcileStaleRuns(store: FlowStore, options?: {
    now?: () => number;
}): Promise<number>;

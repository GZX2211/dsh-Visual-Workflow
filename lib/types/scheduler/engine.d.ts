import type { RunSnapshot, ScheduledTaskView } from '../shared/types.js';
import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js';
import { SchedulerTaskStore } from './task-store.js';
/** 编排运行时的引擎视图（宿主装配；单测 fake）。 */
export interface SchedulerOrchestrator {
    startRun(input: {
        sessionId: string;
        flowId: string;
        mode?: 'mode1' | 'mode2';
    }): Promise<{
        runId: string;
    }>;
    resumeRun(input: {
        sessionId: string;
        flowId: string;
        fromRunId?: string;
    }): Promise<{
        runId: string;
    }>;
    /** 窗口挂起：run → paused（锁保留、不中断 in-flight）；返回是否挂起成功。 */
    suspendRun(runId: string): Promise<boolean>;
    /** 某工作流当前运行锁（running/paused 保留锁）。 */
    flowLockInfo(flowId: string): {
        runId: string;
        sessionId: string;
        status: string;
    } | null;
    /** run 快照（内存；无则 null）。 */
    runSnapshot(runId: string): {
        status: string;
    } | null;
}
/** 工作流数据层视图（宿主装配 = FlowStore；单测 fake）。 */
export interface SchedulerFlowStore {
    getFlowTemplate(templateId: string): Promise<WorkflowTemplate | null>;
    listWorkflows(sessionId: string): Promise<WorkflowDocument[]>;
    saveWorkflow(flow: WorkflowDocument, sessionId: string): Promise<WorkflowDocument>;
    getRun(runId: string): Promise<RunSnapshot | null>;
}
/** 引擎日志缝（宿主装配 cordis logger；单测可选）。 */
export interface SchedulerLogger {
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}
export interface SchedulerEngineDeps {
    taskStore: SchedulerTaskStore;
    flowStore: SchedulerFlowStore;
    orchestrator: SchedulerOrchestrator;
    sessionProvider: {
        createSession(options: {
            label: string;
            agentPreset?: string;
            cwd?: string;
        }): Promise<string>;
    };
    /** 解析会话工作目录（新会话继承用；不可用时省略）。 */
    sessionCwdOf?(sessionId: string): Promise<string | undefined>;
    /** 时钟注入（测试可控）。 */
    now?(): number;
    /** tick 间隔（缺省 30s；触发/暂停精度分钟级）。 */
    tickMs?: number;
    logger?: SchedulerLogger;
}
/** 默认 tick 间隔（30s：秒级恢复误差可接受，写盘/扫描开销低）。 */
export declare const DEFAULT_TICK_MS = 30000;
/**
 * 调度引擎：定时扫描全部启用任务并执行决策；任务运行时状态在内存缓存 +
 * 关键字段落盘（taskStore.writeRuntime），重启后从 run 磁盘状态重建游标。
 */
export declare class SchedulerEngine {
    private readonly deps;
    /** 内存运行时缓存（taskId → 持久化运行时；启动时装载）。 */
    private readonly runtimes;
    /** 启动时刻（missedTrigger=skip 基准：错过点不补打）。 */
    private startedAtMs;
    private timer;
    private disposed;
    private readonly tickMs;
    private readonly now;
    constructor(deps: SchedulerEngineDeps);
    /** 启动定时器（返回 disposer；幂等）。 */
    start(): () => void;
    /** 停止定时器（对象仍可被 start 再次启动；dispose 后不可）。 */
    dispose(): void;
    /**
     * 任务视图（API listSchedulerTasks）：持久化任务 + 运行态合并。
     * 运行态优先取内存缓存；未装载（引擎启动前/测试）时用磁盘运行时落盘值派生。
     */
    listViews(): Promise<ScheduledTaskView[]>;
    /**
     * 单次全量扫描（定时器与测试共用入口）：逐任务执行决策。
     * 任务间相互独立：单任务失败记录 lastError 后继续下一任务。
     */
    sweep(): Promise<void>;
    /** 手工删除任务后的运行时解绑（API 层调用；不中断运行中 run）。 */
    forgetTask(taskId: string): Promise<void>;
    private runtimeOf;
    private persist;
    /** 清空引擎本轮引用（交还控制权：run 终态/用户接管）。 */
    private clearRound;
    private runTaskOnce;
    /** 触发执行：模板 → 实例（会话策略分派 + 每会话单实例覆盖）→ startRun。 */
    private fire;
    /** 窗口 end 挂起：run → paused（锁保留、不中断在执行的子代理），等待下一窗口续跑。 */
    private suspendByWindow;
    /** 窗口 start 续跑：resumeRun（现有断点续跑机制；新 runId 接管锁）。 */
    private resumeWindowPaused;
    /** 触发点消费（运行中场景：concurrency=skip 丢弃触发，仅推进游标）。 */
    private consumeDueTrigger;
}

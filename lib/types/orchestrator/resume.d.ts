import type { FlowStore } from '../storage/flow-store.js';
import type { WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
/**
 * 可恢复的 run 状态集合：
 *   paused=暂停门/窗口挂起断点；interrupted=宿主重启中断；stopped=用户停止（可续跑修正）。
 * 导出供运行时断点定位复用（runtime-base.ensureActiveRun 的磁盘兜底扫描与静默接续），
 * 避免两处各自维护一份可恢复状态清单而产生漂移。
 */
export declare const RESUMABLE_STATUSES: readonly ["paused", "interrupted", "stopped"];
/** 断点续跑入参（工具路径静默接续与端点/调度器显式续跑共用）。 */
export interface ResumeInput {
    sessionId: string;
    flowId: string;
    /** 指定恢复的旧 run id；缺省取该工作流最近的可恢复记录。 */
    fromRunId?: string;
    /**
     * 静默接续（工具路径专用）：跳过向父代理注入编排指令的唤醒动作。
     * 为什么需要：父代理调用 wf_* 工具时正处于自身回合内（root 忙碌），而「注入编排指令
     * 唤醒父代理」要求父代理空闲让位——工具路径本就由父代理自行调度，不需要也不应再
     * 注入一份编排指令。缺省 false：工作台「运行/恢复」、调度器与模式二服务等显式启动
     * 语义仍按原样注入编排指令唤醒父代理。
     */
    silent?: boolean;
}
/** 断点续跑结果。 */
export interface ResumeResult {
    runId: string;
    /** 流程事实源文件绝对路径（编排指令 facts.definitionPath）。 */
    defPath: string;
    /** 实际恢复的旧 run id。 */
    resumedFromRunId: string;
}
/**
 * 查找可恢复的 run：
 *   - fromRunId 指定：磁盘记录必须存在且归属会话/工作流匹配且状态可恢复；
 *   - 未指定：该工作流最近（startedAt 倒序）的可恢复记录。
 * 查无返回 null（由调用方区分「无断点」与「指定 run 不可恢复」两类语义）。
 */
export declare function findResumableRun(store: FlowStore, input: ResumeInput): Promise<RunSnapshot | null>;
/**
 * 构建继承快照（纯函数）：
 *   - 节点清单以「当前工作流」为准（恢复前画布可能已编辑）；
 *   - 旧 run 中 ok/react-capped 的节点继承状态、完整输出与摘要（resumed=true）；
 *   - 其余节点回退 pending（attempts/时间戳/输出清零），恢复后重新执行；
 *   - 断点字段：resumedFromRunId 追溯链、resumeFromNodeId 续跑起点。
 */
export declare function buildResumedSnapshot(input: {
    prev: RunSnapshot;
    runId: string;
    flow: WorkflowDocument;
    sessionId: string;
    mode: 'mode1' | 'mode2';
    now?: number;
}): RunSnapshot;

import type { FlowStore } from '../storage/flow-store.js';
import type { WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
/** 断点续跑入参（runResume 端点与 run 端点自动续跑共用）。 */
export interface ResumeInput {
    sessionId: string;
    flowId: string;
    /** 指定恢复的旧 run id；缺省取该工作流最近的可恢复记录。 */
    fromRunId?: string;
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

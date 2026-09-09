import type { WorkflowDocument } from '../shared/graph-model.js';
import type { NodeRunStatus, RunSnapshot, RunStatus } from '../shared/types.js';
/** 输出摘要截断上限（字符，架构文档 §6.1 nodes[].outputSummary；需求 §4.7 规则 7）。 */
export declare const OUTPUT_SUMMARY_LIMIT = 6000;
/** run 状态中文文案（错误提示/历史面板共用）。 */
export declare function statusText(status: RunStatus): string;
/** 文本截断：超限时保留前缀并追加中文截断标记（与旧项目 truncate 同语义）。 */
export declare function truncateText(text: unknown, limit: number): string;
/**
 * 创建全新 run 快照（§6.1 逐字段）：全部节点 pending、attempts 0、无输出。
 * 断点字段（resumedFromRunId/resumeFromNodeId）由续跑任务（T-027）回填。
 */
export declare function createRunSnapshot(input: {
    /** run 稳定标识。 */
    runId: string;
    /** 起始工作流（节点清单来源；节点快照=全量节点）。 */
    flow: WorkflowDocument;
    /** 归属会话。 */
    sessionId: string;
    /** 运行模式。 */
    mode: 'mode1' | 'mode2';
    /** 时钟注入（测试可控；缺省 Date.now）。 */
    now?: number;
}): RunSnapshot;
/** setNodeStatus 的可选参数（全部缺省即纯状态切换）。 */
export interface SetNodeStatusOptions {
    /** 覆盖尝试计数（wf_run_node 每次调用递增）。 */
    attempts?: number;
    /** 节点完整输出（status='ok'|'react-capped' 时写入：完整输出截断到 outputFullLimit、摘要截断到 6000 字）。 */
    output?: string;
    /** 完整输出持久化字节上限（缺省 100KB）。 */
    outputFullLimit?: number;
    /** 时钟注入（时间戳字段用）。 */
    now?: number;
    /**
     * 回合终止原因（P2-5）：stop/interrupt/fail/react-capped/completed。
     * 写入该回合记录（turns[]）与节点级 stopReason，供父代理区分「用户停止」与「异常失败」。
     */
    stopReason?: string;
    /**
     * 是否记为一次回合收尾（P0-2）：true 时在 nodes[].turns[] 追记一回合
     * （startedAt=entry.startedAt、endedAt=now、stopReason、outputSummary），并刷新
     * endedAt 为最近完成时间（不再冻结在首次完成）。
     */
    recordTurn?: boolean;
}
/**
 * 更新快照中某节点的运行状态（与旧项目 setNodeStatus 同语义，扩展 armed/回合明细）：
 *   - running 且无 startedAt → 补开始时间；
 *   - armed（待命，协作组成员回合结束但仍可被唤醒）：记结束时间、刷新 endedAt，但不写 output；
 *   - ok/fail/skipped/react-capped 且无 endedAt → 补结束时间；
 *   - ok 与 react-capped（软截停正常产出，T-022）均回写完整输出（output）与展示摘要
 *     （outputSummary）——react-capped 不是失败，产出与 ok 同等对待；
 *   - recordTurn=true 时追记回合明细，endedAt 随最近回合刷新（P0-2，不再冻结）。
 */
export declare function setNodeStatus(snapshot: RunSnapshot, nodeId: string, status: NodeRunStatus, options?: SetNodeStatusOptions): void;
/**
 * 终态化节点清单（运行收尾/终止时调用）：从未启动的 pending → skipped，
 * 正在执行的 running → fail（非 ok 不继承，续跑时重试，见文件头语义说明）；
 * 待命 armed（仍在协作组内可唤醒）→ 运行收尾即视为可唤醒状态结束，normalize 为 ok
 * （已产出回合，非失败）。
 * @param stopReason 终止原因（stop/interrupt/fail/…），写入仍在 running 的节点的回合记录，
 *                   供父代理区分「用户停止」与「异常失败」，避免误重启（P2-5）。
 */
export declare function terminalizeNodes(snapshot: RunSnapshot, now?: number, stopReason?: string): void;
/** 深拷贝快照（对外只读查询用，防调用方改写内部状态）。 */
export declare function cloneSnapshot(snapshot: RunSnapshot): RunSnapshot;
/**
 * 从官方 subagent/end 的 lastAssistantMessage（ContentBlock[]）提取纯文本。
 * 只认 { type: 'text', text } 块（官方 §8 #21 取证）；limit 为 0/负值时不截断。
 */
export declare function lastAssistantText(blocks: unknown, limit: number): string;

import { type AskAgentArgs, type AskAgentDelivery, type AskAgentResult } from './ask-protocol.js';
import { type CallerInfo } from './seams.js';
import { RuntimeExecute } from './runtime-execute.js';
export declare class RuntimeComm extends RuntimeExecute {
    /** 校验调用者会话存在运行且 running（ask/reply 共用；子代理不在此拒绝）。 */
    private requireRunningRun;
    /**
     * 节点 id → 本 run 的子代理会话 id 反查（协作成员稳定寻址，O(1)，P2-4）。
     * 借助 childByNode（nodeId → childId）反向索引命中；命中后仍需按
     * sessionId/flowId 归属校验（同一 nodeId 可能被不同 run/会话登记）。
     * 目标未启动/不属于本 run 返回 null（调用方按 WF_ASK_TARGET_UNKNOWN 处理）。
     */
    private childForNode;
    /**
     * 构造 WF_ASK_TARGET_UNKNOWN 的可行动提示（P2-3）：按情形区分并给出下一步指向。
     *   - 目标等于发起者自身 → 提示不可自投；
     *   - 目标是本工作流节点但未/非本 run 启动 → 提示该成员可能尚未被父代理调度，请稍后重试或请父代理调度；
     *   - 目标不匹配任何成员 → 列出发起者协作块中的可用成员 id。
     */
    private targetUnknownHint;
    /**
     * wf_ask_agent：Agent 间协作通信（ask/reply 两态协议，非阻塞）。
     *   - ask：子代理 A 向同运行节点子代理 B 投递协作消息并登记待回复，
     *     随即返回受理凭证（{cmd:'ask', askId, from, to}）；A 不挂起、继续执行；
     *     投递经 delivery 缝（在线 steer 插队 / 冷态 followup 冷恢复）；
     *   - reply：目标 B 答复，回复文本经同一投递缝反向投递给发起者 A
     *     （作为新消息抵达，由 A 的后续回合处理）；
     * 强校验（越权拒绝）：运行锁 + childIndex 表内所有权 + 会话归属，全程写审计日志。
     * 待回复登记按 TTL 惰性清理：到期记录在下次调用时被移除，其 askId 不再接受 reply。
     */
    wfAskAgent(caller: CallerInfo, childId: string, args: AskAgentArgs, delivery: AskAgentDelivery, callerSignal?: AbortSignal): Promise<AskAgentResult>;
    /**
     * TTL 惰性清理过期待回复登记（无定时器；ask 不挂起故无可裁决的受体）。
     * 到期记录静默移除：其 askId 不再接受 reply，审计由宿主日志承载。
     */
    private sweepExpiredAsks;
    /** 写协作通信审计日志（越权校验的可追溯性）：只落宿主日志，不在内存驻留审计链。 */
    private auditAsk;
}

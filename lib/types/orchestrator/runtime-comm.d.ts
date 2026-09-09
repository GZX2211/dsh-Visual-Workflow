import { type AskAgentArgs, type AskAgentDelivery, type AskAgentResult } from './ask-types.js';
import { type CallerInfo } from './seams.js';
import { RuntimeExecute } from './runtime-execute.js';
export declare class RuntimeComm extends RuntimeExecute {
    /** 校验调用者会话存在运行且 running（ask/reply/resolve 共用；子代理不在此拒绝）。 */
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
     * wf_ask_agent：Agent 间阻塞通信（ask/reply/resolve 三态协议）。
     *   - ask：子代理 A 向同运行节点子代理 B 发起协作消息并阻塞等待回复；
     *     投递经 delivery 缝（在线 steer 插队 / 冷态 followup 冷恢复）；
     *   - reply：目标 B 回复，解除 A 的阻塞（工具结果 = 回复文本）；
     *   - resolve：父代理对超时 ask 裁决（continue 重启计时 / resend 重发 / abort
     *     让 A 以超时错误继续）。
     * 强校验（越权拒绝）：运行锁 + childIndex 表内所有权 + 会话归属，全程写审计日志。
     * 超时后 A 仍挂起，等待父代理裁决；运行终止/插件卸载时全部挂起 ask 以
     * WF_CANCELLED 释放。
     */
    wfAskAgent(caller: CallerInfo, childId: string, args: AskAgentArgs, delivery: AskAgentDelivery, callerSignal?: AbortSignal): Promise<AskAgentResult>;
    /** 协作通信超时：置 timed-out 并把超时详情通知父代理（A 继续挂起等裁决）。 */
    private onAskTimeout;
    /** 写协作通信审计：内存审计链 + 宿主日志（越权校验的可追溯性）。 */
    private auditAsk;
}

import { type SendMessageArgs, type SendMessageDelivery, type SendMessageResult } from './send-message-protocol.js';
import { type CallerInfo } from './seams.js';
import { RuntimeExecute } from './runtime-execute.js';
export declare class RuntimeComm extends RuntimeExecute {
    /**
     * wf_send_message：投递一条单向持久消息，随即返回投递结果（不等待回复）。
     *
     * 寻址面只有两种形态（用户裁决 2026-10）：
     *   - `parent`：本会话 root（父代理）。调用方即父代理时拒绝（不可自投）；
     *   - `<nodeId>`：本 run 的节点成员。命中 childIndex 后按「是否 Team 成员 + 官方 Team
     *     是否可用」选择投递通道：成员走官方 Team 服务（成员名寻址），否则走普通子代理
     *     （在线插队 / 离线冷恢复）。
     *
     * 校验（越权拒绝，全程写审计）：运行锁 + 发送方必须是本 run 当前在编节点
     * （父代理即会话 root，子代理经 childIndex 归属校验并拒绝已退役 child）+ 目标必须
     * 属于本 run 且已启动。**不做 ACL**：可通信清单只告知不授权（可见面即权限面）。
     */
    wfSendMessage(caller: CallerInfo, childId: string, args: SendMessageArgs, delivery: SendMessageDelivery, callerSignal?: AbortSignal): Promise<SendMessageResult>;
    /**
     * 发送方身份（父代理 = 会话 root；子代理 = 本 run 当前在编节点子代理）。
     *
     * 拒绝的两种情形都是「不是本 run 的当前执行者」：陌生子代理（冒名）与已退役 child
     * （配置重建后被替换的旧子代理——它仍可能在收尾，但消息会挂到错误回合）。
     */
    private senderOf;
    /** 节点人类可读名称（读不到画布时退回 nodeId）。 */
    private nodeLabelOf;
    /**
     * WF_SEND_TARGET_UNKNOWN 的可行动提示（按情形区分）。
     *
     * 措辞红线（用户裁决 2026-10）：**不得引导子代理使用 wf_run_node**——子代理既没有该
     * 工具也不应知道它。目标未启动时就直说「该成员未启动，你不可以对其投递消息」。
     */
    private targetUnknownText;
    /** 投递并写审计：成功返回投递状态；失败显式上抛 WF_SEND_DELIVERY_FAILED（可重试）。 */
    private deliverSending;
    /** 校验调用者会话存在运行且 running（父代理与子代理调用方共用）。 */
    private requireRunningRun;
    /**
     * 节点 id → 本 run 的子代理会话 id 反查（成员稳定寻址，O(1)）。
     * 借助 childByNode（nodeId → childId）反向索引命中；命中后仍需按
     * sessionId/flowId 归属校验（同一 nodeId 可能被不同 run/会话登记）。
     * 目标未启动/不属于本 run 返回 null（调用方按 WF_SEND_TARGET_UNKNOWN 处理）。
     */
    private childForNode;
}

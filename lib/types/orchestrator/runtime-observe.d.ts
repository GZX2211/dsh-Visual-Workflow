import type { SubagentEndInfo } from './run-entry.js';
import { RuntimeComm } from './runtime-comm.js';
export declare class RuntimeObserve extends RuntimeComm {
    /**
     * 子代理结束观察：
     *   - 运行快照：completed → 节点 ok（outputSummary 取最后一条 assistant 文本）；
     *     error/aborted 等 → 节点 fail；max-tokens 亦为 fail（内容被硬截断，Bug 19）；
     *   - 已退役 child（被重建替换的旧子代理）的事件静默丢弃，不参与节点结论；
     *   - 清空 inflight、刷新 lastActiveAt（避免空闲看护误停）；
     *   - 唤醒 wait:true 阻塞等待器（ok/fail + output）。
     * 只观察 DSH 事件，不向父代理注入任何额外内容——父代理继续推进由官方汇报链路驱动。
     * 暂停中的运行（paused）同样回写节点状态（该节点确实完成了）。
     */
    handleSubagentEnd(info: SubagentEndInfo): Promise<void>;
    /**
     * 迟到 subagent/end 有界重试：等待 childIndex 完成登记后重放事件。
     * 防御性兜底——正常路径事件必然晚于登记到达，重试一次即命中；
     * 连续超限（20 次/200ms）说明 childId 无主（run 已清理），告警后丢弃。
     */
    private deferSubagentEnd;
    /**
     * 成员回合结束的「待命（armed）」判定——成员运行的权威读源是**官方 roster**。
     *
     * 语义：成员一轮产出结束、但在团队内仍可被 send_message 唤醒，故不是终态。
     *   - 官方 Team 可用：查官方成员状态，只有 `inactive`（当前无回合在执行）才算待命；
     *     running/provisioning 说明仍在执行或创建，failed 说明成员已不可用（落 ok 会掩盖失败）。
     *   - 官方不可用（成员已降级为普通可延续子代理）：退回图判定——是团队成员即待命。
     * 查询/读图失败时保守返回 false（不阻断回写，落 ok，保留旧行为）。
     *
     * Team 卡片（包裹层）不参与运行事实：本层不再聚合、不再写组状态（用户裁决 2026-10）。
     */
    private teamMemberArmed;
}

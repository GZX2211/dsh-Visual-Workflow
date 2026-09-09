import type { SubagentEndInfo } from './run-types.js';
import { RuntimeComm } from './runtime-comm.js';
export declare class RuntimeObserve extends RuntimeComm {
    /**
     * 子代理结束观察：
     *   - 运行快照：completed/max-tokens → 节点 ok（outputSummary 取最后一条 assistant 文本）；
     *     error/aborted 等 → 节点 fail；
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
     * 协作组聚合：某成员产出一轮后，若其所属协作组全部成员均已「产出一轮」
     * （armed/ok/react-capped），且该组当前无挂起/超时 ask，把组卡片标记为 ok
     * （只影响运行回显，不干预父代理调度）。组卡片单向推进：仅 pending → ok；
     * 成员后续重试/失败不回退组卡片。流程读取失败时跳过聚合（下一次成员完成事件重试）。
     */
    private markGroupOkIfComplete;
    /**
     * 判断某 agent 节点是否属于某协作组（P0-1：组成员回合结束落 armed 而非 ok）。
     * 流程读取失败时保守返回 false（不阻断，落 ok，保留旧行为）。
     */
    private isGroupMemberOf;
}

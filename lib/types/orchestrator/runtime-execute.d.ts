import { type FinishArgs, type FinishResult, type RunNodeArgs, type RunNodeResult } from './run-entry.js';
import { type CallerInfo } from './seams.js';
import { RuntimeLaunch } from './runtime-launch.js';
export declare class RuntimeExecute extends RuntimeLaunch {
    /** 校验调用者为「当前会话根 Agent」并取可直接执行节点的激活运行（必要时静默接续）。 */
    private requireRootRun;
    /**
     * wf_run_node：启动一个角色节点的子代理。
     *   - 默认异步（模式一）：立即返回 { nodeId, status:'started', childId }；
     *   - wait:true 阻塞（模式二）：等待该节点子代理完成，返回 { nodeId, status:'ok'|'fail', childId, output }；
     *   - 暂停节点：触发暂停门（run=paused + 断点持久化 resumeFrom=暂停节点，锁保留）；
     *   - 本会话停在 paused/stopped/interrupted 断点时：**先静默接续**（新 run 接管锁，
     *     不注入编排指令）再执行本次调度——父代理在自己的回合内即可自行恢复，
     *     人工点「运行」不再是必需动作。
     */
    wfRunNode(caller: CallerInfo, args: RunNodeArgs, callerSignal?: AbortSignal, options?: {
        expectedMode?: 'mode1' | 'mode2';
    }): Promise<RunNodeResult>;
    /**
     * 协作组节点执行：把整组启动为官方 Agent Team。
     *
     * 语义边界：
     *   - 成员数量与成员级参数（角色提示词/模型/工具白名单）由画布与子代理引擎决定，
     *     本方法只负责解析成员、组装成员任务块、登记事件归属与快照状态；
     *   - 协作过程（消息邮箱、任务板、等待、中断、成员状态）全部由官方机制负责，
     *     本方法不注入任何协作协议文本；
     *   - 官方团队不可用时不擅自启动成员：报可行动错误，指示父代理逐个启动成员节点
     *     （既有语义），避免两条路径同时存在导致成员被启动两次。
     *   - 成员会话是官方 Lead（会话根 Agent）的直接可延续子代理，其 subagent/end 事件
     *     经 childIndex 回写成员节点状态，组卡片由既有聚合逻辑标 ok。
     *
     * @param run - 当前运行条目。
     * @param flow - 最新工作流快照。
     * @param group - 协作组节点。
     * @param args - 工具入参（thinking / iterationLimit / retryLimit 作用于本组）。
     * @returns started 路径结果（含成员清单；一个组对应多个成员会话，故无单一 childId）。
     */
    private runGroupNode;
    /**
     * wf_finish：父代理收尾信号 → 写完成/失败记录并释放运行锁。幂等。
     * 运行锁降权（用户裁决）：本会话停在 paused/stopped/interrupted 断点时先静默接续接管
     * （只接管运行事实与锁，不注入编排指令），父代理可确认流程已走完后直接收尾，
     * 不再报 WF_NO_ACTIVE_RUN；只有「本会话既无激活运行也无任何可恢复断点」才按旧语义
     * 返回终态幂等/报错。
     */
    wfFinish(caller: CallerInfo, args: FinishArgs): Promise<FinishResult>;
}

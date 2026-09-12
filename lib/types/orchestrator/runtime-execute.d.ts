import { type FinishArgs, type FinishResult, type RunNodeArgs, type RunNodeResult } from './run-types.js';
import { type CallerInfo } from './seams.js';
import { RuntimeLaunch } from './runtime-launch.js';
export declare class RuntimeExecute extends RuntimeLaunch {
    /** 校验调用者为「当前会话根 Agent」并取可直接执行节点的激活运行（必要时自动续跑）。 */
    private requireRootRun;
    /**
     * wf_run_node：启动一个角色节点的子代理。
     *   - 默认异步（模式一）：立即返回 { nodeId, status:'started', childId }；
     *   - wait:true 阻塞（模式二）：等待该节点子代理完成，返回 { nodeId, status:'ok'|'fail', childId, output }；
     *   - 暂停节点：触发暂停门（run=paused + 断点持久化 resumeFrom=暂停节点，锁保留）；
     *   - 本会话停在 paused/stopped/interrupted 断点时：**先自动续跑**（新 run 接管锁 +
     *     注入断点继续指令）再执行本次调度——用户在工作台点「运行」不再是必需动作。
     */
    wfRunNode(caller: CallerInfo, args: RunNodeArgs, callerSignal?: AbortSignal, options?: {
        expectedMode?: 'mode1' | 'mode2';
    }): Promise<RunNodeResult>;
    /**
     * wf_finish：父代理收尾信号 → 写完成/失败记录并释放运行锁。幂等。
     * 运行锁降权（用户裁决）：本会话停在 paused/stopped/interrupted 断点时先自动续跑接管
     * （父代理在续跑指令下重新读到事实源、确认流程已走完后收尾），不再报 WF_NO_ACTIVE_RUN；
     * 只有「本会话既无激活运行也无任何可恢复断点」才按旧语义返回终态幂等/报错。
     */
    wfFinish(caller: CallerInfo, args: FinishArgs): Promise<FinishResult>;
}

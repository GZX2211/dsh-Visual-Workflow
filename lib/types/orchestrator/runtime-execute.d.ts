import { type FinishArgs, type FinishResult, type RunNodeArgs, type RunNodeResult } from './run-types.js';
import { type CallerInfo } from './seams.js';
import { RuntimeLaunch } from './runtime-launch.js';
export declare class RuntimeExecute extends RuntimeLaunch {
    /** 校验调用者为「当前会话根 Agent」且处于激活运行；返回 run entry。 */
    private requireActiveRootRun;
    /**
     * wf_run_node：启动一个角色节点的子代理。
     *   - 默认异步（模式一）：立即返回 { nodeId, status:'started', childId }；
     *   - wait:true 阻塞（模式二）：等待该节点子代理完成，返回 { nodeId, status:'ok'|'fail', childId, output }；
     *   - 暂停节点：触发暂停门（run=paused + 断点持久化 resumeFrom=暂停节点，锁保留）。
     */
    wfRunNode(caller: CallerInfo, args: RunNodeArgs, callerSignal?: AbortSignal, options?: {
        expectedMode?: 'mode1' | 'mode2';
    }): Promise<RunNodeResult>;
    /** wf_finish：父代理收尾信号 → 写完成/失败记录并释放运行锁。幂等。 */
    wfFinish(caller: CallerInfo, args: FinishArgs): Promise<FinishResult>;
}

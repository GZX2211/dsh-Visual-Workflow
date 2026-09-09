import type { RunEntry, TerminateOptions } from './run-types.js';
import { RuntimeObserve } from './runtime-observe.js';
export declare class RuntimeLifecycle extends RuntimeObserve {
    /**
     * 统一终止运行：中止控制器（含阻塞中的 wait/提问）、尽力中断运行中子代理、
     * 写终态、持久化、释放锁（内存锁随状态自然释放）。幂等。
     * 终态条目随即从内存 runs 表释放（历史记录在磁盘，由 FlowStore 提供），
     * 防止长期运行内存膨胀；running/paused 条目保留（续跑/锁查询需要）。
     */
    terminateRun(entry: RunEntry, options: TerminateOptions): Promise<boolean>;
    /** 用户停止运行（控制栏停止按钮；幂等）。 */
    stopRun(runId: string): Promise<void>;
    /**
     * 外部挂起运行（定时任务执行窗口 end：新功能本阶段，见 prompt/定时任务开发.md）：
     *   - run → paused（保留运行锁，断点可续跑——与暂停节点同态）；
     *   - 不中断正在执行的子代理（「等待仍在执行的角色节点执行完毕」：paused 态下
     *     subagent/end 仍回写节点状态）；下一个角色节点由 requireActiveRootRun 的
     *     WF_PAUSED 拦下（父代理不再调度新节点）；
     *   - 续跑走现有 resumeRun（下一窗口 start 注入「继续运行」指令）。
     * 幂等：非 running 返回 false（引擎按「轮次结束」处理）。
     */
    suspendRun(runId: string, options?: {
        summary?: string;
    }): Promise<boolean>;
    /** 父代理回合以 error 结束（编排已死）→ 自动把运行标记为 failed。 */
    failRunForParentError(entry: RunEntry, error: unknown): Promise<void>;
}

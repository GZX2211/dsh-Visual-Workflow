import { type ResumeInput, type ResumeResult } from './resume.js';
import type { StartRunOptions, StartRunResult } from './run-types.js';
import { RuntimeBase } from './runtime-base.js';
export declare class RuntimeLaunch extends RuntimeBase {
    /**
     * 启动一次「父代理编排」运行（模式一入口）。
     * 流程：校验 → 运行锁 → 建 run 状态 → 写流程事实源文件 → 构造编排指令 →
     * followup 一次性注入+唤醒父代理 → 开始即落盘（崩溃后历史可追溯）。
     * 工作台全局化改版：运行唯一逻辑 = 运行当前实例——run 会话即实例绑定的会话
     * （run.sessionId === instance.sessionId）；「开启新会话」只是创建实例时的
     * 一次性动作（createSession 端点），运行时不再新建会话。
     */
    startRun(input: {
        sessionId: string;
        flowId: string;
    } & StartRunOptions): Promise<StartRunResult>;
    /**
     * 断点续跑：从 paused/interrupted 的旧 run 创建新 run（resumedFromRunId 继承链）。
     * 已 ok/react-capped 节点继承状态与完整产出（resumed 标记，不重跑），其余节点
     * 回退 pending 重新执行；断点产出随继承快照重新可用（后续节点 ctx 注入直接用
     * 新快照，无需额外回填通道）。
     * 旧 paused 记录保留在磁盘历史（状态不变），内存条目释放——运行锁随新 run 接管。
     */
    resumeRun(input: ResumeInput): Promise<ResumeResult>;
}

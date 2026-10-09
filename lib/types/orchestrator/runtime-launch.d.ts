import { type ResumeInput, type ResumeResult } from './resume.js';
import { type CollabChannel } from '../prompts/index.js';
import type { StartRunOptions, StartRunResult } from './run-entry.js';
import { RuntimeBase } from './runtime-base.js';
export declare class RuntimeLaunch extends RuntimeBase {
    /**
     * 协作通道判定（编排指令与成员任务块的唯一分支依据）：
     * 官方 Agent Team 可用（服务已挂载 + 根 Agent 存活 + 有可用 provider）→ official；
     * 否则 legacy（父代理逐个启动成员节点，成员间用插件自建协作工具）。
     * 判据由子代理引擎提供，编排器不直接触达官方服务。
     */
    protected collabChannelOf(sessionId: string): CollabChannel;
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
     * 断点续跑：从 paused/interrupted/stopped 的旧 run 创建新 run（resumedFromRunId 继承链）。
     * 已 ok/react-capped 节点继承状态与完整产出（resumed 标记，不重跑），其余节点
     * 回退 pending 重新执行；断点产出随继承快照重新可用（后续节点 ctx 注入直接用
     * 新快照，无需额外回填通道）。
     * 旧 paused 记录保留在磁盘历史（状态不变），内存条目释放——运行锁随新 run 接管。
     *
     * 两条调用语义（input.silent 区分）：
     *   - 显式启动（工作台「运行/恢复」、调度器、模式二服务）：注入编排指令唤醒父代理，
     *     故要求父代理空闲（root.status !== 'running'，否则 WF_ROOT_BUSY）；
     *   - 静默接续（工具路径，见 ensureActiveRun）：父代理正在自身回合内调用 wf_* 工具，
     *     只接管运行事实与锁，不注入编排指令、不要求父代理空闲。
     * 两条语义共用同一套校验、快照继承与事实源写入——区别仅在「是否注入指令」。
     */
    resumeRun(input: ResumeInput): Promise<ResumeResult>;
}

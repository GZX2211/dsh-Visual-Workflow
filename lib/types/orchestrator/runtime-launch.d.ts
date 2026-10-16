import { type ResumeInput, type ResumeResult } from './resume.js';
import type { StartRunOptions, StartRunResult } from './run-entry.js';
import { RuntimeBase } from './runtime-base.js';
export declare class RuntimeLaunch extends RuntimeBase {
    /**
     * 启动预留表（flowId → 启动在途）。
     * 为什么需要：运行锁的「开头护栏」与「登记前重检」之间跨越多个 await（读文档/完整性
     * 校验/注入父代理配置——后者要读 .md 文件），两个并发 startRun 都会全程做完这些工作，
     * loser 直到登记前的同步重检才被拒。此处把互斥提前到第一个异步点之前（同步登记），
     * loser 不再产生任何无效工作。预留只覆盖 startRun 自身生命周期；登记之后的运行期
     * 仍由运行锁（runs 表）负责，两者语义不同、必须并存。
     */
    private readonly launching;
    /**
     * 启动一次「父代理编排」运行（模式一入口）。
     * 流程：校验 → 运行锁 + 并发启动预留 → 建 run 状态（含编排基线）→ 构造编排指令 →
     * followup 一次性注入+唤醒父代理 → 开始即落盘（崩溃后历史可追溯）。
     * 工作台全局化改版：运行唯一逻辑 = 运行当前实例——run 会话即实例绑定的会话
     * （run.sessionId === instance.sessionId）；「开启新会话」只是创建实例时的
     * 一次性动作（createSession 端点），运行时不再新建会话。
     */
    startRun(input: {
        sessionId: string;
        flowId: string;
    } & StartRunOptions): Promise<StartRunResult>;
    /** startRun 本体（launching 预留保护下运行；护栏与预留语义见 startRun）。 */
    private startRunReserved;
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
     * 两条语义共用同一套校验、快照继承与编排基线初始化——区别仅在「是否注入指令」。
     */
    resumeRun(input: ResumeInput): Promise<ResumeResult>;
}

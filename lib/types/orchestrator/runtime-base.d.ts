import type { WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot, RunStatus } from '../shared/types.js';
import { type ResumeResult } from './resume.js';
import type { ExecutorContextFacts } from '../prompts/executor.js';
import type { OrchestratorDeps, RunEntry } from './run-types.js';
import { type ChildMeta, type FlowLockInfo, type OrchestratorLogger, type RootAgentLike, type TurnEndInfo } from './seams.js';
export declare abstract class RuntimeBase {
    protected readonly deps: OrchestratorDeps;
    /**
     * 断点续跑（实现位于 RuntimeLaunch，见 runtime-launch.ts）。
     * 此处只做抽象声明，使基类内的运行上下文自动接续（adoptRunContext）可以调用它，
     * 而不必把基类反向依赖到下游继承层。
     */
    abstract resumeRun(input: {
        sessionId: string;
        flowId: string;
        fromRunId?: string;
    }): Promise<ResumeResult>;
    /** 全部 run（含已终止的历史内存条目；持久化历史另见 store.listRuns）。 */
    readonly runs: Map<string, RunEntry>;
    /** childId → 运行位置反查（subagent/end 观察回写用）。 */
    protected readonly childIndex: Map<string, ChildMeta>;
    /** nodeId → childId 反向索引（wf_ask_agent 节点 id 寻址 O(1)，P2-4）。 */
    protected readonly childByNode: Map<string, string>;
    /**
     * 自动续跑去重表（sessionId → 进行中的运行上下文接续 Promise）。
     * 为什么需要：父代理可以在同一步里并发发起多个 wf_* 工具调用（模型支持并行工具
     * 调用），而「定位断点」要 await 磁盘扫描——若不去重，两次调用会各自拿到暂停/停止
     * 的断点并各自续跑，第二个必然撞 WF_LOCKED。会话级去重让并发调用共享同一次接续。
     */
    protected readonly adopting: Map<string, Promise<RunEntry | null>>;
    /** flowId 级续跑去重（同会话多 flow 交错时的二次收口）。 */
    protected readonly resuming: Map<string, Promise<ResumeResult | null>>;
    /** dispose 标记：置位后迟到事件缓冲不再重试（插件卸载清理彻底）。 */
    protected disposed: boolean;
    constructor(deps: OrchestratorDeps);
    protected log(): OrchestratorLogger;
    /** 当前时间戳（时钟注入）。 */
    now(): number;
    /** 当前 ISO 时间字符串。 */
    protected isoNow(): string;
    /**
     * 把父代理（会话根 Agent）节点的配置注入到根 Agent 的 ctx：
     *   - 角色 Prompt（含 .md 路径读取）注册为系统提示词段 visual-workflow:prompt；
     *   - injectSystemPrompt 开关控制官方系统提示词注入；injectToolSections 控制工具散文段；
     *   - 服务商/模型/思考强度写入根 Agent 的模型选择。
     * 非侵入：仅挂载到根 Agent 的 ctx，只对本会话生效；缺父代理节点/根无 ctx 时静默跳过。
     */
    protected bindParentConfig(flow: WorkflowDocument, root: RootAgentLike, sessionId: string): Promise<void>;
    /** 记录告警（watchdog 扫描失败/持久化告警路径）。 */
    warn(message: string): void;
    /**
     * 父代理执行单元准备（startRun/resumeRun 共用；情况2 hybrid / 情况3 executor）：
     *   - 父代理节点被流程线连接 → 登记 executorParentId，快照中该节点标记 running
     *     （续跑已 ok 则跳过——继承不重跑）；
     *   - 组装父代理执行单元上下文（复用 buildNodeContextFacts：上游 ctx 产出/文件
     *     文本与路径索引/db 提示），返回结构化上下文供 hybrid 的【你的节点任务】与
     *     executor（情况3）提示词构建使用；
     *   - 情况1 纯调度者返回 null（指令不含执行单元内容）。
     */
    protected prepareParentExecutor(flow: WorkflowDocument, entry: RunEntry): Promise<{
        nodeId: string;
        nodeLabel: string;
        task: ExecutorContextFacts;
        runContextText: string;
    } | null>;
    /** 父代理执行者收尾：开始调度（首次 wf_run_node / wf_finish）时把父代理节点标记 ok。 */
    protected markParentExecutorDone(entry: RunEntry): void;
    /** 空闲看护门限（watchdog.ts 引用）。 */
    get idleTimeoutMs(): number;
    /** 子代理是否仍在运行（watchdog.ts 引用；经 AgentHost）。 */
    childRunning(childId: string): boolean;
    /** 父代理回合终态检测（watchdog.ts 引用）。 */
    parentTurnTerminal(entry: RunEntry): TurnEndInfo | null;
    /** 某会话正在运行的 run（status === 'running'）。 */
    activeRunForSession(sessionId: string): RunEntry | null;
    /**
     * 活跃 run 摘要（running/paused 均保留运行锁；返回 flowId/status/runId/sessionId）。
     * 工作台全局化改版：sessionId 缺省时返回**全部会话**的活跃 run（工作台全局面板
     * 实例列表状态徽标用）；传入时按会话过滤（进入时自动选中、旧单会话面板兼容）。
     */
    activeRunsForSession(sessionId?: string): Array<{
        flowId: string;
        status: RunStatus;
        runId: string;
        sessionId: string;
    }>;
    /** 某会话+工作流的暂停 run（断点恢复入口）。 */
    pausedRun(sessionId: string, flowId: string): RunEntry | null;
    /**
     * 取「可直接执行节点」的激活运行；依次尝试：
     *   ① 本会话 running 的 run（常态路径）；
     *   ② 内存中本会话 paused 的 run → 用该 flowId **自动续跑**（等价用户在工作台点「运行」）；
     *   ③ 该会话**最近可恢复**的磁盘记录（stopped/interrupted/paused）→ 自动续跑；
     *   ④ 都没有 → null（调用方按 WF_NO_ACTIVE_RUN 给出可行动提示）。
     *
     * 运行锁语义（用户裁决）：锁不再作为「执行节点的前置条件」，而是降权为
     * 「同工作流单活 + 断点归属」的保护；工具层遇到暂停/已停止的断点即自动接续，
     * 不再要求用户回到工作台点「运行」。真正的硬边界只剩「本会话从未启动过运行」。
     *
     * 停点判定为何「内存优先」：paused 是唯一保留在内存的断点（锁未释放），
     * 恢复它会原样接管其断点产出；磁盘兜底按 startedAt 倒序取最近一条可恢复记录。
     */
    protected ensureActiveRun(sessionId: string): Promise<RunEntry | null>;
    /** 接续本体（已由 ensureActiveRun 完成会话级去重）：定位断点 → 续跑 → 取回运行条目。 */
    private adoptRunContext;
    /**
     * 断点自动续跑（同 flowId 并发去重）：续跑失败时记录告警并把恢复路径的错误向上抛
     * （调用方据此给出精确错误码，例如 WF_FLOW_INCOMPLETE），不吞错。
     */
    protected autoResumeRun(sessionId: string, flowId: string): Promise<ResumeResult | null>;
    /** 某工作流当前被哪个会话锁定（running/paused 均保留锁）。 */
    flowLockInfo(flowId: string): FlowLockInfo | null;
    /**
     * 运行锁检查（startRun 用）：存在锁定（running/paused）即抛错。
     * 为什么同时用于「开头护栏」与「登记前重检」：两处语义一致——只要此刻
     * 该 flowId 已有激活 run，本次启动就要拒绝；登记前在同一同步块内重检，
     * 使 check-then-act 原子化（并发 startRun 不会双双通过）。
     */
    protected assertFlowLockFree(flowId: string, sessionId: string): void;
    /**
     * 运行锁检查（resumeRun 用）：允许本会话 paused（恢复接管锁），拒绝
     * 跨会话锁定与本会话 running。与 assertFlowLockFree 一样用于开头护栏
     * 与登记前重检两处，保证并发恢复/启动不会产生同 flowId 双运行。
     */
    protected assertResumeLockFree(flowId: string, sessionId: string): void;
    /** 读取 run 快照（深拷贝副本，防调用方改写内部状态）。 */
    runSnapshot(runId: string): RunSnapshot | null;
    /** 取 run 内存条目本身（API 层会话归属校验用；调用方只读，不得改写内部状态）。 */
    entryFor(runId: string): RunEntry | null;
    /** childId → 运行位置反查（subagent/end 观察用；未登记返回 null）。 */
    childMetaFor(childId: string): ChildMeta | null;
    /**
     * 触碰运行的空闲基准（工具层调用）：wf_ask 提问等长阻塞交互期间持续
     * 刷新 lastActiveAt，防止空闲看护（runIdleTimeoutMs）把等待用户的运行误判为空闲
     * 并自动停止。
     */
    touchRun(entry: RunEntry): void;
    /** 重读当前（运行的）工作流最新快照：每节点执行前读一次，运行中调整即时生效（双向同步①）。 */
    currentResolvedFlow(entry: RunEntry): Promise<WorkflowDocument>;
    /**
     * 刷新实例保存后的运行事实源（双向同步①「画布→编排」的闭环补全）：
     * 画布保存（putWorkflow/putService）会更新 workflows/services 目录，但运行
     * 事实源 orchestrations/<runId>.json 是 startRun 时的一次性快照——若不同步
     * 刷新，父代理（编排指令的 definitionPath 指向该文件）永远读到旧拓扑，
     * 新增节点/连线在运行中不可见（本缺陷已验证）。此处对属于该实例且处于
     * running/paused 的活跃 run，用最新保存内容重写其事实源文件。
     *
     * 新机制（用户裁决）：保存后若**编排语义确有变更**（flow-diff 判定，纯坐标拖动/
     * 组卡片缩放等几何改动不算），且该 run 正在运行（running），立即向父代理注入
     * 【编排变更】通知（steer 插队优先，父代理空闲时 followupRoot 唤醒），父代理据此
     * 重读事实源并调整后续编排——取代旧提示词「每次调度前重读源文件」的软约束。
     * 暂停中的 run 只刷新事实源、不注入（不打断暂停态，恢复时按最新拓扑续跑）。
     * 幂等：无活跃 run 时为空操作；不打断正在执行的子代理。
     */
    refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void>;
    /**
     * 向父代理注入【编排变更】通知（运行中画布保存且编排语义变更时调用）。
     * 通道选择（用户裁决）：父代理回合进行中（status='running'）且具备 steer → 插队
     * 注入（下一步边界即见，与 wf_ask_agent 超时通知同通道）；否则用 followupRoot 唤醒
     * （父代理空闲时也能收到）。注入失败仅告警，绝不阻断画布保存主流程。
     */
    protected notifyOrchestrationChange(entry: RunEntry, flow: WorkflowDocument): void;
    /**
     * 清理运行时资源（插件卸载/Service dispose，幂等）：
     * 中止全部运行（阻塞等待随之 reject）并清空内存表。
     * 快照不在此写终态——磁盘上残留的 running/paused 由下次启动 reconcileStaleRuns
     * 标记为 interrupted（可恢复）。
     */
    dispose(): void;
    /** 拒绝某运行的全部阻塞等待器（终止/卸载路径）。 */
    protected rejectWaiters(entry: RunEntry): void;
    /** 拒绝某运行的全部挂起协作通信（终止/卸载路径：清计时器 + reject + 清表）。 */
    protected rejectAsks(entry: RunEntry, error?: unknown): void;
    /** 持久化 run 快照（尽力而为：失败仅告警，不阻断状态机）。 */
    protected persistWarn(entry: RunEntry): Promise<void>;
}

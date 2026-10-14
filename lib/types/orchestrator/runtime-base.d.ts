import type { WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot, RunStatus } from '../shared/types.js';
import { type ResumeInput, type ResumeResult } from './resume.js';
import { type ExecutorContextFacts } from '../prompts/index.js';
import type { OrchestratorDeps, RunEntry } from './run-entry.js';
import { type ChildMeta, type FlowLockInfo, type OrchestratorLogger, type RootAgentLike, type TurnEndInfo } from './seams.js';
export declare abstract class RuntimeBase {
    protected readonly deps: OrchestratorDeps;
    /**
     * 断点续跑（实现位于 RuntimeLaunch，见 runtime-launch.ts）。
     * 此处只做抽象声明，使基类内的运行上下文自动接续（adoptRunContext）可以调用它，
     * 而不必把基类反向依赖到下游继承层。入参用 ResumeInput 单一契约，避免与实现漂移。
     */
    abstract resumeRun(input: ResumeInput): Promise<ResumeResult>;
    /** 全部 run（含已终止的历史内存条目；持久化历史另见 store.listRuns）。 */
    readonly runs: Map<string, RunEntry>;
    /** childId → 运行位置反查（subagent/end 观察回写用）。 */
    protected readonly childIndex: Map<string, ChildMeta>;
    /** nodeId → childId 反向索引（wf_ask_agent 节点 id 寻址 O(1)，P2-4）。 */
    protected readonly childByNode: Map<string, string>;
    /**
     * 断点静默接续去重表（sessionId → 进行中的运行上下文接续 Promise）。
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
     *   - 组装父代理执行单元上下文（复用 buildNodeContextFacts：上游产出（自动注入）/文件
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
    /**
     * 父代理执行者收尾：开始调度（首次 wf_run_node / wf_finish）时把父代理节点标记 ok。
     */
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
     * 某会话正在运行实例的工作流文档（`wf_org_catalog` 的 instance 召回取数源；无活跃 run 返回 null）。
     *
     * 为什么只认 running：暂停中的运行不暴露骨架（暂停态父代理不继续编排，恢复后重新
     * running 即再次可见）——「当前正在运行的实例」这条语义由本函数独占定义，取数方不判状态。
     * 为什么取最新实例文档而不是运行起始快照：运行中画布可能被改，父代理要按最新拓扑调度
     * （与 currentResolvedFlow 同口径；读失败回退起始快照）。
     */
    activeRunFlow(sessionId: string): Promise<WorkflowDocument | null>;
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
    /**
     * 某会话当前活跃运行的归属事实（Experience 域解析 subject 用）。
     * 为什么返回最小三元组而不是 RunEntry：运行表与会话/工作流的定位口径是编排器内部
     * 知识，模块外只应表达「这个会话当前在跑哪个 run」。
     */
    activeExperienceRunForSession(sessionId: string): {
        runId: string;
        flowId: string;
        sessionId: string;
    } | null;
    /**
     * 某子代理所属运行的归属事实（Experience 域解析来源 run 与节点用）。
     * 已退役（被同节点新配置替换）或运行已非 running 时返回 null。
     */
    experienceRunForChild(childId: string): {
        runId: string;
        flowId: string;
        sessionId: string;
        nodeId: string;
    } | null;
    /**
     * 取「可直接执行节点」的激活运行；依次尝试：
     *   ① 本会话 running 的 run（常态路径）；
     *   ② 内存中本会话 paused 的 run → 用该 flowId **静默接续**（等价人工点「运行」，但不注入指令）；
     *   ③ 该会话**全部可恢复**的磁盘记录（stopped/interrupted/paused）→ 逐条静默接续；
     *   ④ 都没有 → null（调用方按 WF_NO_ACTIVE_RUN 给出可行动提示）。
     *
     * 运行锁语义（用户裁决）：锁不再作为「执行节点的前置条件」，而是降权为
     * 「同工作流单活 + 断点归属」的保护；工具层遇到暂停/已停止的断点即静默接续，
     * 不再要求用户回到工作台点「运行」。真正的硬边界只剩「本会话从未启动过运行」。
     *
     * 为什么必须静默（而非沿用注入了编排指令的显式续跑）：工具调用发生在父代理**自身
     * 回合内**（root.status === 'running'），而显式续跑要求父代理空闲让位给指令注入
     * （WF_ROOT_BUSY），两者天然互斥——这正是「必须人工点运行」的根因。
     *
     * 停点判定为何「内存优先」：paused 是唯一保留在内存的断点（锁未释放），
     * 恢复它会原样接管其断点产出；磁盘兜底按 startedAt 倒序逐条尝试。
     */
    protected ensureActiveRun(sessionId: string): Promise<RunEntry | null>;
    /** 接续本体（已由 ensureActiveRun 完成会话级去重）：定位断点 → 静默接续 → 取回运行条目。 */
    private adoptRunContext;
    /** 本会话某工作流当前 running 的条目（接续成功后取回；未取到返回 null）。 */
    private runningEntryOf;
    /**
     * 断点静默接续（同 flowId 并发去重）：续跑失败时把恢复路径的错误向上抛（调用方据此
     * 给出精确错误码，例如 WF_FLOW_INCOMPLETE），不吞错。
     * 固定 silent：本方法只服务工具路径——调用时父代理正在自身回合内，故不注入编排指令、
     * 也不要求父代理空闲；显式启动语义（工作台/调度器/模式二）不经此路径。接续成功日志
     * 由 resumeRun 的静默分支记录，此处不重复。
     * fromRunId 指定本次要接管的断点记录（接续多候选逐条尝试时用），缺省取该工作流最新可恢复记录。
     */
    protected autoResumeRun(sessionId: string, flowId: string, fromRunId?: string): Promise<ResumeResult | null>;
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
     * 子代理 id → 其所属在编运行条目（childIndex 归属反查）。
     * 为什么提供方法而不是让调用方遍历 runs：运行表的定位口径（会话 + 工作流 + running）
     * 是运行时的内部知识，模块外只应表达「我要这个子代理的运行」。
     * 无登记记录、或对应运行已非 running 时返回 null。
     */
    runForChild(childId: string): RunEntry | null;
    /**
     * 触碰运行的空闲基准（工具层调用）：wf_ask 提问等长阻塞交互期间持续
     * 刷新 lastActiveAt，防止空闲看护（runIdleTimeoutMs）把等待用户的运行误判为空闲
     * 并自动停止。
     */
    touchRun(entry: RunEntry): void;
    /**
     * 按会话刷新运行的空闲基准（自主编排方案 §5.1，host 经 `agent/status` 事件调用）。
     * 为什么需要：父代理只在调用 wf_* 工具时刷新 lastActiveAt（runtime-execute.ts），
     * 规划/思考/读写文件期间父代理虽在干活却不刷新 → 长规划（> runIdleTimeoutMs，
     * 默认 30 分钟）会被空闲看护误判为空闲并自动 stopped。官方 `agent/status` 在父代理
     * 转为 running 时触发，据此把「父代理在干活」翻译成「运行不空闲」。
     * 只作用于本会话 status==='running' 的 run：paused 由看护自然跳过（watchdog 只扫
     * running），终态 run 已释放内存条目，均无需刷新。返回是否命中（便于断言/日志）。
     */
    touchRunForSession(sessionId: string): boolean;
    /** 重读当前（运行的）工作流最新快照：每节点执行前读一次，运行中调整即时生效（双向同步①）。 */
    currentResolvedFlow(entry: RunEntry): Promise<WorkflowDocument>;
    /**
     * 刷新实例保存后的运行编排基线（双向同步①「画布→编排」的闭环补全）：
     * 保存后若**编排语义确有变更**（flow-diff 判定，纯坐标拖动/协作组卡片缩放等几何改动不算），
     * 且该 run 正在运行（running），立即向父代理注入【编排变更】通知（steer 插队优先，
     * 父代理空闲时 followupRoot 唤醒），父代理据此重新召回实例骨架并调整后续编排。
     *
     * 为什么基线是内存事实而不是落盘副本：那份 orchestrations/<runId>.json 副本的唯一用途
     * 曾是「给父代理 read 一份只读快照」；改用 wf_org_catalog 的 instance 通道召回后它失去
     * 消费者，故收敛为 RunEntry 上的内存基线（单一事实源，不再有「副本与画布漂移」这一整类问题）。
     * 拓扑本身由 currentResolvedFlow 每次显式重读最新实例文档，不依赖任何快照副本。
     *
     * 暂停中的 run 只更新基线、不注入（不打断暂停态，恢复时按最新拓扑续跑）。
     * 幂等：无活跃 run 时为空操作；不打断正在执行的子代理。
     */
    refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void>;
    /**
     * 向父代理注入【编排变更】通知（运行中画布保存且编排语义变更时调用）。
     * 通道选择（用户裁决）：父代理回合进行中（status='running'）且具备 steer → 插队
     * 注入（下一步边界即见，与 wf_ask_agent 超时通知同通道）；否则用 followupRoot 唤醒
     * （父代理空闲时也能收到）。注入失败仅告警，绝不阻断画布保存主流程。
     */
    protected notifyOrchestrationChange(entry: RunEntry): void;
    /**
     * 清理运行时资源（插件卸载/Service dispose，幂等）：
     * 中止全部运行（阻塞等待随之 reject）并清空内存表。
     * 快照不在此写终态——**已落盘**的 running/paused 记录由下次启动 reconcileStaleRuns
     * 标记为 interrupted（可恢复）；尚未落盘就进入 dispose 的记录（例如 resumeRun 在
     * persistWarn 之前被中止）内存条目直接丢弃，磁盘上不留痕，故既非 interrupted 也不可恢复。
     */
    dispose(): void;
    /**
     * 释放某运行的内存条目（终态收尾路径唯一入口）：清运行表项 + **连带退役该运行的
     * 子代理归属索引**（childIndex / childByNode）。
     *
     * 为什么必须连带清子代理归属：这两张表是「子代理 id → 所属运行/节点」的全局归属事实。
     * 只删运行表项会让旧归属永久残留，于是同一会话重新起跑（resumeRun 接管同 flowId）后：
     *   - `childIndex` 里旧 run 的 child 因 sessionId/flowId 与新 run 相同而**通过越权校验**，
     *     仍可发起协作消息（投递到已废弃的子代理会话）；
     *   - `childByNode` 仍指向旧 child，节点寻址会命中过期执行者。
     * 归属随运行条目同生共死，是这两张表唯一自洽的回收条件（宿主 dispose 另有兜底清表）。
     */
    protected releaseRunMemory(runId: string): void;
    /** 拒绝某运行的全部阻塞等待器（终止/卸载路径）。 */
    protected rejectWaiters(entry: RunEntry): void;
    /**
     * 释放某运行的全部待回复协作登记（终止/替换/卸载路径）。
     * 非阻塞协议下登记不含等待受体，故无拒绝语义：仅清表 + 写审计（幂等）。
     */
    protected rejectAsks(entry: RunEntry): void;
    /** 持久化 run 快照（尽力而为：失败仅告警，不阻断状态机）。 */
    protected persistWarn(entry: RunEntry): Promise<void>;
}

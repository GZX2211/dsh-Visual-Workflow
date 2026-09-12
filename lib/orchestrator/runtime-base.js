// src/host/orchestrator/runtime-base.ts
//
// 编排运行时继承链基类（RuntimeBase）：承载全部字段、基础工具、运行查询、
// 运行时读取、清理与内部辅助。方法体与拆分前逐字一致（零逻辑修改）；
// 可见性自 private 放宽为 protected 仅因跨文件继承协作（编译产物不变）。
//
// 运行锁语义（用户裁决后的降权改造）：锁不再充当「执行节点的前置条件」，而只保护
// 「同工作流单活 + 断点归属 + 画布回显 + 运行历史」；工具层遇到本会话的暂停/已停止
// 断点时经 ensureActiveRun **自动续跑**接管，不再要求用户回工作台点「运行」。
//
// 继承链：RuntimeBase ← RuntimeLaunch ← RuntimeExecute ← RuntimeComm ←
// RuntimeObserve ← RuntimeLifecycle ← OrchestratorRuntime（runtime.ts 收口）。
import { randomUUID } from 'node:crypto';
import { resolveRolePrompt } from '../agent/runner.js';
import { isGroupMember } from '../graph/model.js';
import { cloneSnapshot, statusText, setNodeStatus } from './snapshot.js';
import { RESUMABLE_STATUSES } from './resume.js';
import { buildOrchestrationChangeText } from '../prompts/orchestration-change.js';
import { DEFAULT_SYSTEM_LANGUAGE } from '../system-language.js';
import { coordinatorMessage } from './ask-types.js';
import { summarizeFlowChange } from './flow-diff.js';
import { buildNodeContextFacts, messageOf, parentExecutorOf } from './helpers.js';
import { WfError, consoleLogger, } from './seams.js';
export class RuntimeBase {
    deps;
    /** 全部 run（含已终止的历史内存条目；持久化历史另见 store.listRuns）。 */
    runs = new Map();
    /** childId → 运行位置反查（subagent/end 观察回写用）。 */
    childIndex = new Map();
    /** nodeId → childId 反向索引（wf_ask_agent 节点 id 寻址 O(1)，P2-4）。 */
    childByNode = new Map();
    /**
     * 自动续跑去重表（sessionId → 进行中的运行上下文接续 Promise）。
     * 为什么需要：父代理可以在同一步里并发发起多个 wf_* 工具调用（模型支持并行工具
     * 调用），而「定位断点」要 await 磁盘扫描——若不去重，两次调用会各自拿到暂停/停止
     * 的断点并各自续跑，第二个必然撞 WF_LOCKED。会话级去重让并发调用共享同一次接续。
     */
    adopting = new Map();
    /** flowId 级续跑去重（同会话多 flow 交错时的二次收口）。 */
    resuming = new Map();
    /** dispose 标记：置位后迟到事件缓冲不再重试（插件卸载清理彻底）。 */
    disposed = false;
    constructor(deps) {
        this.deps = deps;
    }
    // ---- 基础工具 -------------------------------------------------------------
    log() {
        return this.deps.logger ?? consoleLogger;
    }
    /** 当前时间戳（时钟注入）。 */
    now() {
        return this.deps.now?.() ?? Date.now();
    }
    /** 当前 ISO 时间字符串。 */
    isoNow() {
        return new Date(this.now()).toISOString();
    }
    /**
     * 把父代理（会话根 Agent）节点的配置注入到根 Agent 的 ctx：
     *   - 角色 Prompt（含 .md 路径读取）注册为系统提示词段 visual-workflow:prompt；
     *   - injectSystemPrompt 开关控制官方系统提示词注入；injectToolSections 控制工具散文段；
     *   - 服务商/模型/思考强度写入根 Agent 的模型选择。
     * 非侵入：仅挂载到根 Agent 的 ctx，只对本会话生效；缺父代理节点/根无 ctx 时静默跳过。
     */
    async bindParentConfig(flow, root, sessionId) {
        const ctx = root.ctx;
        if (!ctx || typeof ctx !== 'object')
            return;
        if (!this.deps.promptSetup || !this.deps.modelSelection)
            return;
        const parentNode = flow.nodes.find((n) => n.kind === 'parent');
        if (!parentNode)
            return;
        try {
            // 角色 Prompt 实际注入文本（.md 路径设置时读取文件当前内容，与子代理一致）
            const rolePrompt = await resolveRolePrompt(parentNode);
            this.deps.promptSetup.bindParent(ctx, {
                systemPrompt: rolePrompt,
                injectSystemPrompt: parentNode.data.injectSystemPrompt !== false,
                injectToolSections: parentNode.data.injectToolSections !== false,
            }, sessionId);
            const data = parentNode.data;
            this.deps.modelSelection.bindParent(ctx, {
                provider: String(data.provider ?? ''),
                model: String(data.model ?? ''),
                ...(typeof data.reasoning === 'string' && data.reasoning.trim() ? { reasoningEffort: data.reasoning } : {}),
            }, sessionId);
        }
        catch (error) {
            this.deps.logger?.warn(`[visual-workflow] 父代理配置注入失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** 记录告警（watchdog 扫描失败/持久化告警路径）。 */
    warn(message) {
        this.log().warn(message);
    }
    /**
     * 父代理执行单元准备（startRun/resumeRun 共用；情况2 hybrid / 情况3 executor）：
     *   - 父代理节点被流程线连接 → 登记 executorParentId，快照中该节点标记 running
     *     （续跑已 ok 则跳过——继承不重跑）；
     *   - 组装父代理执行单元上下文（复用 buildNodeContextFacts：上游 ctx 产出/文件
     *     文本与路径索引/db 提示），返回结构化上下文供 hybrid 的【你的节点任务】与
     *     executor（情况3）提示词构建使用；
     *   - 情况1 纯调度者返回 null（指令不含执行单元内容）。
     */
    async prepareParentExecutor(flow, entry) {
        const executor = parentExecutorOf(flow);
        if (!executor)
            return null;
        const parentNode = flow.nodes.find((n) => n.id === executor.nodeId);
        if (!parentNode || parentNode.kind !== 'parent')
            return null;
        const snapshot = entry.snapshot;
        const existing = snapshot.nodes.find((n) => n.nodeId === executor.nodeId);
        // 续跑继承：已 ok/react-capped 的父代理节点不再注入执行单元（断点产出已随快照继承）
        if (existing && (existing.status === 'ok' || existing.status === 'react-capped'))
            return null;
        entry.executorParentId = executor.nodeId;
        if (!existing || existing.status !== 'running') {
            setNodeStatus(snapshot, executor.nodeId, 'running', { now: this.now() });
        }
        const context = buildNodeContextFacts({
            flow,
            node: parentNode,
            snapshot,
            documentTextLimit: this.deps.config.documentTextLimit,
        });
        return {
            nodeId: executor.nodeId,
            nodeLabel: executor.nodeLabel,
            task: { ...context, nodeLabel: executor.nodeLabel, isGroupMember: isGroupMember(flow, executor.nodeId) },
            runContextText: `runId=${snapshot.id}; attempt ${(existing?.attempts ?? 0) + 1}/1（父代理执行单元）`,
        };
    }
    /** 父代理执行者收尾：开始调度（首次 wf_run_node / wf_finish）时把父代理节点标记 ok。 */
    markParentExecutorDone(entry) {
        const nodeId = entry.executorParentId;
        if (!nodeId)
            return;
        const snapshot = entry.snapshot;
        const existing = snapshot.nodes.find((n) => n.nodeId === nodeId);
        if (!existing || existing.status !== 'running')
            return;
        // 输出取父代理最近一条 assistant/message 文本（有产出才回写；无文本仍标记 ok 完成调度）
        const output = this.deps.agents.latestRootAssistantText?.(snapshot.sessionId, Date.parse(snapshot.startedAt ?? '') || 0) ?? '';
        setNodeStatus(snapshot, nodeId, 'ok', {
            output,
            outputFullLimit: this.deps.config.outputFullLimit,
            now: this.now(),
            recordTurn: true,
            stopReason: 'completed',
        });
    }
    /** 空闲看护门限（watchdog.ts 引用）。 */
    get idleTimeoutMs() {
        return this.deps.config.runIdleTimeoutMs;
    }
    /** 子代理是否仍在运行（watchdog.ts 引用；经 AgentHost）。 */
    childRunning(childId) {
        return this.deps.agents.childRunning(childId);
    }
    /** 父代理回合终态检测（watchdog.ts 引用）。 */
    parentTurnTerminal(entry) {
        const startedMs = Date.parse(entry.snapshot.startedAt ?? '') || 0;
        return this.deps.agents.latestTurnEnd(entry.snapshot.sessionId, startedMs);
    }
    // ---- 查询 -----------------------------------------------------------------
    /** 某会话正在运行的 run（status === 'running'）。 */
    activeRunForSession(sessionId) {
        for (const entry of this.runs.values()) {
            if (entry.snapshot.status === 'running' && entry.snapshot.sessionId === sessionId)
                return entry;
        }
        return null;
    }
    /**
     * 活跃 run 摘要（running/paused 均保留运行锁；返回 flowId/status/runId/sessionId）。
     * 工作台全局化改版：sessionId 缺省时返回**全部会话**的活跃 run（工作台全局面板
     * 实例列表状态徽标用）；传入时按会话过滤（进入时自动选中、旧单会话面板兼容）。
     */
    activeRunsForSession(sessionId) {
        const out = [];
        for (const entry of this.runs.values()) {
            const s = entry.snapshot;
            if (sessionId !== undefined && s.sessionId !== sessionId)
                continue;
            if (s.status !== 'running' && s.status !== 'paused')
                continue;
            out.push({ flowId: s.flowId, status: s.status, runId: s.id, sessionId: s.sessionId });
        }
        return out;
    }
    /** 某会话+工作流的暂停 run（断点恢复入口）。 */
    pausedRun(sessionId, flowId) {
        for (const entry of this.runs.values()) {
            const s = entry.snapshot;
            if (s.status === 'paused' && s.sessionId === sessionId && s.flowId === flowId)
                return entry;
        }
        return null;
    }
    // ---- 运行上下文自动接续（工具层用） ------------------------------------------
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
    async ensureActiveRun(sessionId) {
        const active = this.activeRunForSession(sessionId);
        if (active)
            return active;
        // 去重键按会话（而非 flowId）：断点定位本身要 await 磁盘扫描，若不去重，
        // 并发的两次调用会各自扫到同一条断点并各自续跑 → 第二次撞 WF_LOCKED。
        // Promise 在首个 await 之前同步登记，保证并发调用共享同一次接续。
        const pending = this.adopting.get(sessionId);
        if (pending)
            return pending;
        const task = this.adoptRunContext(sessionId);
        this.adopting.set(sessionId, task);
        try {
            return await task;
        }
        finally {
            this.adopting.delete(sessionId);
        }
    }
    /** 接续本体（已由 ensureActiveRun 完成会话级去重）：定位断点 → 续跑 → 取回运行条目。 */
    async adoptRunContext(sessionId) {
        // ① 内存 paused（锁保留在内存中，优先于磁盘历史）
        let target = null;
        for (const entry of this.runs.values()) {
            const s = entry.snapshot;
            if (s.sessionId === sessionId && s.status === 'paused') {
                target = s.flowId;
                break;
            }
        }
        // ② 磁盘断点（stopped/interrupted/paused；宿主重启或用户在工作台停止后）
        if (!target) {
            let newest = null;
            try {
                for (const runId of await this.deps.store.listAllRunIds()) {
                    const record = await this.deps.store.getRun(runId);
                    if (!record || record.sessionId !== sessionId)
                        continue;
                    if (!RESUMABLE_STATUSES.includes(record.status))
                        continue;
                    if (!newest || String(record.startedAt ?? '') > String(newest.startedAt ?? ''))
                        newest = record;
                }
            }
            catch (error) {
                this.log().warn(`[visual-workflow] 断点扫描失败：${messageOf(error)}`);
                return null;
            }
            target = newest?.flowId ?? null;
        }
        if (!target)
            return null;
        await this.autoResumeRun(sessionId, target);
        // 只认「刚恢复的那个工作流」的运行（本会话可能有多个实例，取错会张冠李戴）
        for (const entry of this.runs.values()) {
            const s = entry.snapshot;
            if (s.sessionId === sessionId && s.flowId === target && s.status === 'running')
                return entry;
        }
        return null;
    }
    /**
     * 断点自动续跑（同 flowId 并发去重）：续跑失败时记录告警并把恢复路径的错误向上抛
     * （调用方据此给出精确错误码，例如 WF_FLOW_INCOMPLETE），不吞错。
     */
    autoResumeRun(sessionId, flowId) {
        const pending = this.resuming.get(flowId);
        if (pending)
            return pending;
        const task = (async () => {
            try {
                const result = await this.resumeRun({ sessionId, flowId });
                this.log().info(`[visual-workflow] 断点自动续跑：flow=${flowId} session=${sessionId} run=${result.runId}（resumedFrom=${result.resumedFromRunId}）`);
                return result;
            }
            finally {
                this.resuming.delete(flowId);
            }
        })();
        this.resuming.set(flowId, task);
        return task;
    }
    /** 某工作流当前被哪个会话锁定（running/paused 均保留锁）。 */
    flowLockInfo(flowId) {
        for (const entry of this.runs.values()) {
            const s = entry.snapshot;
            if ((s.status === 'running' || s.status === 'paused') && s.flowId === flowId) {
                return { flowId, sessionId: s.sessionId, runId: s.id, flowName: s.flowName, status: s.status };
            }
        }
        return null;
    }
    /**
     * 运行锁检查（startRun 用）：存在锁定（running/paused）即抛错。
     * 为什么同时用于「开头护栏」与「登记前重检」：两处语义一致——只要此刻
     * 该 flowId 已有激活 run，本次启动就要拒绝；登记前在同一同步块内重检，
     * 使 check-then-act 原子化（并发 startRun 不会双双通过）。
     */
    assertFlowLockFree(flowId, sessionId) {
        const locked = this.flowLockInfo(flowId);
        if (!locked)
            return;
        if (locked.status === 'paused' && locked.sessionId === sessionId) {
            throw new WfError('该工作流已暂停，请先恢复运行', 'WF_PAUSED', { runId: locked.runId, pausedRunId: locked.runId });
        }
        if (locked.sessionId === sessionId) {
            throw new WfError('该工作流正在本会话运行中，请先停止再运行', 'WF_LOCKED', { lockedSessionId: locked.sessionId });
        }
        throw new WfError('该工作流正在另一个会话中运行，请先停止后再试', 'WF_LOCKED', { lockedSessionId: locked.sessionId });
    }
    /**
     * 运行锁检查（resumeRun 用）：允许本会话 paused（恢复接管锁），拒绝
     * 跨会话锁定与本会话 running。与 assertFlowLockFree 一样用于开头护栏
     * 与登记前重检两处，保证并发恢复/启动不会产生同 flowId 双运行。
     */
    assertResumeLockFree(flowId, sessionId) {
        const locked = this.flowLockInfo(flowId);
        if (!locked)
            return;
        if (locked.sessionId !== sessionId) {
            throw new WfError('该工作流正在另一个会话中运行，请先停止后再试', 'WF_LOCKED', { lockedSessionId: locked.sessionId });
        }
        if (locked.status === 'running') {
            throw new WfError('该工作流正在本会话运行中，请先停止再运行', 'WF_LOCKED', { lockedSessionId: locked.sessionId });
        }
    }
    /** 读取 run 快照（深拷贝副本，防调用方改写内部状态）。 */
    runSnapshot(runId) {
        const entry = this.runs.get(runId);
        return entry ? cloneSnapshot(entry.snapshot) : null;
    }
    /** 取 run 内存条目本身（API 层会话归属校验用；调用方只读，不得改写内部状态）。 */
    entryFor(runId) {
        return this.runs.get(runId) ?? null;
    }
    /** childId → 运行位置反查（subagent/end 观察用；未登记返回 null）。 */
    childMetaFor(childId) {
        return this.childIndex.get(childId) ?? null;
    }
    // ---- 运行时读取 --------------------------------------------------------------
    /**
     * 触碰运行的空闲基准（工具层调用）：wf_ask 提问等长阻塞交互期间持续
     * 刷新 lastActiveAt，防止空闲看护（runIdleTimeoutMs）把等待用户的运行误判为空闲
     * 并自动停止。
     */
    touchRun(entry) {
        entry.lastActiveAt = this.now();
    }
    /** 重读当前（运行的）工作流最新快照：每节点执行前读一次，运行中调整即时生效（双向同步①）。 */
    async currentResolvedFlow(entry) {
        try {
            // 模式二运行的服务文档在 services/ 目录，必须按 mode 分派读取；
            // 固定读 workflows/ 会让 mode2 运行「读错文档/读到 null 隐式回退」（Bug 20）。
            const raw = entry.snapshot.mode === 'mode2'
                ? await this.deps.store.getServiceAsFlow(entry.snapshot.flowId)
                : await this.deps.store.getWorkflow(entry.snapshot.sessionId, entry.snapshot.flowId);
            if (raw)
                return raw;
        }
        catch {
            // 读失败回退起始快照
        }
        return entry.baseFlow;
    }
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
    async refreshActiveDefinitions(flowId, sessionId, flow) {
        for (const entry of this.runs.values()) {
            const s = entry.snapshot;
            if (s.flowId !== flowId || s.sessionId !== sessionId)
                continue;
            if (s.status !== 'running' && s.status !== 'paused')
                continue;
            // 编排变更判定：与「上一次同步进事实源的画布」比较（读失败按未变更处理，
            // 宁可不注入也不误注入——事实源仍照常刷新，宿主侧 currentResolvedFlow 兜底）。
            let semanticallyChanged = false;
            try {
                const previous = await this.deps.store.readOrchestration(s.id);
                semanticallyChanged = previous ? summarizeFlowChange(previous, flow).changed : true;
            }
            catch {
                semanticallyChanged = false;
            }
            try {
                await this.deps.store.saveOrchestration(s.id, flow);
                this.log().debug(`[visual-workflow] 运行事实源已随画布保存刷新：run=${s.id} flow=${flowId}`);
            }
            catch (error) {
                // 事实源刷新失败不阻断保存主流程（next 调度前 currentResolvedFlow 仍会
                // 显式重读最新实例，双向同步①的兜底路径生效）。
                this.log().warn(`[visual-workflow] 运行事实源刷新失败：${messageOf(error)}`);
                continue;
            }
            if (!semanticallyChanged) {
                this.log().debug(`[visual-workflow] 画布保存仅几何改动，不注入编排变更：run=${s.id}`);
                continue;
            }
            if (s.status !== 'running')
                continue;
            this.notifyOrchestrationChange(entry, flow);
        }
    }
    /**
     * 向父代理注入【编排变更】通知（运行中画布保存且编排语义变更时调用）。
     * 通道选择（用户裁决）：父代理回合进行中（status='running'）且具备 steer → 插队
     * 注入（下一步边界即见，与 wf_ask_agent 超时通知同通道）；否则用 followupRoot 唤醒
     * （父代理空闲时也能收到）。注入失败仅告警，绝不阻断画布保存主流程。
     */
    notifyOrchestrationChange(entry, flow) {
        const sessionId = entry.snapshot.sessionId;
        try {
            const root = this.deps.agents.getRootAgent(sessionId);
            if (!root) {
                this.log().warn('[visual-workflow] 编排变更通知失败：父代理未激活');
                return;
            }
            const text = buildOrchestrationChangeText({
                workflowName: flow.name ?? flow.id,
                definitionPath: this.deps.store.orchestrationFilePath(entry.snapshot.id),
                systemLanguage: this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
            });
            const id = this.deps.uuid?.() ?? randomUUID();
            if (root.status === 'running' && typeof root.steer === 'function') {
                root.steer(coordinatorMessage(id, text, 'visual-workflow'));
            }
            else {
                this.deps.agents.followupRoot(root, {
                    id,
                    role: 'user',
                    content: [{ type: 'text', text }],
                    source: { kind: 'user' },
                });
            }
            this.log().info(`[visual-workflow] 已向父代理注入编排变更通知：run=${entry.snapshot.id} flow=${entry.snapshot.flowId}`);
        }
        catch (error) {
            this.log().warn(`[visual-workflow] 编排变更通知注入失败：${messageOf(error)}`);
        }
    }
    // ---- 清理 -------------------------------------------------------------------
    /**
     * 清理运行时资源（插件卸载/Service dispose，幂等）：
     * 中止全部运行（阻塞等待随之 reject）并清空内存表。
     * 快照不在此写终态——磁盘上残留的 running/paused 由下次启动 reconcileStaleRuns
     * 标记为 interrupted（可恢复）。
     */
    dispose() {
        this.disposed = true;
        for (const entry of this.runs.values()) {
            try {
                entry.controller.abort('visual-workflow plugin disposed');
            }
            catch {
                // 忽略清理期错误
            }
            this.rejectWaiters(entry);
            this.rejectAsks(entry);
        }
        this.runs.clear();
        this.childIndex.clear();
        this.adopting.clear();
        this.resuming.clear();
    }
    // ---- 内部辅助 ---------------------------------------------------------------
    /** 拒绝某运行的全部阻塞等待器（终止/卸载路径）。 */
    rejectWaiters(entry) {
        for (const waiter of entry.waiters.values()) {
            waiter.reject(new WfError('该工作流已停止', 'WF_CANCELLED'));
        }
        entry.waiters.clear();
    }
    /** 拒绝某运行的全部挂起协作通信（终止/卸载路径：清计时器 + reject + 清表）。 */
    rejectAsks(entry, error = new WfError('该工作流已停止', 'WF_CANCELLED')) {
        for (const pending of entry.asks.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
            pending.reject(error);
        }
        entry.asks.clear();
    }
    /** 持久化 run 快照（尽力而为：失败仅告警，不阻断状态机）。 */
    async persistWarn(entry) {
        try {
            await this.deps.store.saveRun(entry.snapshot);
        }
        catch (error) {
            this.log().warn(`[visual-workflow] run record save failed: ${messageOf(error)}`);
        }
    }
}
//# sourceMappingURL=runtime-base.js.map
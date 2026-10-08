// src/host/orchestrator/runtime-execute.ts
//
// 编排运行时节点执行层（RuntimeExecute extends RuntimeLaunch）：wf_run_node
// （异步/暂停门/阻塞三路径）与 wf_finish（父代理收尾，幂等）。方法体逐字移动。
//
// 运行锁降权（用户裁决）：两者的运行上下文获取统一经 ensureActiveRun——本会话停在
// paused/stopped/interrupted 断点时自动续跑接管，不再以 WF_PAUSED/WF_STOPPED 阻断。
import { WF_RUN_NODE_WAIT } from '../shared/protocol.js';
import { nodeById } from '../graph/index.js';
import { DEFAULT_SYSTEM_LANGUAGE } from '../system-language.js';
import { buildTeamExperienceBlock } from '../prompts/index.js';
import { collabPromptOf, labelOf } from './graph-facts.js';
import { effectiveReactLimitOf, effectiveRetryLimitOf, effectiveThinkingOf } from './node-params.js';
import { buildNodeBlocks } from './task-blocks.js';
import { buildTeamExperienceQuery } from './team-experience.js';
import { WfError, messageOf } from './errors.js';
import { createWaiter } from './run-entry.js';
import { setNodeStatus, statusText, terminalizeNodes } from './snapshot.js';
import { GLOBAL_RUN_CALL_LIMIT } from './seams.js';
import { RuntimeLaunch } from './runtime-launch.js';
export class RuntimeExecute extends RuntimeLaunch {
    // ---- wf_run_node ----------------------------------------------------------
    /** 校验调用者为「当前会话根 Agent」并取可直接执行节点的激活运行（必要时自动续跑）。 */
    async requireRootRun(caller, toolName) {
        if (caller.isChild)
            throw new WfError(`子代理无法调用 ${toolName}（仅当前会话主 Agent 可调度编排）`, 'WF_NOT_ROOT');
        const sessionId = caller.sessionId;
        if (!sessionId)
            throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER');
        // 运行锁降权（用户裁决）：本会话存在暂停/已停止/已中断的断点时不报错，
        // 而是自动续跑接管（等价用户在工作台点「运行」）——「继续」由父代理按语义触发。
        const run = await this.ensureActiveRun(sessionId);
        if (!run) {
            // 本会话既无激活运行、也无任何可恢复断点：确实是「从未启动过运行」。
            // 此时插件拿不到任何 workflow 实例依据（无断点即无 flowId），只能给出可行动提示。
            throw new WfError('当前没有正在运行的工作流编排，也没有可恢复的断点（请先在画布点击「运行」）', 'WF_NO_ACTIVE_RUN');
        }
        if (run.snapshot.status !== 'running') {
            // 自动续跑未能生效（例如工作流已不完整）——给出终态文案，不静默
            throw new WfError(`该工作流已${statusText(run.snapshot.status)}，无法继续执行`, 'WF_STOPPED');
        }
        return run;
    }
    /**
     * wf_run_node：启动一个角色节点的子代理。
     *   - 默认异步（模式一）：立即返回 { nodeId, status:'started', childId }；
     *   - wait:true 阻塞（模式二）：等待该节点子代理完成，返回 { nodeId, status:'ok'|'fail', childId, output }；
     *   - 暂停节点：触发暂停门（run=paused + 断点持久化 resumeFrom=暂停节点，锁保留）；
     *   - 本会话停在 paused/stopped/interrupted 断点时：**先自动续跑**（新 run 接管锁 +
     *     注入断点继续指令）再执行本次调度——用户在工作台点「运行」不再是必需动作。
     */
    async wfRunNode(caller, args, callerSignal, options = {}) {
        const run = await this.requireRootRun(caller, options?.expectedMode === 'mode2' ? WF_RUN_NODE_WAIT : 'wf_run_node');
        // 模式与工具一一对应：wf_run_node 仅流程编排模式，wf_run_node_wait 仅API服务模式
        if (options?.expectedMode && run.snapshot.mode !== options.expectedMode) {
            throw new WfError(options.expectedMode === 'mode2'
                ? 'wf_run_node_wait 只能在API服务模式（mode2）中使用'
                : 'wf_run_node 只能在流程编排模式（mode1）中使用', 'WF_MODE_MISMATCH');
        }
        const nodeId = String(args?.nodeId ?? '').trim();
        if (!nodeId)
            throw new WfError('wf_run_node 需要参数 nodeId', 'WF_BAD_ARGS');
        if (run.controller.signal.aborted)
            throw new WfError('该工作流已停止', 'WF_CANCELLED');
        // 执行者模式：父代理开始调度（首次 wf_run_node 成功前）→ 自身节点任务视为完成，
        // 快照标记 ok 并把父代理最近产出回写（下游 ctx 连线可注入该产出）
        this.markParentExecutorDone(run);
        // 双向同步①：每次调度前重读最新工作流快照（运行中画布调整即时生效）
        const flow = await this.currentResolvedFlow(run);
        // 虚拟节点解析为主节点（共享同一子代理执行实例）
        let node = nodeById(flow, nodeId);
        if (!node)
            throw new WfError(`节点不存在或已从画布移除：${nodeId}`, 'WF_NODE_MISSING');
        if (node.kind === 'proxy') {
            const source = nodeById(flow, node.proxySourceId);
            if (!source)
                throw new WfError(`虚拟节点引用的主节点不存在：${node.proxySourceId}`, 'WF_NODE_MISSING');
            node = source;
        }
        // 暂停门：暂停节点不派生子代理，run 置 paused + 断点持久化
        if (node.kind === 'pause') {
            run.callCount += 1;
            if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
                throw new WfError(`编排执行超过全局调用上限（${GLOBAL_RUN_CALL_LIMIT} 次 wf_run_node）`, 'WF_GLOBAL_LIMIT');
            }
            run.lastActiveAt = this.now();
            setNodeStatus(run.snapshot, nodeId, 'ok', { attempts: 1, output: '（暂停门）暂停运行', now: this.now() });
            run.snapshot.status = 'paused';
            run.snapshot.resumeFromNodeId = nodeId;
            await this.persistWarn(run);
            return { nodeId, status: 'paused' };
        }
        // 协作组：整组交给官方 Agent Team（成员数量与成员参数由画布决定）。
        // 仅模式一支持：模式二的阻塞等待语义与团队异步协作不匹配，保持既有「非 agent 节点」拒绝。
        if (node.kind === 'group') {
            if (run.snapshot.mode !== 'mode1') {
                throw new WfError(`wf_run_node_wait 不接受协作组节点；「${labelOf(node)}」请逐个启动其成员节点`, 'WF_NODE_KIND');
            }
            return await this.runGroupNode(run, flow, node, args);
        }
        if (node.kind !== 'agent') {
            throw new WfError(`wf_run_node 只接受角色(agent)节点；「${labelOf(node)}」类型为 ${node.kind}`, 'WF_NODE_KIND');
        }
        // 虚拟节点解析后一切以主节点 key 记账（共享同一子代理执行实例与快照记录）
        const resolvedNodeId = node.id;
        // 硬护栏：全局调用上限 + 单节点重试上限
        run.callCount += 1;
        if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
            throw new WfError(`编排执行超过全局调用上限（${GLOBAL_RUN_CALL_LIMIT} 次 wf_run_node），自动停止`, 'WF_GLOBAL_LIMIT');
        }
        const attempt = (run.attempts.get(resolvedNodeId) ?? 0) + 1;
        run.attempts.set(resolvedNodeId, attempt);
        const effectiveRetryLimit = effectiveRetryLimitOf(node, args, this.deps.config.retryLimitDefault);
        if (attempt > effectiveRetryLimit + 1) {
            throw new WfError(`节点「${labelOf(node)}」执行次数超过上限（最多 ${effectiveRetryLimit} 次重试）`, 'WF_RETRY_LIMIT');
        }
        const effectiveReactLimit = effectiveReactLimitOf(node, args, this.deps.config.reactIterationLimitDefault);
        const thinking = effectiveThinkingOf(node, args);
        run.lastActiveAt = this.now();
        // 启动子代理之前，为其 db-in 所连本地库预建索引：把构建耗时吸收到启动阶段，
        // 避免子代理首次检索才构建（延迟/「无索引」间歇）。best-effort：构建缺失/失败
        // 不阻塞节点启动，交由 wf_db_query(mode=search) 的惰性构建兜底。
        // 能力经依赖缝注入（编排器不反向依赖数据工具域）。
        if (this.deps.dbIndexer) {
            await this.deps.dbIndexer.ensureIndexes(resolvedNodeId, flow);
        }
        setNodeStatus(run.snapshot, resolvedNodeId, 'running', { attempts: attempt, now: this.now() });
        const blocks = buildNodeBlocks({
            flow,
            node,
            snapshot: run.snapshot,
            documentTextLimit: this.deps.config.documentTextLimit,
            systemLanguage: this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
        });
        // wait:true 阻塞等待器必须先于启动注册（subagent/end 可能在启动返回前到达）
        const waitRequested = args?.wait === true;
        const waitKey = `${run.snapshot.id}:${resolvedNodeId}`;
        let waiter = null;
        if (waitRequested) {
            if (run.waiters.has(waitKey)) {
                throw new WfError(`节点「${labelOf(node)}」已有阻塞等待中的执行`, 'WF_BUSY');
            }
            waiter = createWaiter();
            run.waiters.set(waitKey, waiter);
        }
        try {
            const { childId, replacedChildId } = await this.deps.runner.startNodeTask({
                sessionId: run.snapshot.sessionId,
                flowId: run.snapshot.flowId,
                mode: run.snapshot.mode,
                node,
                blocks,
                signal: run.controller.signal,
                collabPrompt: collabPromptOf(flow, node.id),
                ...(thinking !== undefined ? { thinking } : {}),
                ...(effectiveReactLimit !== undefined ? { iterationLimit: effectiveReactLimit } : {}),
            });
            // 子代理重建（配置签名变化）：旧 child 已由引擎尽力中断，编排器侧把它的登记
            // **退役**并从 inflight 摘除——不删表项（否则其迟到事件走「未登记」重试路径刷
            // 告警），而是标记 retired 使其 subagent/end 静默丢弃。否则旧配置的产出会经同一
            // nodeId 覆写新子代理正在推进的节点状态（节点状态错位）。
            // 必须同时摘除 inflight：旧 child 被中断后可能不再产生 subagent/end，若留在
            // inflight 会让空闲看护永远认为「仍有子代理在跑」而永不收敛（该节点在途执行者
            // 已由新 child 代表，语义上不需要两个）。
            if (replacedChildId !== undefined) {
                run.inflight.delete(replacedChildId);
                const retired = this.childIndex.get(replacedChildId);
                if (retired)
                    this.childIndex.set(replacedChildId, { ...retired, retired: true });
            }
            run.inflight.add(childId);
            this.childIndex.set(childId, { sessionId: run.snapshot.sessionId, flowId: run.snapshot.flowId, nodeId: resolvedNodeId });
            this.childByNode.set(resolvedNodeId, childId);
            if (!waitRequested)
                return { nodeId: resolvedNodeId, status: 'started', childId };
        }
        catch (error) {
            if (waiter)
                run.waiters.delete(waitKey);
            if (run.snapshot.status === 'running')
                setNodeStatus(run.snapshot, resolvedNodeId, 'fail', { attempts: attempt, now: this.now() });
            throw error;
        }
        // wait 阻塞：等待 subagent/end 唤醒（完成）或运行终止/调用取消（reject）
        const onAbort = () => {
            run.waiters.delete(waitKey);
            waiter.reject(new WfError('该工作流已停止', 'WF_CANCELLED'));
        };
        if (callerSignal && !callerSignal.aborted)
            callerSignal.addEventListener('abort', onAbort, { once: true });
        else if (callerSignal?.aborted)
            onAbort();
        try {
            return await waiter.promise;
        }
        finally {
            callerSignal?.removeEventListener('abort', onAbort);
        }
    }
    // ---- 协作组（官方 Agent Team） ---------------------------------------------
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
    async runGroupNode(run, flow, group, args) {
        const sessionId = run.snapshot.sessionId;
        const groupId = group.id;
        const memberIds = [...new Set((group.data.memberIds ?? []).map((id) => String(id ?? '')).filter(Boolean))];
        if (memberIds.length === 0) {
            throw new WfError(`协作组「${labelOf(group)}」没有成员，无法启动`, 'WF_GROUP_EMPTY');
        }
        if (args?.wait === true) {
            throw new WfError(`协作组「${labelOf(group)}」不支持阻塞等待；请用 wf_run_node 异步启动`, 'WF_GROUP_WAIT_UNSUPPORTED');
        }
        const runner = this.deps.runner;
        const startGroup = runner.startGroupTask;
        const recall = this.deps.teamExperienceContext;
        if (typeof startGroup !== 'function' || runner.teamAvailable?.(sessionId) !== true) {
            throw new WfError(`未启用官方 Agent Team 能力，无法整组启动协作组「${labelOf(group)}」。` +
                `请改为逐个调用 wf_run_node 启动成员节点 [${memberIds.join(', ')}]。`, 'WF_TEAM_UNAVAILABLE');
        }
        // 硬护栏与单节点路径同口径（全局调用上限 + 组级尝试计数 + 组级参数覆盖）
        run.callCount += 1;
        if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
            throw new WfError(`编排执行超过全局调用上限（${GLOBAL_RUN_CALL_LIMIT} 次 wf_run_node），自动停止`, 'WF_GLOBAL_LIMIT');
        }
        const attempt = (run.attempts.get(groupId) ?? 0) + 1;
        run.attempts.set(groupId, attempt);
        const effectiveRetryLimit = effectiveRetryLimitOf(group, args, this.deps.config.retryLimitDefault);
        if (attempt > effectiveRetryLimit + 1) {
            throw new WfError(`协作组「${labelOf(group)}」执行次数超过上限（最多 ${effectiveRetryLimit} 次重试）`, 'WF_RETRY_LIMIT');
        }
        const effectiveReactLimit = effectiveReactLimitOf(group, args, this.deps.config.reactIterationLimitDefault);
        const thinking = effectiveThinkingOf(group, args);
        run.lastActiveAt = this.now();
        // 成员解析与护栏校验：整组启动的唯一前置。成员任务文本随校验一并取回，
        // 供 Team 经验召回查询使用（不必二次解析）。
        const memberTasks = [];
        for (const memberId of memberIds) {
            const member = nodeById(flow, memberId);
            if (!member || member.kind !== 'agent') {
                throw new WfError(`协作组成员必须是角色(agent)节点：${memberId}`, 'WF_NODE_KIND');
            }
            memberTasks.push({ label: labelOf(member), task: String(member.data.systemPrompt ?? '') });
        }
        // 确认要启动协作组后立即置位（Team 经验类型判定依据）：此刻父代理已承担 Team Leader
        // 职责并正在建立团队，故本组自己的经验召回也可见该事实（否则每个 run 的首个组永远
        // 召回不到 Team 经验）。
        // 置位起至 startGroup 返回结果为止的**任何**失败都回滚，保证该事实只在确实建立过
        // Team 时为真（置位之前的护栏/成员校验失败尚未置位，无需回滚）。
        this.markTeamStarted(run);
        // Team 经验共享上下文（§15）：召回**一次**，把同一份文本追加给每个成员。
        // 为什么在成员任务块构建之前取回：成员计划一旦生成即不再改写，注入必须在组装前完成。
        // 失败语义：召回缝抛错只告警并继续启动组（辅助路径不阻断协作）。
        const query = buildTeamExperienceQuery({
            sessionId,
            flowId: run.snapshot.flowId,
            groupId,
            groupLabel: labelOf(group),
            collabPrompt: String(group.data.collabPrompt ?? ''),
            members: memberTasks,
        });
        let experienceText = null;
        if (typeof recall === 'function') {
            try {
                const recalled = await recall({ sessionId, flowId: run.snapshot.flowId, groupId, query });
                experienceText = buildTeamExperienceBlock(String(recalled ?? '')) || null;
            }
            catch (error) {
                this.log().warn(`[visual-workflow] 团队经验上下文召回失败：${messageOf(error)}`);
            }
        }
        // 成员任务块：与单节点路径同一构建器；协作块使用官方通道文案（send_message + 成员名）
        const plans = [];
        for (const memberId of memberIds) {
            const member = nodeById(flow, memberId);
            if (!member || member.kind !== 'agent') {
                throw new WfError(`协作组成员必须是角色(agent)节点：${memberId}`, 'WF_NODE_KIND');
            }
            // 成员 db-in 索引预建：与单节点路径同一时机（启动前吸收构建耗时；best-effort）
            if (this.deps.dbIndexer)
                await this.deps.dbIndexer.ensureIndexes(memberId, flow);
            const blocks = buildNodeBlocks({
                flow,
                node: member,
                snapshot: run.snapshot,
                documentTextLimit: this.deps.config.documentTextLimit,
                systemLanguage: this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
                collabChannel: 'official',
            });
            if (experienceText)
                blocks.push({ type: 'text', text: experienceText });
            plans.push({
                node: member,
                blocks,
                ...(thinking !== undefined ? { thinking } : {}),
                ...(effectiveReactLimit !== undefined ? { iterationLimit: effectiveReactLimit } : {}),
            });
        }
        setNodeStatus(run.snapshot, groupId, 'running', { attempts: attempt, now: this.now() });
        // 组是否真正建立：startGroup 未返回结果（抛错或返回 null）即视为未建立
        let groupEstablished = false;
        let result;
        try {
            result = await startGroup.call(runner, {
                sessionId,
                flowId: run.snapshot.flowId,
                mode: 'mode1',
                groupId,
                collabPrompt: String(group.data.collabPrompt ?? ''),
                members: plans,
                signal: run.controller.signal,
            });
            groupEstablished = result !== null;
        }
        catch (error) {
            if (!groupEstablished)
                this.unmarkTeamStarted(run);
            if (run.snapshot.status === 'running') {
                setNodeStatus(run.snapshot, groupId, 'fail', { attempts: attempt, now: this.now() });
            }
            throw error;
        }
        if (!result) {
            // 启动瞬间能力消失（服务卸载/根 Agent 退出）：回退指令要显式，不静默留下 running 组卡片
            this.unmarkTeamStarted(run);
            setNodeStatus(run.snapshot, groupId, 'fail', { attempts: attempt, now: this.now() });
            throw new WfError(`官方 Agent Team 在启动协作组「${labelOf(group)}」时不可用；` +
                `请改为逐个调用 wf_run_node 启动成员节点 [${memberIds.join(', ')}]。`, 'WF_TEAM_UNAVAILABLE');
        }
        // 登记成员会话归属：成员 subagent/end 据此回写各自节点状态（与单节点路径同一张表）
        for (const member of result.members) {
            run.inflight.add(member.childId);
            this.childIndex.set(member.childId, { sessionId, flowId: run.snapshot.flowId, nodeId: member.nodeId });
            this.childByNode.set(member.nodeId, member.childId);
        }
        await this.persistWarn(run);
        return {
            nodeId: groupId,
            status: 'started',
            members: result.members.map((member) => ({ nodeId: member.nodeId, target: member.target, childId: member.childId })),
        };
    }
    // ---- wf_finish ------------------------------------------------------------
    /**
     * wf_finish：父代理收尾信号 → 写完成/失败记录并释放运行锁。幂等。
     * 运行锁降权（用户裁决）：本会话停在 paused/stopped/interrupted 断点时先自动续跑接管
     * （父代理在续跑指令下重新读到事实源、确认流程已走完后收尾），不再报 WF_NO_ACTIVE_RUN；
     * 只有「本会话既无激活运行也无任何可恢复断点」才按旧语义返回终态幂等/报错。
     */
    async wfFinish(caller, args) {
        if (caller.isChild)
            throw new WfError('子代理无法调用 wf_finish（仅当前会话主 Agent 可收尾编排）', 'WF_NOT_ROOT');
        const sessionId = caller.sessionId;
        const run = sessionId ? await this.ensureActiveRun(sessionId) : null;
        // 执行者模式：wf_finish 同样视为父代理自身任务完成（无后续调度、直接收尾的流程）
        if (run)
            this.markParentExecutorDone(run);
        // 已停止/已完成的幂等：允许对已终止的同会话运行静默返回。
        // 终态条目已从内存释放（防内存膨胀），故幂等判定查磁盘历史（收尾调用频率极低）。
        if (!run) {
            try {
                for (const runId of await this.deps.store.listAllRunIds()) {
                    const record = await this.deps.store.getRun(runId);
                    if (record && record.sessionId === sessionId && record.status !== 'running') {
                        return { ok: true, runId: record.id, status: record.status, idempotent: true };
                    }
                }
            }
            catch {
                // 磁盘读失败按无历史处理
            }
            throw new WfError('当前没有正在运行的工作流编排', 'WF_NO_ACTIVE_RUN');
        }
        const snapshot = run.snapshot;
        if (snapshot.status !== 'running')
            return { ok: true, runId: snapshot.id, status: snapshot.status, idempotent: true };
        const isFailed = args?.status === 'failed';
        snapshot.status = isFailed ? 'failed' : 'completed';
        snapshot.summary = String(args?.summary ?? '');
        snapshot.endedAt = this.isoNow();
        terminalizeNodes(snapshot, this.now(), isFailed ? 'fail' : 'completed');
        await this.persistWarn(run);
        // 收尾完成即释放内存条目（终态已持久化；运行锁随状态自然释放）
        this.releaseRunMemory(snapshot.id);
        // 终态写盘且锁已释放之后通知宿主（best-effort：失败只告警，不影响收尾结果）
        this.notifyRunTerminal(run);
        return { ok: true, runId: snapshot.id, status: snapshot.status };
    }
}
//# sourceMappingURL=runtime-execute.js.map
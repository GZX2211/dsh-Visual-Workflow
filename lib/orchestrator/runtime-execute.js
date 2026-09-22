// src/host/orchestrator/runtime-execute.ts
//
// 编排运行时节点执行层（RuntimeExecute extends RuntimeLaunch）：wf_run_node
// （异步/暂停门/阻塞三路径）与 wf_finish（父代理收尾，幂等）。方法体逐字移动。
//
// 运行锁降权（用户裁决）：两者的运行上下文获取统一经 ensureActiveRun——本会话停在
// paused/stopped/interrupted 断点时自动续跑接管，不再以 WF_PAUSED/WF_STOPPED 阻断。
import { WF_RUN_NODE_WAIT } from '../shared/protocol.js';
import { nodeById } from '../graph/model.js';
import { DEFAULT_SYSTEM_LANGUAGE } from '../system-language.js';
import { collabPromptOf, labelOf } from './graph-facts.js';
import { effectiveReactLimitOf, effectiveRetryLimitOf, effectiveThinkingOf } from './node-params.js';
import { buildNodeBlocks } from './task-blocks.js';
import { WfError } from './errors.js';
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
            const { childId } = await this.deps.runner.startNodeTask({
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
        this.runs.delete(snapshot.id);
        return { ok: true, runId: snapshot.id, status: snapshot.status };
    }
}
//# sourceMappingURL=runtime-execute.js.map
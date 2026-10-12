// src/host/orchestrator/runtime-launch.ts
//
// 编排运行时启动层（RuntimeLaunch extends RuntimeBase）：startRun（模式一/二
// 全新启动）与 resumeRun（paused/interrupted 断点续跑）。方法体逐字移动。
import { randomUUID } from 'node:crypto';
import { buildResumedSnapshot, findResumableRun } from './resume.js';
import { createRunSnapshot, setNodeStatus, statusText } from './snapshot.js';
import { effectiveOrgMeta, freezeOrgMeta, metaOfDocument, normalizeOrgMeta, orgBudgetOf, orgUsageOf } from '../graph/index.js';
import { buildOrgBudgetText } from '../prompts/index.js';
import { buildParentRunPrompt } from './directive.js';
import { missingStageLabels, validateFlowForRun } from './graph-facts.js';
import { WfError, messageOf } from './errors.js';
import { DEFAULT_SYSTEM_LANGUAGE } from '../system-language.js';
import { RuntimeBase } from './runtime-base.js';
import { prepareRunInputs, executionOf } from './execution-inputs.js';
import { runtimeInputsOf, inputSlotsOf, handoffPolicyOf, validateRequiredInputs, publicRuntimeInputs } from "./runtime-inputs.js";
import { boundNodeInputs, workflowInputTarget } from "./input-handoff.js";
import { ctxInEdges, isFlowLine, mainNodeIdOf, nodeById } from "../graph/index.js";
/**
 * 本次运行「组织预算」末段文本（自主编排方案 §6.4；P2 正式接入）。
 * 口径 = 快照冻结元参数（D-13 第三层：运行期不再重读模板/实例）+ 当前图规模 → **剩余量**。
 * 闸门已用次数据快照的 `milestoneUsed`（D-21：不含首次编排；P3 起由 mark_node 递增）。
 * 纯函数：同一快照与图两次调用字节相同；预算文本不是运行必需条件，调用侧不因它失败。
 */
function orgBudgetTextOf(snapshot, flow) {
    const meta = normalizeOrgMeta(snapshot.meta ?? {});
    const milestoneUsed = Math.max(0, Math.floor(Number(snapshot.milestoneUsed) || 0));
    return buildOrgBudgetText(orgBudgetOf(meta, orgUsageOf(flow, { milestoneUsed })));
}
export class RuntimeLaunch extends RuntimeBase {
    /**
     * 协作通道判定（编排指令与成员任务块的唯一分支依据）：
     * 官方 Agent Team 可用（服务已挂载 + 根 Agent 存活 + 有可用 provider）→ official；
     * 否则 legacy（父代理逐个启动成员节点，成员间用插件自建协作工具）。
     * 判据由子代理引擎提供，编排器不直接触达官方服务。
     */
    collabChannelOf(sessionId) {
        return this.deps.runner.teamAvailable?.(sessionId) === true ? 'official' : 'legacy';
    }
    async prepareRuntimeInputs(flow, snapshot, raw, policy) {
        if (policy !== undefined || snapshot.handoffPolicy !== undefined)
            snapshot.handoffPolicy = handoffPolicyOf(policy ?? snapshot.handoffPolicy);
        const access = { sessionId: snapshot.sessionId, managedRoot: this.deps.store.root, files: await this.deps.sessionInputFiles?.(snapshot.sessionId) ?? [] };
        if (raw !== undefined || snapshot.runtimeInputs !== undefined || access.files.length === 1) {
            const inputs = await runtimeInputsOf(raw ?? snapshot.runtimeInputs ?? {}, flow, access);
            const target = Object.values(inputs.workflowInputs).some((values) => values.length) ? workflowInputTarget(flow) : undefined;
            let selected = false;
            // A single authorized candidate can satisfy one declared file slot per node; no business inference.
            if (access.files.length === 1)
                for (const node of flow.nodes)
                    if (node.kind === "agent" && !snapshot.nodes.find((record) => record.nodeId === node.id)?.resumed) {
                        // Explicit ctx and deterministic upstream handoff keep their existing source semantics.
                        if (ctxInEdges(flow, node.id).length || executionOf(node).requiredFiles?.length || snapshot.handoffPolicy === "auto" && flow.lines.some((line) => isFlowLine(line) && (mainNodeIdOf(flow, line.target) ?? line.target) === node.id && nodeById(flow, mainNodeIdOf(flow, line.source) ?? line.source)?.kind === "agent"))
                            continue;
                        const slots = Object.entries(executionOf(node).inputs ?? {}).filter(([, requirement]) => requirement.kind === "file" && requirement.required !== false);
                        if (slots.length !== 1 || boundNodeInputs({ ...snapshot, runtimeInputs: inputs, workflowInputNodeId: target }, node.id)[slots[0][0]]?.length)
                            continue;
                        const { attachmentId, name, bytes } = access.files[0];
                        const authorized = await inputSlotsOf({ [slots[0][0]]: [{ kind: "file", fileRef: { source: "attachment", attachmentId, name, bytes } }] }, `nodeInputs.${node.id}`, access);
                        Object.assign(inputs.nodeInputs[node.id] ??= {}, authorized);
                        selected = true;
                    }
            if (raw !== undefined || snapshot.runtimeInputs !== undefined || selected) {
                snapshot.runtimeInputs = inputs;
                snapshot.inputRevision = (snapshot.inputRevision ?? 0) + (raw !== undefined || selected ? 1 : 0);
                snapshot.workflowInputNodeId = target;
            }
        }
        // Downstream inputs may be produced later. Initial and explicitly targeted required inputs are checked before orchestration.
        for (const node of flow.nodes)
            if (node.kind === "agent" && !snapshot.nodes.find((record) => record.nodeId === node.id)?.resumed && Object.keys(executionOf(node).inputs ?? {}).length) {
                const incoming = flow.lines.filter((line) => line.targetHandle === "flow-in" && (mainNodeIdOf(flow, line.target) ?? line.target) === node.id);
                if (incoming.every((line) => nodeById(flow, mainNodeIdOf(flow, line.source) ?? line.source)?.kind === "start") || snapshot.runtimeInputs?.nodeInputs[node.id])
                    validateRequiredInputs(node, boundNodeInputs(snapshot, node.id));
            }
    }
    async runtimeInputOptions(input) {
        const flow = await this.deps.store.getWorkflow(input.sessionId, input.flowId);
        if (!flow)
            throw new WfError("工作流不存在", "WF_NOT_FOUND");
        const checkpoint = await findResumableRun(this.deps.store, input);
        const nodeInputs = {};
        for (const node of flow.nodes)
            if (node.kind === "agent")
                nodeInputs[node.id] = executionOf(node).inputs ?? {};
        const files = (await this.deps.sessionInputFiles?.(input.sessionId) ?? []).map(({ attachmentId, name, bytes }) => ({ attachmentId, name, bytes }));
        let initialNodeId;
        try {
            initialNodeId = workflowInputTarget(flow);
        }
        catch (error) {
            if (!(error instanceof WfError) || error.code !== "WF_INPUT_AMBIGUOUS")
                throw error;
        }
        return { nodeInputs, files, ...(initialNodeId ? { initialNodeId } : {}), handoffPolicy: checkpoint?.handoffPolicy ?? (checkpoint && !checkpoint.harnessContext ? "explicit" : undefined), ...(checkpoint ? { checkpoint: { runId: checkpoint.id, runtimeInputs: publicRuntimeInputs(checkpoint.runtimeInputs), handoffPolicy: checkpoint.handoffPolicy } } : {}) };
    }
    /** Pending-node binding uses the dispatch mutex and publishes only after a durable write. */
    async bindRuntimeInputs(input) {
        const entry = this.runs.get(input.runId);
        if (!entry) {
            const previous = await this.deps.store.getRun(input.runId);
            if (previous?.sessionId === input.sessionId)
                throw new WfError("当前运行不能热绑定；请停止仍在运行的流程，通过配置输入并新建运行携带所选输入重新启动", "WF_INPUT_STATE_CONFLICT");
            throw new WfError("运行不存在", "WF_NOT_FOUND");
        }
        if (entry.snapshot.sessionId !== input.sessionId)
            throw new WfError("运行不存在", "WF_NOT_FOUND");
        if (entry.inputBindingDone || entry.dispatching?.size)
            throw new WfError("输入绑定或节点派发尚未完成", "WF_BUSY");
        const assertCurrent = () => {
            if (this.runs.get(input.runId) !== entry || entry.controller.signal.aborted || !["running", "paused"].includes(entry.snapshot.status))
                throw new WfError("运行已停止或被恢复运行替代", "WF_CANCELLED");
            if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (entry.snapshot.inputRevision ?? 0))
                throw new WfError("输入版本已变化，请刷新后重新绑定", "WF_INPUT_REVISION_CONFLICT");
        };
        assertCurrent();
        let release;
        entry.inputBindingDone = new Promise((resolve) => { release = resolve; });
        try {
            const flow = await this.currentResolvedFlow(entry);
            assertCurrent();
            const canonical = mainNodeIdOf(flow, input.nodeId) ?? input.nodeId;
            const target = nodeById(flow, canonical);
            const record = entry.snapshot.nodes.find((node) => node.nodeId === canonical);
            if (target?.kind !== "agent" || record?.status !== "pending" || record.attempts !== 0)
                throw new WfError("只能绑定尚未派发的 Agent；当前节点不能热绑定，请停止当前运行，再配置输入并新建运行", "WF_INPUT_STATE_CONFLICT");
            const authorized = await runtimeInputsOf({ nodeInputs: { [canonical]: input.inputs } }, flow, { sessionId: input.sessionId, managedRoot: this.deps.store.root, files: await this.deps.sessionInputFiles?.(input.sessionId) ?? [] });
            const inputs = { workflowInputs: structuredClone(entry.snapshot.runtimeInputs?.workflowInputs ?? {}), nodeInputs: { ...structuredClone(entry.snapshot.runtimeInputs?.nodeInputs ?? {}), [canonical]: authorized.nodeInputs[canonical] } };
            validateRequiredInputs(target, boundNodeInputs({ ...entry.snapshot, runtimeInputs: inputs }, canonical));
            assertCurrent();
            const next = structuredClone(entry.snapshot);
            next.runtimeInputs = inputs;
            next.inputRevision = input.expectedRevision + 1;
            await this.deps.store.saveRun(next);
            assertCurrent();
            entry.snapshot.runtimeInputs = inputs;
            entry.snapshot.inputRevision = next.inputRevision;
            // Settlements during file authorization belong to the current snapshot, not the earlier copy.
            try {
                await this.deps.store.saveRun(entry.snapshot);
            }
            catch (error) {
                this.log().warn(`输入已绑定；最新结算状态保存失败：${messageOf(error)}`);
            }
            return structuredClone(entry.snapshot);
        }
        finally {
            delete entry.inputBindingDone;
            release();
        }
    }
    // ---- 编排启动 --------------------------------------------------------------
    /**
     * 启动一次「父代理编排」运行（模式一入口）。
     * 流程：校验 → 运行锁 → 建 run 状态 → 写流程事实源文件 → 构造编排指令 →
     * followup 一次性注入+唤醒父代理 → 开始即落盘（崩溃后历史可追溯）。
     * 工作台全局化改版：运行唯一逻辑 = 运行当前实例——run 会话即实例绑定的会话
     * （run.sessionId === instance.sessionId）；「开启新会话」只是创建实例时的
     * 一次性动作（createSession 端点），运行时不再新建会话。
     */
    async startRun(input) {
        const sessionId = String(input.sessionId ?? '');
        const flowId = String(input.flowId ?? '');
        const mode = input.mode ?? 'mode1';
        if (!sessionId || !flowId)
            throw new WfError('requires sessionId and flowId', 'WF_BAD_ARGS');
        // 运行锁护栏：跨会话冲突 / 同会话重复 / 暂停保留锁
        // （登记前还会在同一同步块内重检一次，见 runs.set 前注释——杜绝并发双运行）
        this.assertFlowLockFree(flowId, sessionId);
        const flow = mode === 'mode2'
            ? await this.deps.store.getServiceAsFlow(flowId)
            : await this.deps.store.getWorkflow(sessionId, flowId);
        if (!flow)
            throw new WfError(mode === 'mode2' ? '服务不存在' : '工作流不存在', 'WF_NOT_FOUND');
        // 运行前完整性：启动/输入与结束/输出必须齐备（保存中间态与运行分离）
        const missing = missingStageLabels(flow);
        if (missing.length > 0) {
            throw new WfError(`工作流不完整：缺少${missing.join('、')}节点，无法运行`, 'WF_FLOW_INCOMPLETE');
        }
        const validation = validateFlowForRun(flow);
        if (validation !== null)
            throw validation;
        if (!this.deps.agents.available()) {
            throw new WfError('Agent 能力不可用；父代理编排模式需要会话根 Agent 与可延续子代理', 'WF_AGENT_UNAVAILABLE');
        }
        // 运行基准会话 = 实例绑定的会话（新逻辑：run 与实例同会话，不再运行期新建）
        const runSessionId = sessionId;
        const root = this.deps.agents.getRootAgent(runSessionId);
        if (!root)
            throw new WfError(runSessionId === sessionId ? '当前会话 Agent 未激活；请先在对话区发送一条消息后重试' : '新会话 Agent 未激活，无法启动', 'WF_ROOT_INACTIVE');
        if (root.status === 'running')
            throw new WfError('父代理当前正在忙碌，请稍后再运行', 'WF_ROOT_BUSY');
        // 父代理（会话根 Agent）配置注入：角色 Prompt 段（含 .md 路径读取）+ 官方系统提示词开关 +
        // 工具散文段开关 + 模型/思考强度。非侵入：挂载到根 Agent 的 ctx，仅对本会话生效，不修改官方源码。
        await this.bindParentConfig(flow, root, runSessionId);
        const runId = this.deps.newRunId?.() ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const snapshot = createRunSnapshot({ runId, flow, sessionId: runSessionId, mode, now: this.now() });
        snapshot.workingDirectory = await this.deps.workingDirectory?.(runSessionId);
        if (input.handoffPolicy === undefined)
            snapshot.harnessContext = true;
        await prepareRunInputs(flow, snapshot, input.fileBindings, this.deps.store.root, await this.deps.authorizedInputFiles?.(runSessionId));
        await this.prepareRuntimeInputs(flow, snapshot, input.runtimeInputs, input.handoffPolicy);
        // 元参数三层之第三层（D-13）：把「有效值（模板 ← 实例覆盖）」冻结进快照。
        // 为什么在 startRun 冻结而非每次读取：运行期预算须可审计、可还原；此后改模板/实例
        // 的 meta 不影响本次运行（续跑继承旧冻结值，见 resume.ts 的 buildResumedSnapshot）。
        const parentNode = flow.nodes.find((node) => node.kind === "parent");
        if (parentNode?.kind === "parent")
            snapshot.parentRoute = { provider: parentNode.data.provider, model: parentNode.data.model };
        freezeOrgMeta(snapshot, effectiveOrgMeta(metaOfDocument(flow)));
        // 模式二：用户问题注入输入节点产出（无需连线即作为初始上下文；
        // 右出 ctx 连线经 buildNodeBlocks 的 start 源分支显式传递给下游）
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (mode === 'mode2' && question) {
            const inputNode = flow.nodes.find((n) => n.kind === 'start');
            if (inputNode) {
                setNodeStatus(snapshot, inputNode.id, 'ok', {
                    output: question,
                    outputFullLimit: this.deps.config.outputFullLimit,
                    now: this.now(),
                });
            }
        }
        const entry = {
            controller: new AbortController(),
            snapshot,
            baseFlow: flow,
            inflight: new Set(),
            attempts: new Map(),
            callCount: 0,
            lastActiveAt: this.now(),
            waiters: new Map(),
            asks: new Map(),
        };
        // 运行锁登记（check-then-act 竞态收口）：并发 startRun 可能已在本请求的
        // await 期间登记了同一 flowId 的 run。此处重检 + runs.set 在同一同步块内
        // 完成（Node 单线程内无交错），保证同工作流最多一个激活 run。
        this.assertFlowLockFree(flowId, sessionId);
        this.runs.set(runId, entry);
        // 流程事实源文件（父代理可 read，只读；defPath 注入编排指令）
        const defPath = this.deps.store.orchestrationFilePath(runId);
        try {
            await this.deps.store.saveOrchestration(runId, flow);
            await this.deps.store.saveRun(snapshot);
        }
        catch (error) {
            this.runs.delete(runId);
            throw new WfError(`运行记录或流程定义文件写入失败：${messageOf(error)}`, 'WF_DEF_WRITE_FAILED');
        }
        // 一次性注入 + 唤醒：官方 Message 契约要求 id 与 source 齐备（缺 source 父回合
        // 以 UNKNOWN 失败——旧项目根因复盘结论，必须保留）。
        // 三情况组装（用户评审）：按画布形态判定父代理提示词变体，输出整份自洽提示词：
        //   - 情况1 纯编排：无执行单元，编排指令（orchestrator 变体）；
        //   - 情况2/3 父代理被流程线连接：prepareParentExecutor 先登记执行单元（快照
        //     标记 running、产出执行单元上下文），再按 hybrid/executor 变体组装。
        const executor = await this.prepareParentExecutor(flow, entry);
        const directive = buildParentRunPrompt({
            flow,
            defPath,
            mode,
            ...(question ? { question } : {}),
            executor,
            systemLanguage: this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
            orgBudgetText: orgBudgetTextOf(snapshot, flow),
            collabChannel: this.collabChannelOf(runSessionId),
        });
        try {
            this.deps.agents.followupRoot(root, {
                id: this.deps.uuid?.() ?? randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: directive }],
                source: { kind: 'user' },
            });
        }
        catch (error) {
            snapshot.status = "failed";
            snapshot.summary = `编排指令注入失败：${messageOf(error)}`;
            snapshot.endedAt = this.isoNow();
            await this.persistWarn(entry);
            this.runs.delete(runId);
            throw new WfError(snapshot.summary, "WF_INJECT_FAILED");
        }
        // 运行记录：开始即落盘（中断/崩溃后历史面板仍有记录）
        await this.persistWarn(entry);
        return { runId, defPath, sessionId: runSessionId };
    }
    // ---- 断点续跑（resumeRun） --------------------------------------------------
    /**
     * 断点续跑：从 paused/interrupted 的旧 run 创建新 run（resumedFromRunId 继承链）。
     * 已 ok/react-capped 节点继承状态与完整产出（resumed 标记，不重跑），其余节点
     * 回退 pending 重新执行；断点产出随继承快照重新可用（后续节点 ctx 注入直接用
     * 新快照，无需额外回填通道）。
     * 旧 paused 记录保留在磁盘历史（状态不变），内存条目释放——运行锁随新 run 接管。
     */
    async resumeRun(input) {
        const sessionId = String(input.sessionId ?? '');
        const flowId = String(input.flowId ?? '');
        if (!sessionId || !flowId)
            throw new WfError('requires sessionId and flowId', 'WF_BAD_ARGS');
        const binding = [...this.runs.values()].find((entry) => entry.snapshot.sessionId === sessionId && entry.snapshot.flowId === flowId)?.inputBindingDone;
        if (binding)
            await binding;
        const prev = await findResumableRun(this.deps.store, { sessionId, flowId, fromRunId: input.fromRunId });
        if (!prev) {
            if (input.fromRunId) {
                const run = await this.deps.store.getRun(input.fromRunId);
                if (run && (run.sessionId !== sessionId || run.flowId !== flowId)) {
                    throw new WfError('指定的运行不属于该工作流', 'WF_BAD_ARGS', { runId: input.fromRunId });
                }
                throw new WfError(run ? `该运行已${statusText(run.status)}，无法恢复` : '指定的运行不存在', run ? 'WF_NOT_RESUMABLE' : 'WF_NOT_FOUND', { runId: input.fromRunId });
            }
            throw new WfError('该工作流没有可恢复的断点（暂停或中断记录）', 'WF_NO_RESUME_POINT');
        }
        // 运行锁护栏：同会话 paused 允许恢复（启动后锁移交新 run）；其余冲突拒绝
        // （登记前还会在同一同步块内重检一次，见 runs.set 前注释）
        this.assertResumeLockFree(flowId, sessionId);
        const flow = prev.mode === 'mode2'
            ? await this.deps.store.getServiceAsFlow(flowId)
            : await this.deps.store.getWorkflow(sessionId, flowId);
        if (!flow)
            throw new WfError(prev.mode === 'mode2' ? '服务不存在' : '工作流不存在', 'WF_NOT_FOUND');
        // 运行前完整性（与全新启动同一套校验）
        const missing = missingStageLabels(flow);
        if (missing.length > 0) {
            throw new WfError(`工作流不完整：缺少${missing.join('、')}节点，无法运行`, 'WF_FLOW_INCOMPLETE');
        }
        const validation = validateFlowForRun(flow);
        if (validation !== null)
            throw validation;
        if (!this.deps.agents.available()) {
            throw new WfError('Agent 能力不可用；父代理编排模式需要会话根 Agent 与可延续子代理', 'WF_AGENT_UNAVAILABLE');
        }
        const root = this.deps.agents.getRootAgent(sessionId);
        if (!root)
            throw new WfError('当前会话 Agent 未激活；请先在对话区发送一条消息后重试', 'WF_ROOT_INACTIVE');
        if (root.status === 'running')
            throw new WfError('父代理当前正在忙碌，请稍后再运行', 'WF_ROOT_BUSY');
        // 父代理（会话根 Agent）配置注入：角色 Prompt 段（含 .md 路径读取）+ 官方系统提示词开关 +
        // 工具散文段开关 + 模型/思考强度。非侵入：挂载到根 Agent 的 ctx，仅对本会话生效，不修改官方源码。
        await this.bindParentConfig(flow, root, sessionId);
        const runId = this.deps.newRunId?.() ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const snapshot = buildResumedSnapshot({ prev, runId, flow, sessionId, mode: prev.mode, now: this.now() });
        this.log().info(JSON.stringify({ runId, phase: 'resume', status: 'requested', resumedFromRunId: prev.id, checkpointNodeId: snapshot.checkpointNodeId, resumeNodeIds: snapshot.resumeNodeIds }));
        snapshot.workingDirectory = await this.deps.workingDirectory?.(sessionId) ?? prev.workingDirectory;
        snapshot.runtimeInputs = prev.runtimeInputs ? structuredClone(prev.runtimeInputs) : undefined;
        snapshot.handoffPolicy = prev.handoffPolicy;
        snapshot.inputRevision = prev.inputRevision;
        snapshot.workflowInputNodeId = prev.workflowInputNodeId;
        snapshot.fileBindings = prev.fileBindings ? structuredClone(prev.fileBindings) : undefined;
        snapshot.parentRoute = prev.parentRoute ? { ...prev.parentRoute } : undefined;
        await prepareRunInputs(flow, snapshot, input.fileBindings, this.deps.store.root, await this.deps.authorizedInputFiles?.(sessionId));
        await this.prepareRuntimeInputs(flow, snapshot, input.runtimeInputs, input.handoffPolicy);
        const entry = {
            controller: new AbortController(),
            snapshot,
            baseFlow: flow,
            inflight: new Set(),
            attempts: new Map(),
            callCount: 0,
            lastActiveAt: this.now(),
            waiters: new Map(),
            asks: new Map(),
        };
        // 运行锁登记（check-then-act 竞态收口）：并发 resumeRun/startRun 可能已在本
        // 请求的 await 期间登记同一 flowId 的 run；重检 + 写入同一同步块内完成。
        this.assertResumeLockFree(flowId, sessionId);
        this.runs.set(runId, entry);
        // 流程事实源文件（同 startRun；defPath 注入编排指令）
        const defPath = this.deps.store.orchestrationFilePath(runId);
        try {
            await this.deps.store.saveOrchestration(runId, flow);
            await this.deps.store.saveRun(snapshot);
        }
        catch (error) {
            this.runs.delete(runId);
            throw new WfError(`运行记录或流程定义文件写入失败：${messageOf(error)}`, 'WF_DEF_WRITE_FAILED');
        }
        // 断点继续指令：isResume 动态态注入末段（已 ok 不重跑；从 resumeFromNodeId 继续）。
        // 起点必须取自 buildResumedSnapshot 计算出的新快照（resume.ts 已推断：暂停断点用
        // prev.resumeFromNodeId，interrupted 中断无暂停点时取首个未完成节点）——若直接用
        // prev.resumeFromNodeId，宿主重启中断的恢复会因 undefined 注入「（未指定）」，
        // 父代理无从定位起点、可能从头重调度已 ok 节点（违反 §4.7 规则 6 已执行节点不重跑）。
        // 三情况组装与 startRun 一致；prepareParentExecutor 内部对已 ok/react-capped 的
        // 继承态直接返回 null（不重跑）→ buildParentRunPrompt 按「父单元已完成」以
        // orchestrator 变体组装（剩余运行只有编排/收尾，无自执行任务内容）。
        const executor = await this.prepareParentExecutor(flow, entry);
        const directive = buildParentRunPrompt({
            flow,
            defPath,
            mode: prev.mode,
            resume: { resumeFromNodeId: snapshot.checkpointNodeId, resumeNodeIds: snapshot.resumeNodeIds, resumedFromRunId: prev.id },
            executor,
            systemLanguage: this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
            orgBudgetText: orgBudgetTextOf(snapshot, flow),
            collabChannel: this.collabChannelOf(sessionId),
        });
        try {
            this.deps.agents.followupRoot(root, {
                id: this.deps.uuid?.() ?? randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: directive }],
                source: { kind: 'user' },
            });
        }
        catch (error) {
            snapshot.status = "failed";
            snapshot.summary = `编排指令注入失败：${messageOf(error)}`;
            snapshot.endedAt = this.isoNow();
            await this.persistWarn(entry);
            this.runs.delete(runId);
            throw new WfError(snapshot.summary, "WF_INJECT_FAILED");
        }
        await this.persistWarn(entry);
        // 释放同工作流的旧 paused 内存条目（磁盘历史保留；锁随新 run 接管）
        for (const [oldId, oldEntry] of [...this.runs]) {
            const old = oldEntry.snapshot;
            if (oldId !== runId && old.sessionId === sessionId && old.flowId === flowId && old.status === 'paused') {
                try {
                    oldEntry.controller.abort('resumed');
                }
                catch {
                    // 忽略清理期错误
                }
                this.rejectWaiters(oldEntry);
                this.rejectAsks(oldEntry);
                this.runs.delete(oldId);
            }
        }
        return { runId, defPath, resumedFromRunId: prev.id };
    }
}
//# sourceMappingURL=runtime-launch.js.map
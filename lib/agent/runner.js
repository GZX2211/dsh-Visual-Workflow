// src/host/agent/runner.ts
//
// 节点子代理执行引擎（T-022）：ensureNodeChild / 配置签名复用 / 工具白名单解析 /
// startNodeTask / interruptChild / 软截停消费。
//
// 官方 seam 取证（§8 索引 #1/#6/#7，零官方运行时依赖 W-05；DSH 0.1.5-rc.1 复核）：
//   - ctx.subagents.startContinuable({ provider, label, request: { prompt, parent,
//     persona?, toolFilter?, agentOptions? }, signal }) → { childId, messageId }；
//     request.prompt 是首条 user 消息，创建即开始推理——首次创建必须把完整任务块
//     作为 prompt 注入，否则子代理以「无任务」状态空转（旧项目关键时序结论）；
//   - 复用派发：官方 SubagentRuntime 自 0.1.2 起已无 rc.2 的 followup，改相邻 Agent 通道
//     sendMessage(sender, childId, content, { signal }) / queuePrompt(...)（A4-01）；
//     0.1.5-rc.1 复核：followup 仍不存在，sendMessage 为唯一推荐通道；
//   - ctx.subagents.interrupt(childId, { kind: 'user', parentSessionId })——尽力中断；
//   - 每子代理作用域贡献：官方无 registerContinuableSetup，改为经 agent/session-start
//     事件在创建窗口内按 agent.ctx（发布后的 scoped ctx）安装四类贡献
//     （可见性/软截停/模型选择/角色提示词）——与官方 installModelSelection(agentCtx, …) 范式一致。
//
// 白名单规则（架构文档 §4.2 L219，与旧项目行为差异已标注）：
//   - combo：combo.tools ∩ 可见工具集（父代理工具集）+ 所选 MCP 服务器前缀工具；
//   - 官方 preset：经 agentPresets.standingKeyFor 取 standing scope 工具名 ∩ 可见
//     （服务缺失回退全部可见——旧项目兜底语义）；旧项目 minimal/ptc 硬编码正则
//     列表被真实 preset 解析取代（更精确）；
//   - **无强制追加**：wf_ask/wf_ask_agent 仅在组合勾选时进入 allow（旧项目自动
//     追加 wf_ask 的行为删除——PRD §4.4.2 规则 7 定稿）；
//   - wf_db_query 仅在存在 db-in 连线时追加（§4.4.3 规则 5）；
//   - wf_run_node/wf_finish 永不进入 allow，且经 tools.restrict 显式 deny（双保险）。
import { readFile } from 'node:fs/promises';
import { dbInEdges } from '../graph/model.js';
import { consumeReactCappedOf } from './guards.js';
import { RESERVED_TRANSPORT_TOOL, WF_RUN_NODE, WF_RUN_NODE_WAIT } from '../shared/protocol.js';
// ---------------------------------------------------------------------------
// 纯函数（签名/复用键/provider 选择）
// ---------------------------------------------------------------------------
/** 子代理复用键：sessionId + flowId + nodeId（跨会话同 id 工作流各自独立）。 */
export function childKey(sessionId, flowId, nodeId) {
    return `${sessionId}:${flowId}:${nodeId}`;
}
/**
 * 影响子代理组成的配置签名（变化即重建；工具为解析后的清单）。
 * 字段依据架构文档 §4.2 L218：rolePrompt/provider/model/工具清单/reasoning
 * （另含 presetId——其决定工具清单，签名内显式保留以抵御同名清单歧义；
 * injectSystemPrompt 决定官方系统提示词开关；injectToolSections 决定工具散文段开关；
 * rolePrompt 为角色 Prompt 的实际注入文本——当 .md 文件路径设置时为其当前内容，文件改动即重建）。
 */
export function nodeChildSignature(node, resolvedTools, rolePrompt, injectSystemPrompt = true, injectToolSections = true, collabPrompt = '') {
    const data = node.kind === 'parent' || node.kind === 'agent' ? node.data : undefined;
    return JSON.stringify({
        rolePrompt: String(rolePrompt ?? ''),
        provider: String(data?.provider ?? ''),
        model: String(data?.model ?? ''),
        reasoning: String(data?.reasoning ?? ''),
        presetId: String(data?.presetId ?? ''),
        tools: [...resolvedTools].sort(),
        injectSystemPrompt: injectSystemPrompt !== false,
        injectToolSections: injectToolSections !== false,
        // 协作 Prompt 属于组级配置；变化时同样重建子代理，避免旧协作信息残留
        collabPrompt,
    });
}
/**
 * provider 首选序（spawn > fork > codex > claude-code > dsh-sdk > acp > 首个可用）。
 *
 * 为什么要 spawn 优先（用户裁决 + 官方取证）：
 *   - 官方 `dsh-subagent-fork-in-process`：`inheritsParentContext = true`，其
 *     `prepareContinuable()` 返回 `completedTurnPrefix(parent)` —— 把父代理（编排根
 *     Agent）从会话开头到最近一次 `turn/end` 的整段已完成对话作为种子灌进子代理，
 *     导致节点子代理拿到父代理的编排指令、提示词与完整上下文（越权）。
 *   - 官方 `dsh-subagent-spawn-in-process`：`inheritsParentContext = false`，
 *     `prepareContinuable()` 返回 `{}` —— 子代理是全新会话、own system prompt、
 *     zero parent context。这正是「每个节点独立角色 / 独立上下文」工作流所需语义。
 *   - 若 spawn 未注册（极少数部署只挂 fork）则回退 fork，保证运行仍可用。
 */
const PROVIDER_PREFERENCE = ['spawn', 'fork', 'codex', 'claude-code', 'dsh-sdk', 'acp'];
/** 从可用 provider 清单中挑选（首选序优先，否则清单第一个；无可选返回 null）。 */
export function pickProviderName(available) {
    return PROVIDER_PREFERENCE.find((name) => available.includes(name)) ?? available[0] ?? null;
}
/**
 * 探测可用延续子代理 provider：0.1.2 SubagentRuntime 移除 rc.2 的 list()，改为按名
 * getProvider(name)（未注册返回 undefined）探测候选顺序；旧宿主回退 list() 清单。
 */
export function detectSubagentProvider(service) {
    if (typeof service.getProvider === 'function') {
        return PROVIDER_PREFERENCE.find((name) => service.getProvider(name) !== undefined) ?? null;
    }
    return pickProviderName(service.list?.() ?? []);
}
/** 任务块为空的兜底 prompt（正常路径由 T-021 组装任务块；防御性兜底）。 */
function fallbackPrompt(node) {
    return [
        '你是 Visual Workflow 工作流中的节点子代理。',
        `节点名称：${node.data.label ?? node.id}`,
        '具体任务将随后续消息派发；请按收到的任务要求执行并汇报结论。',
    ].join('\n');
}
/**
 * 解析节点的角色 Prompt 实际注入文本：
 *   - 设置了 promptFilePath（宿主绝对路径）→ 运行时读取该文件（读取失败回退 node.data.systemPrompt）；
 *   - 未设置 → 直接使用 node.data.systemPrompt（内联文本或 .md 内容快照）。
 * 返回的角色文本会纳入子代理签名：文件改动 → 内容变 → 签名变 → 重建子代理 → 自动重载。
 */
export async function resolveRolePrompt(node) {
    const inline = String(node.data?.systemPrompt ?? '');
    const filePath = String(node.data?.promptFilePath ?? '').trim();
    if (!filePath)
        return inline;
    try {
        const content = await readFile(filePath, 'utf8');
        // 文件存在且可读：以文件内容为准（文件修改后新轮自动生效）
        return content;
    }
    catch {
        // 文件不可读（不存在/权限/沙箱拒绝）：回退内联文本，不阻断节点启动
        return inline;
    }
}
/**
 * 真实工具视图适配：并集 = 全局层 ∪ 每个存活 agent 的 scope 视图 ∪ 每个 agent
 * preset 的 standing scope 视图（旧项目 allToolsSchemas 同构移植）。
 * 历史坑注释（旧项目复盘）：scope key 必须是 agent 对象本身，不是 agent.ctx
 * （Cordis Context）——schemas(scope) 按 scope key 查找，传错必然只能看到全局层。
 */
export class CordisToolsView {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    toolsService() {
        const service = this.ctx.get('tools');
        if (service !== null && typeof service === 'object' && typeof service.schemas === 'function') {
            return service;
        }
        return null;
    }
    agentsService() {
        const service = this.ctx.get('agents');
        if (service !== null && typeof service === 'object' && typeof service.get === 'function') {
            return service;
        }
        return null;
    }
    agentPresetsService() {
        const service = this.ctx.get('agentPresets');
        if (service !== null && typeof service === 'object'
            && typeof service.list === 'function'
            && typeof service.standingKeyFor === 'function') {
            return service;
        }
        return null;
    }
    async visibleToolNames(sessionId) {
        const tools = this.toolsService();
        const out = new Set();
        if (tools) {
            const collect = (scope) => {
                const raw = scope === undefined ? tools.schemas() : tools.schemas(scope);
                const list = Array.isArray(raw) ? raw : [];
                for (const schema of list) {
                    const name = String(schema?.name ?? schema?.title ?? '');
                    if (name)
                        out.add(name);
                }
            };
            collect(undefined); // 全局层视图
            // 存活 agent 的 scope 视图（agent 对象即 scope key）
            const agents = this.agentsService();
            if (agents) {
                const candidates = new Set();
                try {
                    for (const root of agents.roots?.() ?? []) {
                        if (root && String(root?.id ?? ''))
                            candidates.add(root);
                    }
                }
                catch {
                    // roots 不可用
                }
                if (sessionId) {
                    try {
                        const agent = agents.get(sessionId);
                        if (agent)
                            candidates.add(agent);
                    }
                    catch {
                        // 会话 agent 不可用
                    }
                }
                for (const agent of candidates)
                    collect(agent);
            }
            // agent preset 的 standing scope key（无存活会话时也能列全各 preset 工具）
            const presets = this.agentPresetsService();
            if (presets) {
                try {
                    const items = await presets.list();
                    for (const item of items ?? []) {
                        const pid = String(item?.id ?? '').trim();
                        if (!pid)
                            continue;
                        try {
                            const key = await presets.standingKeyFor(pid);
                            if (key !== undefined)
                                collect(key);
                        }
                        catch {
                            // 单个 preset 失败跳过
                        }
                    }
                }
                catch {
                    // agentPresets 不可用
                }
            }
        }
        return [...out];
    }
    async presetToolNames(presetId) {
        const tools = this.toolsService();
        const presets = this.agentPresetsService();
        if (!tools || !presets)
            return null;
        try {
            const key = await presets.standingKeyFor(presetId);
            if (key === undefined)
                return null;
            const list = (tools.schemas(key) ?? []);
            return (Array.isArray(list) ? list : [])
                .map((schema) => String(schema?.name ?? schema?.title ?? ''))
                .filter(Boolean);
        }
        catch {
            return null;
        }
    }
    async agentToolNames(sessionId) {
        const tools = this.toolsService();
        if (!tools)
            return [];
        // 优先取当前会话父代理（root agent）scope 视图：全局层 ∪ 父代理链注册工具。
        // scope key 必须是 agent 对象本身（官方 ScopeKey 语义，历史坑见类注释）。
        const agents = this.agentsService();
        let scope;
        if (agents && sessionId) {
            try {
                const agent = agents.get(sessionId);
                if (agent)
                    scope = agent;
            }
            catch {
                // 会话 agent 不可用 → 回退全局层
            }
        }
        const list = (scope === undefined ? tools.schemas() : tools.schemas(scope)) ?? [];
        return (Array.isArray(list) ? list : [])
            .map((schema) => String(schema?.name ?? schema?.title ?? ''))
            .filter(Boolean);
    }
}
/** 子代理永不可见的三工具（§4.4.2 规则 7）：白名单排除 + tools.restrict 双保险第一层。 */
const CHILD_BLOCKED_TOOLS = [WF_RUN_NODE, WF_RUN_NODE_WAIT, 'wf_finish'];
/**
 * 运行时解析节点工具白名单（架构文档 §4.2 L219）：
 *   - presetId 空 → []（无工具）；
 *   - combo- 前缀 → 组合勾选 ∩ 可见工具集 + 所选 MCP 服务器前缀工具（缺失组合报错）；
 *   - 官方 preset → standing scope 工具名 ∩ 可见（服务缺失回退全部可见）；
 *   - db-in 连线存在 → 追加 wf_db_query（§4.4.3 规则 5）；
 *   - wf_run_node/wf_finish 无条件剔除（即便被勾选也不进入子代理）。
 * 注意：无强制追加——wf_ask/wf_ask_agent 仅在组合勾选时进入（PRD §4.4.2 规则 7）。
 */
export async function resolveAgentTools(input) {
    const presetId = String(input.node.data?.presetId ?? '').trim();
    const visible = await input.toolsView.visibleToolNames(input.sessionId);
    let allow;
    if (!presetId) {
        allow = [];
    }
    else if (presetId.startsWith('combo-')) {
        const combos = await input.store.listToolCombos().catch(() => []);
        const combo = combos.find((item) => item.id === presetId);
        if (!combo)
            throw new Error(`工具组合不存在：${presetId}（请重新选择模式）`);
        allow = (combo.tools ?? []).filter((name) => visible.includes(name));
        // 所选 MCP 服务器提供的工具全部加入（mcp__<server>__* 前缀）
        for (const serverName of combo.mcpServers ?? []) {
            const prefix = `mcp__${serverName}__`;
            for (const name of visible) {
                if (name.startsWith(prefix))
                    allow.push(name);
            }
        }
        allow = [...new Set(allow)];
    }
    else {
        const presetNames = await input.toolsView.presetToolNames(presetId);
        allow = presetNames ?? visible;
    }
    // wf_run_node/wf_finish 永不可见（§4.4.2 规则 7 双保险第一层）；
    // 官方保留传输名 run_code 也必须剔除：它由官方自动注入子代理 scope（无需勾选），
    // 且进 allow 名单会让官方 tools.restrict 抛错（core/tools L1085 保留名校验）
    allow = allow.filter((name) => !CHILD_BLOCKED_TOOLS.includes(name) && name !== RESERVED_TRANSPORT_TOOL);
    // 未注册/幽灵工具兜底（core/tools L1088-1091 unknown 校验）：allow 只能取
    // 父代理 scope 视图（全局层 ∪ 父链注册）子集——str_replace_editor 这类仅存在于
    // 无关 preset standing scope 的工具即使被组合勾选也绝不进入 allow，否则子代理
    // 创建时官方 tools.restrict 抛 "names unknown global tool"。取不到视图时跳过（白名单仍兜底）。
    const agentNames = await input.toolsView.agentToolNames(input.sessionId);
    if (agentNames.length > 0) {
        allow = allow.filter((name) => agentNames.includes(name));
    }
    // db-in 连线 → wf_db_query 可选注入（§4.4.3 规则 5：有连线才进入工具集）
    if (await hasDbInLine(input)) {
        if (!allow.includes('wf_db_query'))
            allow.push('wf_db_query');
    }
    // 全局关闭的工具一律剔除（父代理不可见 → 子代理不得携带；配合 UI 置灰禁勾选）
    if (input.disabledTools && input.disabledTools.size > 0) {
        allow = allow.filter((name) => !input.disabledTools.has(name));
    }
    return allow;
}
/** 该节点是否存在 db-in 连线（运行中读最新流程，双向同步①；读失败按无连线处理）。 */
async function hasDbInLine(input) {
    try {
        // 模式二的服务文档在 services/ 目录，getWorkflow 读 workflows/ 恒为 null——
        // 必须按 mode 分派（与 runtime.currentResolvedFlow 的 Bug 20 修复同源），
        // 否则模式二下数据库连线检测失效、wf_db_query 永不注入（需求 §4.4.3 规则 5）。
        const flow = input.mode === 'mode2'
            ? await input.store.getServiceAsFlow(input.flowId)
            : await input.store.getWorkflow(input.sessionId, input.flowId);
        if (!flow)
            return false;
        return dbInEdges(flow, input.node.id).length > 0;
    }
    catch {
        return false;
    }
}
/**
 * 节点子代理执行引擎：每个角色节点 = 一个可延续子代理
 * （ctx.subagents.startContinuable，带持久 Session）。
 *   - 复用键 sessionId:flowId:nodeId；配置签名变化时重建（旧子代理保留历史）；
 *   - 首条创建即把完整任务块作为 prompt 注入（杜绝创建即空转）；
 *   - 复用经相邻 Agent 通道派发本轮任务，立即返回（不阻塞父代理）。
 */
export class NodeAgentRunner {
    deps;
    /** 子代理表：复用键 → { childId, signature }。 */
    nodeChildren = new Map();
    /** 已创建 childId 集合（dispose 清理护栏登记用）。 */
    childIds = new Set();
    /** 软截停消费适配（NodeRunner 契约）。 */
    consumeReactCapped;
    constructor(deps) {
        this.deps = deps;
        this.consumeReactCapped = consumeReactCappedOf(deps.react);
    }
    // ---- NodeRunner 契约 -------------------------------------------------------
    /**
     * 异步启动一个节点任务（消息驱动，立即返回）：
     *   - 首次创建：任务块已在首条 prompt 注入，子代理立即开始执行；
     *   - 复用：经相邻 Agent 通道派发本轮任务；
     *   - 完成事件由编排器监听 subagent/end 更新快照，本方法不等待执行结果。
     */
    async startNodeTask(input) {
        const { childId, created } = await this.ensureNodeChild(input);
        // 每轮派发前刷新护栏上限与模型选择（节点级参数可按次覆盖；官方 selection 可变态）。
        // 【时序】setLimit 必须位于任何 await 之前：子代理本轮第一步推理的 pre-step 事件
        // 一旦触发就读 limits 表——若先派发再登记，新回合（可能换了 limit）的第一步
        // 会读到旧上限/未登记值，软截停延迟生效（guards.ts 对 unknown childId 直接放行）。
        this.deps.react.setLimit(childId, input.iterationLimit);
        const subagents = this.requireSubagents();
        const parent = this.requireParent(input.sessionId);
        if (!created) {
            // 复用子代理：相邻投递派发本轮任务（0.1.5-rc.1：sendMessage 优先，queuePrompt 兜底）
            await this.deliverReuse(subagents, parent, childId, input.blocks, input.signal);
        }
        this.attachModelSelection(childId, input);
        await this.attachPromptState(childId, input);
        return { childId, created };
    }
    /** 尽力中断子代理当前回合（保留会话；官方 interrupt 语义）。 */
    async interruptChild(childId, sessionId) {
        const subagents = this.requireSubagents();
        try {
            // 0.1.2 interrupt 为同步签名 interrupt(target, authority)；rc.2 同形。await 兼容 Promise 形态。
            const outcome = subagents.interrupt?.(childId, { kind: 'user', parentSessionId: sessionId });
            if (outcome !== undefined && typeof outcome.then === 'function') {
                await outcome;
            }
        }
        catch {
            // 已停止/不存在视为成功（旧项目语义）
        }
    }
    /** 清理子代理表与护栏登记（宿主 dispose 调用；不中断子代理——由运行时统一中止）。
     *  每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）由 host 层
     *  `agent/session-start` 处理器在创建窗口内安装，其撤销函数归 host 的
     *  `childScopeDisposers` 管理（见 visual-workflow-host.ts），runner 不再持有。 */
    dispose() {
        for (const childId of this.childIds) {
            this.deps.react.drop(childId);
        }
        this.childIds.clear();
        this.nodeChildren.clear();
    }
    /**
     * 复用子代理的下一回合派发：0.1.2 起 SubagentRuntime 已移除 rc.2 的 followup，改为相邻
     * Agent 通道。优先 sendMessage（免自定义 source：sender 即 live 父代理，来源由服务派生）；
     * 次选 queuePrompt（host distinct turn，**旧版兼容路径**：0.1.5-rc.1 该方法的
     * source/signal 已是必填，调用方需显式给全，故仅作兜底）。
     *
     * 【0.1.5-rc.1 取证】官方 SubagentRuntime **没有** followup 方法
     * （dsh-subagent/lib/types/index.d.ts：startContinuable/sendMessage/interrupt/
     * drainContinuableDescendants/drainContinuableChildren/listChildren/listDescendants/
     * prompt/interruptByParent/registerProvider/getProvider/list/start），故不再设 followup 回退。
     */
    async deliverReuse(subagents, parent, childId, content, signal) {
        if (typeof subagents.sendMessage === 'function') {
            await subagents.sendMessage(parent, childId, content, { ...(signal ? { signal } : {}) });
            return;
        }
        if (typeof subagents.queuePrompt === 'function') {
            await subagents.queuePrompt(parent, childId, content, undefined, signal);
            return;
        }
        throw new Error('subagents 服务不支持复用派发（缺少 sendMessage/queuePrompt）');
    }
    // ---- 子代理创建/复用 ---------------------------------------------------------
    /**
     * 确保节点子代理存在且配置匹配；返回 { childId, created }。
     * 【关键时序】startContinuable 把 request.prompt 作为第一条 user 消息立即提交，
     * 子代理创建即开始第一轮推理——首次创建必须把完整任务块 blocks 作为 prompt 注入。
     */
    async ensureNodeChild(input) {
        const subagents = this.requireSubagents();
        const parent = this.requireParent(input.sessionId);
        const node = input.node;
        const key = childKey(input.sessionId, input.flowId, node.id);
        // 运行时解析工具清单（组合修改即时生效）；白名单 = 勾选 ∩ 可见 + db-in 注入 - 全局关闭
        const tools = await resolveAgentTools({
            store: this.deps.store,
            toolsView: this.deps.toolsView,
            sessionId: input.sessionId,
            flowId: input.flowId,
            node,
            disabledTools: this.deps.toolSwitches?.(),
            ...(input.mode ? { mode: input.mode } : {}),
        });
        const collabPrompt = String(input.collabPrompt ?? '').trim();
        // 角色 Prompt 实际注入文本（.md 路径设置时读取文件当前内容；未设置用内联文本）
        const rolePrompt = await resolveRolePrompt(node);
        const injectSystemPrompt = node.data?.injectSystemPrompt !== false;
        const injectToolSections = node.data?.injectToolSections !== false;
        const signature = nodeChildSignature(node, tools, rolePrompt, injectSystemPrompt, injectToolSections, collabPrompt);
        const existing = this.nodeChildren.get(key);
        if (existing && existing.signature === signature)
            return { childId: existing.childId, created: false };
        const provider = detectSubagentProvider(subagents);
        if (!provider)
            throw new Error('没有可用的子代理 provider（预期 spawn 或 fork）');
        // 白名单为空 → 不传 toolFilter（子代理继承父代理工具集边界由宿主组合决定）；
        // wf_run_node/wf_finish 永不进入 allow（§4.4.2 规则 7）
        const toolFilter = tools.length > 0 ? { allow: [...tools] } : undefined;
        const agentOptions = {};
        if (node.data?.provider)
            agentOptions.provider = node.data.provider;
        if (node.data?.model)
            agentOptions.model = node.data.model;
        const promptState = {
            systemPrompt: rolePrompt,
            injectSystemPrompt,
            injectToolSections,
        };
        // 【关键时序】每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）由 host 层
        // `agent/session-start` 处理器在子代理创建窗口内安装（该事件在 agents.create 发布、
        // 首轮 followup 组装之前同步触发；此时 withPending 的 AsyncLocalStorage 状态仍在作用域内，
        // 各 contribution 能读到本次创建的 promptState/manifest）。因此 startContinuable 只需要
        // 创建子代理并提交首条任务，不再在返回后重复安装——避免二次「工具已更新」。
        const started = await this.deps.promptSetup.withPending(promptState, async () => {
            const result = await subagents.startContinuable({
                provider,
                label: node.data.label || `visual-workflow:${input.flowId}:${node.id}`,
                request: {
                    // 首条消息 = 完整任务块（任务 + 上下文），杜绝创建即空转；角色 Prompt 由
                    // prompt-setup 注册为系统提示词独立段，不再经官方 request.persona 占用官方人设
                    prompt: input.blocks.length > 0 ? input.blocks : [{ type: 'text', text: fallbackPrompt(node) }],
                    parent,
                    ...(toolFilter ? { toolFilter } : {}),
                    ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
                },
                signal: input.signal,
            });
            return result;
        });
        const previous = this.nodeChildren.get(key);
        if (previous && previous.childId !== started.childId) {
            // 配置签名变化重建子代理：旧 child 的作用域装配归 host 的 childScopeDisposers 管理，
            // 由 host 监听 agent/disposed 回收，不再由 runner 撤销。
            this.deps.logger?.debug(`[visual-workflow] 子代理重建：${previous.childId} -> ${started.childId}`);
        }
        this.nodeChildren.set(key, { childId: started.childId, signature });
        this.childIds.add(started.childId);
        // 创建即开始推理（官方 startContinuable 语义）：软截停上限必须在 startContinuable
        // 返回后的同步块内立即登记（startNodeTask 会再次刷新，幂等）。保证事件循环中任何
        // pre-step 事件（宏任务）晚于登记发生；极端情况下官方在 resolve 前同步触发 pre-step
        // 仍无法覆盖，但该窗口已缩到官方内部实现边界（startNodeTask 复用路径已另行前置）。
        this.deps.react.setLimit(started.childId, input.iterationLimit);
        return { childId: started.childId, created: true };
    }
    // ---- 内部辅助 ---------------------------------------------------------------
    requireSubagents() {
        const subagents = this.deps.subagents();
        if (!subagents)
            throw new Error('subagents 服务不可用；请确认 Harness 已启用子代理能力');
        return subagents;
    }
    requireParent(sessionId) {
        const agents = this.deps.agents();
        if (!agents)
            throw new Error('Agent 服务不可用；请确认 Harness 已启用子代理能力');
        const parent = agents.get(sessionId);
        if (!parent)
            throw new Error('当前会话 Agent 未激活；请先回到会话再运行');
        return parent;
    }
    /**
     * 把节点级模型选择（provider/model/reasoningEffort）写入该 child 的 selection
     * （经 agent.ctx 身份匹配贡献安装的同一 childCtx，无 pending 竞态）。
     * 官方语义：selection 可变，下一步骤生效——首条请求可能仍用创建时的 agentOptions
     * （reasoning 从第二个步骤起稳定生效，与官方 installModelSelection 一致）。
     */
    attachModelSelection(childId, input) {
        const node = input.node;
        const agents = this.deps.agents();
        const agent = agents?.get(childId);
        if (!agent || typeof agent !== 'object' || !agent.ctx)
            return;
        const selection = {
            provider: String(node.data?.provider ?? ''),
            model: String(node.data?.model ?? ''),
        };
        const reasoning = input.thinking ?? node.data?.reasoning;
        if (typeof reasoning === 'string' && reasoning.trim())
            selection.reasoningEffort = reasoning;
        try {
            this.deps.modelSelection.attach(agent.ctx, selection);
        }
        catch (error) {
            this.deps.logger?.warn(`[visual-workflow] model selection attach failed: ${String(error)}`);
        }
    }
    /**
     * 把节点级角色 Prompt、官方系统提示词开关与工具散文段开关写入该 child 的 prompt setup。
     * 角色 Prompt 由 prompt-setup 注册为系统提示词独立段；injectSystemPrompt=false 时
     * 开关过滤瀑布会清空官方段；injectToolSections=false 时移除 tool:* 散文段。
     * Code Mode 协议段（tools:sdk / tools:ptc-only，0.1.5-rc.1 更名前为 tools:code-only）
     * 与工具 Schema 始终保留，不受两开关影响。
     * 角色文本经 resolveRolePrompt 解析（.md 路径设置时读取文件当前内容），与创建期一致。
     */
    async attachPromptState(childId, input) {
        const node = input.node;
        const agents = this.deps.agents();
        const agent = agents?.get(childId);
        if (!agent || typeof agent !== 'object' || !agent.ctx)
            return;
        try {
            const rolePrompt = await resolveRolePrompt(node);
            this.deps.promptSetup.attach(agent.ctx, {
                systemPrompt: rolePrompt,
                injectSystemPrompt: node.data?.injectSystemPrompt !== false,
                injectToolSections: node.data?.injectToolSections !== false,
            });
        }
        catch (error) {
            this.deps.logger?.warn(`[visual-workflow] prompt setup attach failed: ${String(error)}`);
        }
    }
}
// ---------------------------------------------------------------------------
// 子代理 scope 双保险：wf_run_node / wf_run_node_wait / wf_finish 经 tools.restrict 显式隐藏
// ---------------------------------------------------------------------------
/**
 * 子代理工具可见性贡献（经 registerContinuableSetup 注入）：
 * 在 child scope 上 tools.restrict({ deny: ['wf_run_node', 'wf_run_node_wait', 'wf_finish'] })——
 * 与白名单 allow（永不包含）构成双保险（架构文档 §4.2 L219）。restrict 对未注册
 * 工具会抛错（官方 core/tools L1091），故此处尽力而为：失败即跳过，白名单仍兜底。
 */
export function childVisibilityContribution() {
    return (rawChildCtx) => {
        try {
            const childCtx = rawChildCtx;
            if (typeof childCtx.get !== 'function')
                return () => { };
            const tools = childCtx.get('tools');
            if (tools && typeof tools.restrict === 'function') {
                return tools.restrict({ deny: ['wf_run_node', 'wf_run_node_wait', 'wf_finish'] });
            }
        }
        catch {
            // 工具尚未注册或服务缺失：白名单 allow 已排除，双保险尽力而为
        }
        return () => { };
    };
}
//# sourceMappingURL=runner.js.map
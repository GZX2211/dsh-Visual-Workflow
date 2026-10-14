// src/host/agent/member-launcher.ts
//
// Team 成员启动器：把一个画布成员节点启动为官方 Agent Team 的 teammate。
//
// 职责边界（与 runner.ts 的普通节点路径对照）：
//   - 普通节点路径：一个角色节点 ⇄ 一个可延续子代理（官方 startContinuable）；
//   - 成员路径：一个成员节点 ⇄ 一个官方 teammate（官方 Team 服务 spawnTeammate），
//     成员身份、成员间消息、共享任务板、等待与中断全部由官方机制承担——本模块**不建第二套**。
//
// 插件只做官方工具不做、且只有插件能做的两件事：
//   ① 画布节点 id → 官方成员名（确定性派生：官方名字永久不可复用，派生必须稳定）；
//   ② 在创建窗口内装配插件自定义的子代理参数（角色提示词 / 模型选择 / 工具白名单 / 护栏上限）。
//
// 官方事实（取证自 dsh-experimental-tool-agent-team 与 dsh-experimental-agent-team）：
//   - spawn_teammate 只接受 name / description / prompt / context，模型与工具不经该请求；
//   - 官方工具会给成员首条消息插入固定身份前缀（成员名 + Lead 名 + 协作入口），插件直接调用
//     服务层时必须自行补上（见 TEAMMATE_IDENTITY_PREFIX，逐字复刻官方模板）；
//   - 成员名在同一团队内永久不可复用、成员不可删除：已存在者只能复用（sendMessage 重新派发）；
//   - maxMembers 统计「累计创建过的 teammate 数（含失败的）」，耗尽时插件先给出可行动错误；
//   - 成员是 Lead 的直接可延续子代理，其每轮驻留都发 subagent/end，故产出仍经既有事件链路观察。
import { TEAM_SPAWN_TEAMMATE } from '../shared/protocol.js';
import { findMemberByName, isTeammateNameValid, teammateDescriptionOf, teammateNameOf } from '../team/index.js';
/**
 * 官方成员身份前缀（逐字复刻 `dsh-experimental-tool-agent-team` 的 spawn_teammate 模板）。
 *
 * 为什么必须逐字复刻：官方工具创建成员时会把这段前缀插在任务之前，成员据此知道自己的名字、
 * Lead 名与协作入口；插件直接调服务层不会自动获得，缺了它成员既不知道队友也不知道怎么发消息。
 * 官方该模板变更时，此处必须同步（判据测试锁定文本形状）。
 */
export function teammateIdentityPrefix(name) {
    return `<system-reminder>
You are teammate "${name}".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>

`;
}
/**
 * Team 成员启动器（官方 Agent Team 路径；官方不可用时由调用方降级为普通子代理）。
 *
 * 无状态持有者之外的唯一内存表是成员组成签名（官方成员在会话内不可重建，签名变化只能告警）。
 */
export class TeamMemberLauncher {
    deps;
    /**
     * 官方成员名 → 上次生效的组成签名。
     * 【释放路径】条目与团队成员一一对应（官方成员本身在会话内不可删除），
     * 名称数量有官方上限，随宿主持有的本对象一起回收。
     */
    memberSignatures = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * 官方 Team 路径是否可用（成员启动路径选择与协作块文案的唯一判据）。
     *
     * 条件：官方 Team 服务可用 + **官方 Team 工具面确实下发给成员** + 会话根 Agent 存活
     * + 存在可用的延续子代理 provider。
     *
     * 为什么必须校验工具面：官方 Team 由两个独立包组成——领域服务（agent-team）与工具/策略包
     * （tool-agent-team）。只挂载领域服务时成员会被创建为 teammate，却拿不到九个官方工具与
     * team:policy，此时按 official 通道注入「用 send_message 通信」的文案必然失效。官方工具
     * 注册在每个成员自身 scope，故只需看父代理（同为成员）scope 是否可见该工具。
     */
    available(sessionId) {
        if (!this.deps.teams())
            return false;
        if (!this.rootAgentOf(sessionId))
            return false;
        if (!this.deps.toolsView.agentToolNamesSync(sessionId).includes(TEAM_SPAWN_TEAMMATE))
            return false;
        const subagents = this.deps.subagents();
        return subagents !== null && this.deps.detectProvider(subagents) !== null;
    }
    /**
     * 启动（或复用）一个成员节点的官方 teammate 并派发本轮任务。
     *
     * @returns 成员启动结果；官方 Team 服务或根 Agent 不可用时返回 null（调用方降级为普通子代理）。
     * @throws 成员名已被失败成员占用、成员仍在创建中、名额耗尽、无可用 provider、官方未返回成员标识等可行动错误。
     */
    async start(input) {
        const teams = this.deps.teams();
        if (!teams)
            return null;
        const root = this.rootAgentOf(input.sessionId);
        if (!root)
            return null;
        const subagents = this.deps.subagents();
        if (!subagents)
            return null;
        const provider = this.deps.detectProvider(subagents);
        if (!provider)
            throw new Error('没有可用的子代理 provider（Team 成员无法创建）');
        const node = input.node;
        const name = teammateNameOf(node.id);
        if (!isTeammateNameValid(name)) {
            throw new Error(`Team 成员名不合法：${name}（来自节点 ${node.id}）`);
        }
        const disabledTools = await this.deps.toolSwitches?.();
        // 成员清单只读一次并**按本次新建结果就地补充**：同一批调用里重复名字不得重复创建
        // （官方会拒绝，但失败信息不友好）。
        const roster = [...teams.listMembers(root)];
        const existing = findMemberByName(roster, name);
        const tools = await this.deps.resolveTools({
            node,
            sessionId: input.sessionId,
            flowId: input.flowId,
            ...(disabledTools ? { disabledTools } : {}),
            ...(input.mode ? { mode: input.mode } : {}),
        });
        const rolePrompt = await this.deps.resolveRolePrompt(node);
        const injectSystemPrompt = node.data?.injectSystemPrompt !== false;
        const injectToolSections = node.data?.injectToolSections !== false;
        const selection = selectionOf(node, input.thinking);
        const signature = this.deps.signatureOf(node, tools, rolePrompt, injectSystemPrompt, injectToolSections, input.collabPrompt ?? '');
        if (existing) {
            if (existing.status === 'failed') {
                // 官方成员名不可复用、失败成员不可寻址：无法复用也无法重建，只能换会话或改名
                throw new Error(`Team 成员「${name}」此前创建失败且名字已被占用（官方成员名在同一会话内不可复用）。` +
                    '请新建会话后重新运行，或修改该成员节点的 id 以生成新名字。');
            }
            if (existing.status === 'provisioning') {
                throw new Error(`Team 成员「${name}」仍在创建中，请稍后重试`);
            }
            const childId = String(existing.id ?? '');
            await teams.sendMessage(root, { target: name, content: input.blocks, signal: input.signal });
            this.applyMemberComposition(childId, selection, tools, input.iterationLimit);
            this.reportSignatureChange(name, signature);
            return { childId, target: name, created: false };
        }
        // 名额预检（只对新建）：官方 maxMembers 统计累计创建数（含失败的），耗尽后创建必失败。
        // 只数 teammate 行——roster 含 Lead 伪行，把它算进名额会少算一个可用名额。
        const created = roster.filter((member) => String(member?.role ?? '') === 'teammate').length;
        if (created >= this.deps.memberLimit) {
            throw new Error(`官方 Team 成员名额已用尽（已创建 ${created} / 上限 ${this.deps.memberLimit}）。` +
                '该上限按会话累计（含创建失败的成员），且官方成员不可删除：请提高部署层 agent-team.maxMembers，' +
                '或新建会话后重新运行。');
        }
        const promptState = { systemPrompt: rolePrompt, injectSystemPrompt, injectToolSections };
        const spawned = await this.deps.promptSetup.withPending(promptState, () => this.deps.toolFilter.withPending(tools, () => this.deps.modelSelection.withPending(selection, () => teams.spawnTeammate(root, {
            name,
            description: teammateDescriptionOf(node.data?.label, node.id),
            // 首块 = 官方身份前缀（逐字复刻官方工具），次块 = 插件组装的成员任务块
            prompt: [{ type: 'text', text: teammateIdentityPrefix(name) }, ...input.blocks],
            // 成员是全新角色：不继承 Lead 对话（fork 会把编排指令与上下文灌进成员）
            context: 'fresh',
            provider,
            signal: input.signal,
        }))));
        const childId = String(spawned?.member?.id ?? '');
        if (!childId)
            throw new Error(`官方 Team 未返回成员标识：${name}`);
        this.applyMemberComposition(childId, selection, tools, input.iterationLimit);
        this.rememberSignature(name, signature);
        return { childId, target: name, created: true };
    }
    /** 会话根 Agent（官方团队 Lead）：不存在即无法启动团队。 */
    rootAgentOf(sessionId) {
        const agents = this.deps.agents();
        if (!agents || typeof agents.get !== 'function')
            return null;
        return agents.get(sessionId) ?? null;
    }
    /**
     * 某成员节点在官方 roster 中的当前状态（成员运行态的**唯一权威读源**）。
     * 返回 null：官方 Team 不可用，或该节点尚无对应成员（未创建 / 已降级为普通子代理）。
     */
    memberStatusOf(sessionId, nodeId) {
        const teams = this.deps.teams();
        if (!teams)
            return null;
        const root = this.rootAgentOf(sessionId);
        if (!root)
            return null;
        const member = findMemberByName(teams.listMembers(root), teammateNameOf(nodeId));
        return member?.status ?? null;
    }
    /**
     * 应用成员级组成：留存（供重发布重装）并登记本轮护栏上限。
     * 创建路径已在创建窗口内生效；复用路径下模型的后续请求与工具可见性由重发布重装补齐。
     */
    applyMemberComposition(childId, selection, tools, iterationLimit) {
        if (!childId)
            return;
        if (selection)
            this.deps.modelSelection.remember(childId, selection);
        this.deps.toolFilter.remember(childId, tools);
        // 软截停上限按 child 登记：回合开始读取，故必须在派发返回后的同步块内完成
        this.deps.react.setLimit(childId, iterationLimit);
    }
    /** 记录成员组成签名（首次）。 */
    rememberSignature(name, signature) {
        this.memberSignatures.set(name, signature);
    }
    /**
     * 成员组成签名变化告警（不重建成员）。
     * 官方成员在创建时确定组成，同会话内无法重建；签名变化只能靠新建会话生效，
     * 因此这里只给出可行动诊断，不静默忽略。
     */
    reportSignatureChange(name, signature) {
        const previous = this.memberSignatures.get(name);
        if (previous === undefined) {
            this.memberSignatures.set(name, signature);
            return;
        }
        if (previous === signature)
            return;
        this.memberSignatures.set(name, signature);
        this.deps.logger?.warn(`[visual-workflow] Team 成员「${name}」的组成（角色提示词/模型/工具/协作说明）已变化，` +
            '但官方成员在会话内不可重建；本次仍沿用既有组成，新建会话后生效。');
    }
}
/**
 * 成员模型选择：节点配置齐全时按节点路由，否则返回 undefined（沿用官方继承路由）。
 *
 * 为什么不做空串回退：把空 provider/model 写入 selection 会把成员请求路由改写为空值，
 * 而官方默认行为（继承 Lead 路由）才是未配置节点时的正确语义。
 * 为什么思考强度可单独生效：官方 selection 在无 effort 时清除继承值，恢复所选模型默认行为。
 */
function selectionOf(node, thinking) {
    const provider = String(node.data?.provider ?? '').trim();
    const model = String(node.data?.model ?? '').trim();
    if (!provider || !model)
        return undefined;
    const reasoning = String(thinking ?? node.data?.reasoning ?? '').trim();
    return reasoning ? { provider, model, reasoningEffort: reasoning } : { provider, model };
}
//# sourceMappingURL=member-launcher.js.map
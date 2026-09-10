// src/host/agent/prompt-setup.ts
//
// 角色 Prompt 系统提示词段注入 + 官方系统提示词开关（T-021 配套，需求变更后重写）。
//
// 背景：此前实现把节点自定义 System Prompt 作为「完整系统提示词」注入，整段替换/追加
//       官方 system prompt（含 Code Mode 保留官方工具调用提示词）。该方案被否决：
//       官方已对系统提示词做缓存/稳定性优化，插件不应随意插入或替换官方段。
//
// 统一语义（子代理与父代理共用）：
//   - 角色 Prompt（节点自定义 System Prompt）注册为**独立命名段** `visual-workflow:prompt`
//     （order 1），注入一次、会话/回合间稳定不变（KV 缓存前缀友好）；
//   - **不再整段替换/插入**官方 system prompt，也**不再传** `request.persona` 占用官方人设；
//   - 开关一 `injectSystemPrompt`（默认 true，界面上是「人设段」开关）：
//     ON（开）= 官方身份/人设/系统/上下文段正常注入；
//     OFF（关）= 清空这些官方段（除 `tool:*` 散文段与 Code Mode 协议段之外的全部官方段
//     都被移除，并清空全部 runtime context 快照），仅保留角色段 + 工具相关段。
//     管辖范围（0.1.5-rc.1 取证后的官方段全表）：harness:identity、
//     deployment:persona-prefix、deployment:persona-suffix、plan:policy(500)、
//     subagent:delegation(600)、sandbox:policy(110)、approval:policy(115)、
//     context:file-reference(900)、ui:deliverable-file-references(9000)、
//     harness:source(10000)、app:web-surface(10100) —— 以及 assembly.contexts 整体。
//   - 开关二 `injectToolSections`（默认 true）：ON（开）= 各工具包注册的 `tool:*` 散文段
//     正常注入；OFF（关）= 移除所有 `tool:*` 散文段。
//     **只动散文段，绝不动工具注入表**：本模块的过滤纯函数只重写 `assembly.sections` /
//     `assembly.contexts`，`assembly.tools[]`（工具 Schema 清单）原样透传——模型能否调用
//     某工具只由 `tools[]` 决定，关掉散文段仅去掉「何时该用它」的英文使用指引。
//     （对比：正菜单的「全局工具开关」走 tool-switches.ts 的 filterToolsInAssembly，
//      它会同时剔除 `tools[]` 条目与该工具的 `tool:<name>` 段——那才是剥夺调用能力的开关。）
//   - **无论两个开关如何组合，Code Mode 协议段 `tools:sdk` / `tools:ptc-only`（0.1.5-rc.1
//     更名前的 `tools:code-only`）与 tools[] 工具 Schema 都**始终保留**：前者是 Code Mode 的
//     调用协议声明（旧实现用 `startsWith('tool:')` 误用了单数匹配，把复数的 `tools:*` 一并
//     清掉，属操作失误）；后者决定工具是否可被调用，与散文段注入无关。
//   - 工具能否被调用**只由 tools[] Schema 决定**；移除 `tool:*` 散文段仅去掉使用指引，
//     不改变调用能力。
//   - 本插件**不注册任何 `tool:*` 散文段**：官方 registry 的 register() 不会为每个工具自动
//     注册散文段（`tool:*` 段由各工具包自行注册，如 tool:bash / tool:read / tool:web_search）；
//     本插件唯一注册过的段是角色段 `visual-workflow:prompt`（恒保留）。
//
// 两类 Agent 的注入路径：
//   - 子代理：经 registerContinuableSetup 的 contribution（创建窗口读取 withPending 状态，
//     经 AsyncLocalStorage 隔离并发创建），resolvePromptOnCtx 装配；
//   - 父代理（会话根 Agent）：经 bindParent 把节点级状态写入根 Agent 的 ctx（运行时直接
//     调用，官方 `agents.get(sessionId)?.ctx` 可达；非侵入，仅挂载而不改源码）。
//
// 零官方运行时依赖：section() 与 on('system-prompt/assemble') 均以最小结构守卫收窄。
import { AsyncLocalStorage } from 'node:async_hooks';
/** 角色 Prompt 注册为的系统提示词段名（order 1，位于官方 harness:identity / persona 前缀之后、工具段之前）。 */
export const VISUAL_WORKFLOW_PROMPT_SECTION = 'visual-workflow:prompt';
/**
 * 角色 Prompt 段的 order（有限数字）。
 * 0.1.5-rc.1 官方 order 取证：harness:identity=-1000、deployment:persona-prefix=0、
 * PLAN_POLICY=500、TOOL_* 段 1000~2900、tools:sdk=5000、deployment:persona-suffix=10200。
 * 取 1 → 紧跟官方人设前缀、先于全部策略/工具指引，语义与 0.1.2 时期一致。
 */
const VISUAL_WORKFLOW_PROMPT_ORDER = 1;
/**
 * Code Mode 协议段：无论系统提示词/工具段开关如何，都始终保留（移除会破坏 Code Mode 调用协议）。
 *
 * 0.1.5-rc.1 段名取证：官方 dsh-tools 把原 `tools:code-only` 更名为 **`tools:ptc-only`**
 * （dsh-tools/lib/index.js 的 `collapseSection()`，name: "tools:ptc-only"）；`tools:sdk` 未变。
 * 该段承载「本模式下只允许 run_code」这条规则——官方注释明确：若缺失，模型会拿到工具清单
 * 却看不到调用协议，发原生调用后收到 UNKNOWN_TOOL，进而误判部署不一致。
 * 故三名并列恒保留：`tools:ptc-only`（0.1.5+）+ `tools:code-only`（≤0.1.2 旧宿主容忍）。
 */
const CODE_PROTOCOL_SECTIONS = ['tools:sdk', 'tools:ptc-only', 'tools:code-only'];
/**
 * 官方身份/人设段：节点设置了自定义 System Prompt（角色 Prompt）时，用角色 Prompt
 * 整体替换这些段（用户裁决「角色 Prompt 替换官方提示词」）。其余官方段
 * （环境上下文/工作区说明等）仍按 injectSystemPrompt 开关决定是否保留。
 *
 * 0.1.5-rc.1 段名取证：官方把原 `deployment:persona` 拆为
 *   - `deployment:persona-prefix`（order 0，第一方指引之前）
 *   - `deployment:persona-suffix`（order 10200，全部第一方指引之后）
 * 且两者文本不同源：
 *   - prefix  = "You are a coding agent powered by the {{model}} model." —— 人设散文；
 *   - suffix  = "Your working directory is {{cwd}}." —— **环境事实**（工作目录）。
 * 用户裁决（2026.09 迁移）：角色 Prompt **只替换 identity + prefix**（接管人设），
 * `deployment:persona-suffix` **不纳入替换列表**——角色 Prompt 生效期间，工作目录
 * 事实仍由官方在提示词末尾提供。suffix 仍受「人设段」开关（injectSystemPrompt）管辖：
 * 开关 OFF 时它与其他官方段一并被清空（两个按钮合起来仍可清空官方全部散文提示词）。
 */
const OFFICIAL_IDENTITY_SECTIONS = ['harness:identity', 'deployment:persona-prefix'];
/** 是否为 Code Mode 协议段（tools:sdk / tools:ptc-only / 旧名 tools:code-only；复数命名且以 `tools:` 开头）。 */
function isCodeProtocolSection(name) {
    return CODE_PROTOCOL_SECTIONS.includes(name);
}
/** 是否为工具使用指引散文段（单数命名，`tool:` 开头；不含复数的 tools:* 协议段）。 */
function isToolProseSection(name) {
    return name.startsWith('tool:');
}
/** 是否为官方身份/人设段（角色 Prompt 设置时被整体替换）。 */
function isOfficialIdentitySection(name) {
    return OFFICIAL_IDENTITY_SECTIONS.includes(name);
}
/**
 * 是否保留某个段：角色段与 Code 协议段恒保留；tool:* 段按 injectToolSections；
 * 角色 Prompt 设置时官方身份段（harness:identity + deployment:persona-prefix）被替换（不保留）；
 * 其余官方段（含 deployment:persona-suffix）按 injectSystemPrompt。
 */
function shouldKeepSection(name, ref) {
    if (name === VISUAL_WORKFLOW_PROMPT_SECTION)
        return true; // 角色 Prompt 段始终保留
    if (isCodeProtocolSection(name))
        return true; // Code Mode 协议段始终保留
    if (isToolProseSection(name))
        return ref.injectToolSections; // 工具散文段按工具开关
    // 角色 Prompt 设置时替换官方身份/人设段（不再注入官方 identity/persona）
    if (isOfficialIdentitySection(name) && String(ref.systemPrompt ?? '').trim())
        return false;
    return ref.injectSystemPrompt; // 其余官方段（人设/身份/系统）按系统提示词开关
}
/**
 * 把角色 Prompt 状态应用到一次系统提示词组装结果（纯函数、确定性）：
 *   - 两开关全开且未设置角色 Prompt 时原样返回（保持官方缓存/稳定性优化）；
 *   - 否则注入 `visual-workflow:prompt` 段（sectionRegistered 为 false 时在瀑布内补插），
 *     再按 shouldKeepSection 过滤出保留段；contexts 随 injectSystemPrompt 开关。
 * 供 per-agent 贡献/父代理 bindParent 与全局首轮瀑布共用，逻辑一致。
 */
function applyPromptStateToAssembly(assembly, ref, sectionRegistered) {
    if (!assembly)
        return assembly;
    const roleText = String(ref.systemPrompt ?? '').trim();
    const roleSet = roleText.length > 0;
    // 快速路径：两开关全开且未设置角色 Prompt（无需替换官方身份段）时，不改动官方组装。
    const needsFilter = !(ref.injectSystemPrompt && ref.injectToolSections) || roleSet;
    if (!needsFilter)
        return assembly;
    let baseSections = Array.isArray(assembly.sections) ? [...assembly.sections] : [];
    if (!sectionRegistered && roleSet) {
        // 避免重复注入：若组装结果已含角色 Prompt 段（例如 per-agent 的 sys.section 已注册、
        // 或本次瀑布已在前次监听中补插过），不再重复追加。
        const alreadyPresent = baseSections.some((section) => String(section.name) === VISUAL_WORKFLOW_PROMPT_SECTION);
        if (!alreadyPresent) {
            baseSections = [{ name: VISUAL_WORKFLOW_PROMPT_SECTION, text: roleText }, ...baseSections];
        }
    }
    const sections = baseSections.filter((section) => shouldKeepSection(String(section.name), ref));
    return { ...assembly, sections, contexts: ref.injectSystemPrompt ? (assembly.contexts ?? []) : [] };
}
/**
 * 在同一 ctx 上装配「角色 Prompt 段 + 开关过滤瀑布」，返回合并 disposer。
 * 供子代理 contribution 与父代理 bindParent 共用（逻辑一致）。
 */
function registerPromptOnCtx(childCtx, ref) {
    const disposers = [];
    // 官方 systemPrompt.section API 可用：把角色 Prompt 注册为独立命名段（注入一次）
    let sectionRegistered = false;
    const sys = childCtx.systemPrompt;
    if (typeof sys?.section === 'function') {
        try {
            const disposer = sys.section({
                name: VISUAL_WORKFLOW_PROMPT_SECTION,
                order: VISUAL_WORKFLOW_PROMPT_ORDER,
                text: () => ref.systemPrompt,
            });
            sectionRegistered = true;
            if (typeof disposer === 'function')
                disposers.push(disposer);
        }
        catch {
            // section 注册失败（如顺序冲突）：降级为瀑布兜底注入（见下面分支）
            sectionRegistered = false;
        }
    }
    // 开关过滤瀑布：两开关全开且未设置角色 Prompt 时返回官方原有装配（不改动，保持官方
    // 缓存/稳定性优化）；否则按 applyPromptStateToAssembly 保留角色段 + Code 协议段 + 按开关的
    // 工具段/官方段。角色 Prompt 设置时会替换官方身份/人设段（用户裁决）。
    // 工具调用能力仅由 tools[] Schema 决定，本瀑布从不改动 assembly.tools。
    const disposeAssembly = childCtx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
        const assembly = (await next());
        return applyPromptStateToAssembly(assembly, ref, sectionRegistered);
    });
    disposers.push(disposeAssembly);
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // 撤销尽力而为
            }
        }
    };
}
/**
 * 创建子代理/父代理提示词注入装配。
 *
 * @returns contribution + attach + withPending + bindParent 四段式接口。
 */
export function createChildPromptSetup() {
    const states = new WeakMap();
    const pending = new AsyncLocalStorage();
    // 父代理（根 Agent）按 sessionId 的绑定表：每会话只注册一次，更新走可变状态。
    const parentRefs = new Map();
    const parentDisposers = new Map();
    const contribution = (rawChildCtx) => {
        const childCtx = rawChildCtx;
        if (typeof childCtx?.on !== 'function')
            return () => { };
        // 创建窗口内若存在 pending 状态，立即落 WeakMap（首轮组装前保证就绪）
        const pendingState = pending.getStore();
        const ref = {
            systemPrompt: pendingState ? String(pendingState.systemPrompt ?? '') : '',
            injectSystemPrompt: pendingState ? pendingState.injectSystemPrompt !== false : true,
            injectToolSections: pendingState ? pendingState.injectToolSections !== false : true,
        };
        states.set(childCtx, ref);
        return registerPromptOnCtx(childCtx, ref);
    };
    const withPending = (state, operation) => pending.run(state, operation);
    const hasPending = () => pending.getStore() !== undefined;
    const peekPending = () => pending.getStore();
    const attach = (childCtx, state) => {
        if (!childCtx || typeof childCtx !== 'object')
            return;
        const ref = states.get(childCtx);
        if (!ref)
            return; // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
        ref.systemPrompt = String(state.systemPrompt ?? '');
        ref.injectSystemPrompt = state.injectSystemPrompt !== false;
        ref.injectToolSections = state.injectToolSections !== false;
    };
    const bindParent = (ctx, state, sessionId) => {
        if (!ctx || typeof ctx !== 'object')
            return;
        let ref = parentRefs.get(sessionId);
        if (!ref) {
            ref = {
                systemPrompt: String(state.systemPrompt ?? ''),
                injectSystemPrompt: state.injectSystemPrompt !== false,
                injectToolSections: state.injectToolSections !== false,
            };
            parentRefs.set(sessionId, ref);
            parentDisposers.set(sessionId, registerPromptOnCtx(ctx, ref));
        }
        ref.systemPrompt = String(state.systemPrompt ?? '');
        ref.injectSystemPrompt = state.injectSystemPrompt !== false;
        ref.injectToolSections = state.injectToolSections !== false;
    };
    /**
     * 全局 unscoped 瀑布（host 层，与工具开关瀑布同构）。宿主在初始化时注册到自身
     * unscoped ctx，对所有 agent 的组装生效。子代理首轮组装发生在 `withPending` 作用域内
     * （startContinuable 尚未返回），此时 pending.getStore() 非空——据此注入角色 Prompt 段
     * 并应用开关过滤，使首轮即用角色 Prompt 替换官方身份/人设段。后续回合 pending 已退出，
     * 本瀑布原样返回（由 per-agent 贡献/bindParent 持久生效），避免双重注入。
     */
    const registerGlobalAssemblyHook = (ctx) => {
        if (typeof ctx?.on !== 'function')
            return () => { };
        return ctx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
            const assembly = (await next());
            const pendingState = pending.getStore();
            if (!pendingState)
                return assembly; // 非视觉工作流子代理首轮/后续回合：交给 per-agent 贡献/bindParent
            return applyPromptStateToAssembly(assembly, {
                systemPrompt: String(pendingState.systemPrompt ?? ''),
                injectSystemPrompt: pendingState.injectSystemPrompt !== false,
                injectToolSections: pendingState.injectToolSections !== false,
            }, false);
        });
    };
    return { contribution, withPending, attach, bindParent, registerGlobalAssemblyHook, hasPending, peekPending };
}
//# sourceMappingURL=prompt-setup.js.map
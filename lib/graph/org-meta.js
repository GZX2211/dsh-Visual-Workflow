// src/host/graph/org-meta.ts
//
// 元参数（OrgMeta）纯函数层（自主编排方案 §6.4 / 决策 D-04、D-13、D-21）：
//   - normalizeOrgMeta：外部输入（磁盘 JSON/工具入参）→ 规范化 OrgMeta（丢弃未知字段、
//     数值收敛到合理区间、区间自洽）；
//   - effectiveOrgMeta / metaOfDocument：三层装配的前两层合并（template.meta ←
//     instance.meta 覆盖）；
//   - orgBudgetOf：生效值 + 已用量 → 剩余量（注入与工具返回统一口径）；
//   - freezeOrgMeta：startRun 时把有效值冻结进快照（snapshot.meta）。
// 硬护栏判定（metaLimitIssues）另见 org-meta-limits.ts（职责分离）；已用量统计口径
// 见 org-meta-usage.ts。
//
// 约束：全部为纯函数（不读时钟/随机源、无 IO、不改写入参），可被单测逐函数断言。
// 「只约束代理改图、不约束用户改图」（D-05）由调用方按 origin 决定是否调用本层。
/** 上限类字段的缺省值（缺省即硬护栏生效；下限/软约束字段缺省即不约束）。 */
export const ORG_META_LIMIT_DEFAULTS = {
    /** 可执行节点数上限（自主编排方案 §6.4 示例：12）。 */
    nodeMax: 12,
    /** 协作组数量上限（示例：3）。 */
    groupMax: 3,
    /** 组内人数上限（示例：5）。 */
    membersMax: 5,
};
/**
 * 归一化硬上限（防手改 JSON/畸形输入把预算写成天文数字）：
 * 仅作「夹取安全网」，不是业务约束——业务约束由用户在模板/实例 meta 中自定。
 */
export const ORG_META_NORMALIZE_CAPS = {
    /** 可执行节点数上限的安全网。 */
    nodeMax: 200,
    /** 协作组数量上限的安全网。 */
    groupMax: 50,
    /** 组内人数上限的安全网（画布 UI 既有上限为 8，此处放宽）。 */
    membersMax: 50,
    /** 并行分支上限的安全网。 */
    parallelBranchMax: 50,
    /** 闸门次数上限的安全网。 */
    milestoneMax: 50,
    /** 单轮改图 op 上限的安全网。 */
    patchOpsMax: 200,
    /** 每节点协作消息上限的安全网。 */
    askPerNodeMax: 100,
};
/** 整数读取：非有限数/非正整数一律视为「未配置」（undefined）。 */
function positiveInt(value, cap) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0)
        return undefined;
    return Math.min(Math.floor(num), cap);
}
/** 字符串读取：非空字符串才有效，否则 undefined。 */
function nonEmptyString(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    return text ? text : undefined;
}
/** 枚举读取：取值必须命中白名单，否则 undefined（丢弃非法值，不抛错）。 */
function oneOf(value, allowed) {
    return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}
/**
 * 规范化元参数：逐字段类型守卫 + 数值夹取 + 区间自洽（min > max 时丢弃 min）。
 * 未知字段一律丢弃；非法值按「未配置」处理（不抛错——磁盘 JSON 可能被手改）。
 */
export function normalizeOrgMeta(input) {
    const raw = (input && typeof input === 'object' ? input : {});
    const caps = ORG_META_NORMALIZE_CAPS;
    const out = {};
    const nodeMin = positiveInt(raw.nodeMin, caps.nodeMax);
    const nodeMax = positiveInt(raw.nodeMax, caps.nodeMax);
    if (nodeMin !== undefined && nodeMax !== undefined && nodeMin > nodeMax) {
        // 区间自洽：下限高于上限视为误配置 → 丢弃下限（上限更接近「成本预算」语义）
        out.nodeMax = nodeMax;
    }
    else {
        if (nodeMin !== undefined)
            out.nodeMin = nodeMin;
        if (nodeMax !== undefined)
            out.nodeMax = nodeMax;
    }
    const groupMax = positiveInt(raw.groupMax, caps.groupMax);
    if (groupMax !== undefined)
        out.groupMax = groupMax;
    const membersMin = positiveInt(raw.membersMin, caps.membersMax);
    const membersMax = positiveInt(raw.membersMax, caps.membersMax);
    if (membersMin !== undefined && membersMax !== undefined && membersMin > membersMax) {
        out.membersMax = membersMax;
    }
    else {
        if (membersMin !== undefined)
            out.membersMin = membersMin;
        if (membersMax !== undefined)
            out.membersMax = membersMax;
    }
    const parallelBranchMax = positiveInt(raw.parallelBranchMax, caps.parallelBranchMax);
    if (parallelBranchMax !== undefined)
        out.parallelBranchMax = parallelBranchMax;
    const milestoneMax = positiveInt(raw.milestoneMax, caps.milestoneMax);
    if (milestoneMax !== undefined)
        out.milestoneMax = milestoneMax;
    const patchOpsMax = positiveInt(raw.patchOpsMax, caps.patchOpsMax);
    if (patchOpsMax !== undefined)
        out.patchOpsMax = patchOpsMax;
    const askPerNodeMax = positiveInt(raw.askPerNodeMax, caps.askPerNodeMax);
    if (askPerNodeMax !== undefined)
        out.askPerNodeMax = askPerNodeMax;
    const planFreedom = oneOf(raw.planFreedom, ['templates-only', 'allow-new-role']);
    if (planFreedom)
        out.planFreedom = planFreedom;
    const promptSource = oneOf(raw.promptSource, ['user-template', 'agent-generated']);
    if (promptSource)
        out.promptSource = promptSource;
    const roleGranularity = oneOf(raw.roleGranularity, ['broad', 'narrow']);
    if (roleGranularity)
        out.roleGranularity = roleGranularity;
    const roleReuse = oneOf(raw.roleReuse, ['forbid', 'allow']);
    if (roleReuse)
        out.roleReuse = roleReuse;
    const crossGroupPolicy = oneOf(raw.crossGroupPolicy, ['via-parent', 'forbid']);
    if (crossGroupPolicy)
        out.crossGroupPolicy = crossGroupPolicy;
    if (Array.isArray(raw.interveneTrigger)) {
        const triggers = raw.interveneTrigger
            .map((item) => oneOf(item, ['user', 'threshold', 'milestone']))
            .filter((item) => item !== undefined);
        // 去重后写入（顺序保持首次出现，便于提示词稳定输出）
        if (triggers.length > 0)
            out.interveneTrigger = [...new Set(triggers)];
    }
    const failure = raw.failurePolicy;
    if (failure && typeof failure === 'object') {
        // 语义固定（D-22：重试一次 → 父代理核实 → 无法解决则问用户）：形状确认后原样固化
        if (Number(failure.retry) === 1 && failure.thenEscalate === true && failure.askUserOnUnresolved === true) {
            out.failurePolicy = { retry: 1, thenEscalate: true, askUserOnUnresolved: true };
        }
    }
    if (Array.isArray(raw.forbiddenShapes)) {
        const shapes = raw.forbiddenShapes.map((item) => nonEmptyString(item)).filter((item) => !!item);
        if (shapes.length > 0)
            out.forbiddenShapes = [...new Set(shapes)];
    }
    if ('namingConvention' in raw) {
        out.namingConvention = nonEmptyString(raw.namingConvention) ?? null;
    }
    if (raw.eval && typeof raw.eval === 'object' && !Array.isArray(raw.eval)) {
        out.eval = { ...raw.eval };
    }
    if (raw.restructure && typeof raw.restructure === 'object' && !Array.isArray(raw.restructure)) {
        out.restructure = { ...raw.restructure };
    }
    return out;
}
/**
 * 三层装配的前两层合并（D-13）：`effective = { ...template.meta, ...instance.meta }`。
 * 覆盖语义为**浅合并（后者优先）**——嵌套对象 `failurePolicy` 整体替换而非深合并，
 * 因为它的业务语义固定（D-22），深合并没有意义且会增加「哪层生效」的歧义。
 * 任一来源为空对象/undefined 即跳过（缺省 = 不约束）。
 */
export function effectiveOrgMeta(...sources) {
    const merged = {};
    for (const source of sources) {
        if (!source || typeof source !== 'object')
            continue;
        Object.assign(merged, source);
    }
    return merged;
}
/**
 * 读取文档（模板/实例）声明的元参数：规范化后返回。
 * 文档缺 meta 时按空对象处理（= 不约束），旧数据零行为变化。
 */
export function metaOfDocument(doc) {
    return normalizeOrgMeta(doc?.meta);
}
/**
 * 组织预算（生效值 + 已用量 → 剩余量）。
 * 语义：上限字段为 0 表示「不限制」，对应剩余量为 null（提示词据此输出「不限」）。
 */
export function orgBudgetOf(meta, usage) {
    const nodeMax = Number(meta.nodeMax) || 0;
    const groupMax = Number(meta.groupMax) || 0;
    const milestoneMax = Number(meta.milestoneMax) || 0;
    const patchOpsMax = Number(meta.patchOpsMax) || 0;
    return {
        nodeUsed: usage.nodeCount,
        nodeMax,
        nodeRemaining: nodeMax > 0 ? nodeMax - usage.nodeCount : null,
        groupUsed: usage.groupCount,
        groupMax,
        groupRemaining: groupMax > 0 ? groupMax - usage.groupCount : null,
        membersMax: Number(meta.membersMax) || 0,
        parallelBranchMax: Number(meta.parallelBranchMax) || 0,
        milestoneUsed: usage.milestoneUsed,
        milestoneMax,
        milestoneRemaining: milestoneMax > 0 ? milestoneMax - usage.milestoneUsed : null,
        patchOpsMax,
        patchOpsRemaining: patchOpsMax > 0 ? patchOpsMax - Math.max(0, Number(usage.patchOps) || 0) : null,
        forbiddenShapes: [...(meta.forbiddenShapes ?? [])],
        namingConvention: meta.namingConvention ?? null,
    };
}
/**
 * 冻结元参数（D-13 第三层）：startRun 时把有效值副本写入快照。
 * 未配置（空对象/undefined）时不写字段，保持既有快照形状（旧数据兼容、零行为变化）。
 * 写入的是**副本**：此后修改模板/实例 meta 不影响本次运行的冻结预算。
 */
export function freezeOrgMeta(snapshot, meta) {
    if (!meta || typeof meta !== 'object')
        return;
    const normalized = normalizeOrgMeta(meta);
    if (Object.keys(normalized).length === 0)
        return;
    snapshot.meta = normalized;
}
//# sourceMappingURL=org-meta.js.map
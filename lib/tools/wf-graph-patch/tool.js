// src/host/tools/wf-graph-patch/tool.ts
//
// wf_graph_patch 工具注册：父代理写图的**唯一入口**，语义分两组。
//
// 两组（同一工具、两条零共享代码路径）：
//   1. 图结构变更（create_node/remove_node/update_node_data/connect/disconnect/create_group/
//      set_group_members）→ 取值存在性校验（presetId / provider / model / reasoning）+
//      检查器校验 + 元参数硬护栏 + 原子落盘；
//   2. 运行状态标记（mark_node）→ 闸门状态推进（闸门身份与次数预算按运行事实判定）。
//   同一补丁混用不同组 → WF_PATCH_MIXED_GROUPS（参数层拒绝，错误文本写明分组原因）。
// 元参数（组织预算）**不是**一组操作：它是约束改图方的硬护栏，被约束方不得自行调整，
// 只能在画布/设置中由用户修改。
//
// 落盘规范：scope='template' 改工作流模板（规划期）；scope='instance' 改当前实例
// （运行期），并即时刷新活跃 run 的事实源与画布回显（双向同步）。
// 新建通路：scope='template' 带 `create` 参数 = 新建模板（规划期主用例：无模板 →
// 产出模板）；不带 create 仍是「必须已存在」的更新语义。显式传入已存在的 targetId +
// create → WF_PATCH_CONFLICT，绝不静默覆盖。create 只允许与 graph 组同用（其余组语义不成立）。
// 坐标是纯视图数据：补丁不接受 position，新建节点写哨兵 {0,0} 交由客户端自动布局。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）；字段形状
// 与提交规则由 wf_org_catalog 的 rules 提供，避免同一份契约在两处常驻文本里各自漂移。
import { randomUUID } from 'node:crypto';
import { WF_GRAPH_PATCH, ERR_REVISION_CONFLICT } from '../../shared/protocol.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { textRender } from '../infrastructure/text-render.js';
import { callerOf } from '../infrastructure/caller.js';
import { WfError } from '../../orchestrator/index.js';
import { checkGraphInvariants, effectiveOrgMeta, hasBlockingIssues, mainNodeIdOf, metaOfDocument, orgBudgetOf, orgUsageOf, validateFlow, } from '../../graph/index.js';
import { applyGraphOpsTolerant, applyMarkOp } from './apply.js';
import { knownModelsOf, modelSelectionFailures, writtenModelSelectionsOf } from './policy.js';
import { PATCH_CONTRACT_POINTER } from '../infrastructure/graph-op-contract.js';
import { GROUP_HINTS, groupsOf, unknownOpsOf, } from './types.js';
/** 由图文档与已用量组装只读预算（生效元参数按文档声明归一）。 */
function budgetOf(doc, options = {}) {
    return orgBudgetOf(effectiveOrgMeta(metaOfDocument(doc)), orgUsageOf(doc, options));
}
/**
 * 标记组的预算：闸门维度取运行事实，其余维度取文档生效元参数。
 * 为什么闸门维度不看文档：闸门次数预算在运行期由运行快照冻结——用户在画布上改元参数
 * 不会改变本次运行的闸门判定，以文档为准会让「还剩几次闸门」与状态机判定相反。
 */
function markBudgetOf(flow, options) {
    const meta = {
        ...effectiveOrgMeta(metaOfDocument(flow)),
        milestoneMax: Math.max(0, Math.floor(Number(options.milestoneMax) || 0)),
    };
    return orgBudgetOf(meta, orgUsageOf(flow, { milestoneUsed: options.milestoneUsed, patchOps: options.patchOps }));
}
/** 检查器 issue → 返回体 warnings（warning 级不阻断）。 */
function warningsOf(issues) {
    return (issues ?? [])
        .filter((issue) => issue.level === 'warning')
        .map((issue) => ({ code: issue.code, message: issue.message }));
}
/**
 * 阻断型 issue → WF_GRAPH_INVALID（错误文本带全部明细与修复建议，
 * 这是模型自我修正的唯一通道，故必须把建议原样透出）。
 */
function throwGraphInvalid(issues) {
    const detail = issues.map((issue) => {
        const where = [...(issue.nodeIds ?? []), ...(issue.lineIds ?? [])].join(',');
        const hint = String(issue.suggestion ?? '').trim();
        return `[${issue.code}]${where ? `(${where})` : ''} ${issue.message}${hint ? ` → 建议：${hint}` : ''}`;
    }).join('\n');
    throw new WfError(`补丁被图检查器阻断（${issues.length} 项）：\n${detail}`, 'WF_GRAPH_INVALID');
}
/** 补丁 op 数上限（元参数 patchOpsMax 由检查器护栏判定；此处只做整体 sanity）。 */
const PATCH_OPS_HARD_LIMIT = 200;
/**
 * 单条 op 失败清单 → 聚合错误（整批拒绝）。
 *
 * 为什么必须一次列全：ops 之间存在有序依赖，逐条试错会让父代理对同一批补丁反复重试；
 * 一次列全它可以一轮改完。
 * 为什么消息里保留每条自己的错误码：只有码能让模型分辨「改入参形状」还是「改图」。
 * 批次级码取一致语义：全部为参数层错误才是 WF_BAD_ARGS，出现图语义错误则归 WF_GRAPH_INVALID。
 */
function throwPatchErrors(errors) {
    const detail = errors.map((item) => `#${item.index + 1} ${item.op} [${item.code}] ${item.message}`).join('\n');
    const code = errors.every((item) => item.code === 'WF_BAD_ARGS') ? 'WF_BAD_ARGS' : 'WF_GRAPH_INVALID';
    throw new WfError(`补丁未应用：${errors.length} 项操作有误，整批不落盘（目标图未被修改）\n${detail}\n修正全部问题后重新提交。`, code);
}
/**
 * 判定目标实际类型（按真实存在性，不按调用方声明）：
 * scope 与类型不匹配时给出可行动错误（§4.2 WF_SCOPE_INVALID），避免「用错 scope
 * 把实例当模板保存」这类静默错写。
 */
async function detectTargetKind(host, input) {
    const template = await host.store.getFlowTemplate(input.targetId);
    if (template)
        return 'template';
    const workflow = await host.store.getWorkflow(input.sessionId, input.targetId);
    if (workflow)
        return 'instance';
    const service = await host.store.getServiceAsFlow(input.targetId);
    if (service)
        return 'instance';
    return 'none';
}
/** 校验 scope 与目标类型匹配（§4.2 WF_SCOPE_INVALID）。 */
async function assertScopeTarget(host, scope, input) {
    const kind = await detectTargetKind(host, input);
    if (scope === 'template' && kind === 'instance') {
        throw new WfError('scope=\'template\' 只能用于工作流模板；该 targetId 是工作流/服务实例，请改用 scope=\'instance\'', 'WF_SCOPE_INVALID');
    }
    if (scope === 'instance' && kind === 'template') {
        throw new WfError('scope=\'instance\' 不能用于工作流模板；规划期改模板请用 scope=\'template\'', 'WF_SCOPE_INVALID');
    }
}
/**
 * 新建模板说明解析（create 通路）。
 * 非法形状一律 WF_BAD_ARGS（参数层错误，先于任何读盘）。
 */
function parseNewTemplateSpec(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new WfError('create 必须是对象：{ name, description?, mode? }', 'WF_BAD_ARGS');
    }
    const raw = value;
    const name = String(raw.name ?? '').trim();
    if (!name)
        throw new WfError('create.name 必填（新建模板必须有可读名称）', 'WF_BAD_ARGS');
    const mode = raw.mode === undefined || raw.mode === null ? 'mode1' : String(raw.mode);
    if (mode !== 'mode1' && mode !== 'mode2') {
        throw new WfError("create.mode 必须是 'mode1' 或 'mode2'", 'WF_BAD_ARGS');
    }
    const description = raw.description === undefined || raw.description === null ? '' : String(raw.description);
    return { name, description, mode: mode };
}
/** 生成新模板 id（可注入缝，单测用确定性 id；缺省 tpl-<12 hex>）。 */
function generateTemplateId(host) {
    if (host.newTemplateId)
        return String(host.newTemplateId());
    return 'tpl-' + randomUUID().replace(/-/g, '').slice(0, 12);
}
/** 新建模板骨架（空图 + revision 0；ops 负责填成一份完整合法图）。 */
function newTemplateDoc(id, spec) {
    return {
        id,
        mode: spec.mode ?? 'mode1',
        name: spec.name,
        description: spec.description ?? '',
        nodes: [],
        lines: [],
        revision: 0,
    };
}
/**
 * 混组拒绝（参数层校验）。
 * 未知 op 名归为入参形状错误（WF_BAD_ARGS）而非图语义错误：否则模型会去改图，
 * 而真正要改的是自己的 op 名。
 */
function assertSingleGroup(ops) {
    const unknown = unknownOpsOf(ops);
    if (unknown.length > 0) {
        const allowed = Object.keys(GROUP_HINTS).join(' / ');
        throw new WfError(`补丁含未知操作：${unknown.join('、')}（允许的 op 组：${allowed}）`, 'WF_BAD_ARGS');
    }
    const groups = groupsOf(ops);
    if (groups.length > 1) {
        throw new WfError(`同一补丁混用了不同 op 组（${groups.map((group) => `${group}: ${GROUP_HINTS[group]}`).join('；')}）——一组一次，请拆成多次提交`, 'WF_PATCH_MIXED_GROUPS');
    }
    const group = groups[0];
    if (!group)
        throw new WfError('补丁为空：ops 至少需要一个操作', 'WF_BAD_ARGS');
    return group;
}
/** 图结构变更组：逐条容错应用 → 聚合拒绝或结构校验 → 元参数硬护栏 → 落盘 → 事实源刷新。 */
async function runGraphGroup(host, input, ops) {
    const loaded = await loadDoc(host, input);
    const doc = loaded;
    const meta = effectiveOrgMeta(metaOfDocument(doc));
    // 逐条应用并收集全部失败项：本工具不做部分应用（ops 有序依赖 + 整图检查器，
    // 部分应用会落盘半成品图），因此 errors 非空即整批拒绝。
    const applied = applyGraphOpsTolerant({ doc, ops });
    const failures = [
        ...applied.errors,
        ...await presetIdFailuresOf(host, ops, applied.result.doc),
        ...await modelSelectionFailuresOf(host, ops, applied.result.doc),
    ];
    if (failures.length > 0)
        throwPatchErrors(failures);
    const result = applied.result;
    // 串联既有结构校验：先 validateFlow（结构合法性）→ 再 checkGraphInvariants（编排质量）
    const structural = validateFlow(result.doc);
    if (!structural.ok) {
        throw new WfError(`补丁违反结构校验：${structural.issues.slice(0, 6).map((issue) => `[${issue.code}] ${issue.message}`).join('；')}`, 'WF_GRAPH_INVALID');
    }
    // 改图方恒为代理（工具不再提供来源参数）：元参数硬护栏因此永久生效。
    const milestoneUsed = Math.max(0, Math.floor(Number(host.milestoneUsedOf?.(input.sessionId)) || 0));
    const issues = checkGraphInvariants({
        flow: result.doc,
        meta,
        origin: 'agent',
        patchOps: ops.length,
        milestoneUsed,
    });
    const blocking = issues.filter((issue) => issue.level === 'error');
    if (blocking.length > 0)
        throwGraphInvalid(blocking);
    result.doc.lastPatch = {
        origin: 'agent',
        at: new Date().toISOString(),
        nodeIds: [...new Set([...result.createdNodeIds, ...result.updatedNodeIds])],
    };
    const saved = await saveDoc(host, input, result.doc);
    return {
        revision: saved.revision,
        issues,
        result,
        savedId: saved.id,
        // 预算取补丁后的规模：父代理据此判断「还能加几个节点」，而不是补丁前的旧值
        budget: budgetOf(result.doc, { milestoneUsed, patchOps: ops.length }),
    };
}
/**
 * 本批 ops **显式写入**的 presetId 的存在性校验结果。
 *
 * 只校验本批写入值：节点上被保留的历史值不在本次职责内，否则一次只改标签的补丁
 * 也会因旧值被拒。
 * 空值不算错：`presetId` 为空是「先建骨架、后配工具组合」的合法中间态，由图检查器
 * 以告警提示（运行期它等价于零工具集，这一点由告警文案说清）。
 * 目录枚举为空时放弃判定：preset 清单是 best-effort 生态缝（服务不可用时返回空清单），
 * 按空目录判定会把合法引用误判为不存在。
 */
async function presetIdFailuresOf(host, ops, applied) {
    const written = writtenPresetIdsOf(ops, applied);
    if (written.length === 0)
        return [];
    const known = await knownPresetIdsOf(host);
    if (!known)
        return [];
    return written
        .filter((item) => !known.has(item.presetId))
        .map((item) => ({
        index: item.index,
        op: item.op,
        code: 'WF_BAD_ARGS',
        message: `节点「${item.nodeId}」的 presetId「${item.presetId}」不存在——取值必须来自 wf_org_catalog 的 combos[].id（组合，推荐）或 presets[].id（官方预设）；空 presetId 意味着该节点运行期没有任何工具。可用 id：${sampleOf(known)}`,
    }));
}
/** 已知 presetId 集合（组合 id ∪ 官方 preset id）；两者都枚举不到时返回 null（放弃判定）。 */
async function knownPresetIdsOf(host) {
    const combos = await host.store.listToolCombos();
    const presets = host.listPresets ? await host.listPresets().catch(() => []) : [];
    const ids = new Set();
    for (const item of combos) {
        const id = String(item?.id ?? '').trim();
        if (id)
            ids.add(id);
    }
    for (const item of presets) {
        const id = String(item?.id ?? '').trim();
        if (id)
            ids.add(id);
    }
    return ids.size > 0 ? ids : null;
}
/** 候选 id 清单的可读摘要（截断，避免错误文本被目录撑爆）。 */
function sampleOf(ids) {
    const all = [...ids];
    const head = all.slice(0, 10).join('、');
    return all.length > 10 ? `${head}…（共 ${all.length} 个）` : head;
}
/** 本批 ops 显式写入的 presetId（create_node / update_node_data 的角色节点）。 */
function writtenPresetIdsOf(ops, applied) {
    const out = [];
    ops.forEach((op, index) => {
        if (op.op === 'create_node') {
            const node = op.node;
            const kind = String(node?.kind ?? '');
            if (kind !== 'agent' && kind !== 'parent')
                return;
            const presetId = explicitPresetId(node?.data?.presetId);
            if (presetId)
                out.push({ index, op: 'create_node', nodeId: String(node?.id ?? '(待生成 id)'), presetId });
            return;
        }
        if (op.op === 'update_node_data') {
            const nodeId = String(op.nodeId ?? '').trim();
            // 以应用后的文档为准：同一批里先建后改的节点也能解析到
            const target = applied.nodes.find((node) => node.id === nodeId);
            if (!target || (target.kind !== 'agent' && target.kind !== 'parent'))
                return;
            const presetId = explicitPresetId(op.data?.presetId);
            if (presetId)
                out.push({ index, op: 'update_node_data', nodeId, presetId });
        }
    });
    return out;
}
/** 显式写入的 presetId（null/undefined/空白 = 未写入，不算错误）。 */
function explicitPresetId(raw) {
    return raw === undefined || raw === null ? '' : String(raw).trim();
}
/**
 * 本批 ops **显式写入**的 provider/model/reasoning 的存在性校验结果。
 *
 * 与 presetId 存在性校验同口径：只校验本批写入值（历史脏值不阻断只改标签的补丁），
 * 模型清单枚举不到即放弃判定。
 * 为什么必须校验：ops 是自由对象，写错的配对不会被图检查器拦住，一路落盘到运行期
 * LLM 调用处才失败；画布下拉只列清单内的值，清单外的值在面板上退化成显示 (default)——
 * 用户看到的是「工具传了、界面却不回显」（实机取证见 policy.ts 文件头）。
 */
async function modelSelectionFailuresOf(host, ops, applied) {
    const written = writtenModelSelectionsOf(ops, applied);
    if (written.length === 0)
        return [];
    const known = await knownModelEntriesOf(host);
    if (!known)
        return [];
    return modelSelectionFailures(known, written);
}
/** 可用模型清单（缝缺失或枚举失败返回 null = 放弃存在性判定）。 */
async function knownModelEntriesOf(host) {
    if (!host.listModels)
        return null;
    const rows = await host.listModels().catch(() => []);
    return knownModelsOf(rows ?? []);
}
/**
 * 运行状态标记组：闸门状态机。
 * 状态机三关（任一不过即 WF_MILESTONE_INVALID，绝不静默放过）：
 *   ① 必须在**闸门轮**：fact.executorIsMilestone（由 proxy.data.role='milestone' 驱动）——
 *      纯编排轮、普通执行轮都没有可标记的闸门；
 *   ② 目标必须是**当前闸门**：nodeId 可写闸门虚拟节点 id 或父代理节点 id，两者都归一到
 *      父代理节点 id 后与 fact.executorParentId 比对；
 *   ③ 预算：status=ok 时 milestoneUsed 不得达到 milestoneMax（0 = 不限制；不含首次编排）。
 * 落地：快照写入**只能经运行时的 markMilestoneNode**（运行事实唯一写者）——工具层只做
 * 判定与归一化，再持久化（persistRun 缝）。
 */
async function runMarkGroup(host, sessionId, ops) {
    const facts = host.orchestrator.milestoneFactsFor(sessionId);
    if (!facts) {
        throw new WfError('mark_node: 当前会话没有正在运行的编排（闸门标记只在运行期有意义）', 'WF_MILESTONE_INVALID');
    }
    host.orchestrator.touchRunForSession(sessionId);
    const parentId = facts.executorParentId;
    if (!facts.executorIsMilestone || !parentId) {
        throw new WfError('mark_node: 当前不是父代理闸门轮——只有被 proxy（data.role=\'milestone\'）驱动的闸门轮才需要标记', 'WF_MILESTONE_INVALID');
    }
    const entry = host.orchestrator.activeRunForSession(sessionId);
    if (!entry) {
        throw new WfError('mark_node: 当前会话没有正在运行的编排（闸门标记只在运行期有意义）', 'WF_MILESTONE_INVALID');
    }
    const flow = await host.orchestrator.currentResolvedFlow(entry);
    const marked = [];
    let used = facts.milestoneUsed;
    for (const op of ops) {
        const requested = String(op?.nodeId ?? '');
        const mainId = mainNodeIdOf(flow, requested) ?? requested;
        if (mainId !== parentId) {
            throw new WfError(`mark_node:「${requested}」不是当前父代理闸门节点（当前闸门：${facts.milestoneProxyId ?? parentId}）`, 'WF_MILESTONE_INVALID');
        }
        // 参数层与预算判定仍由本工具的纯函数完成（nodeId 合法性 / status 取值 / 闸门预算）
        const result = applyMarkOp({
            op: { ...op, nodeId: mainId },
            runId: facts.runId,
            nodeIds: facts.nodeIds,
            milestoneUsed: used,
            milestoneMax: facts.milestoneMax,
        });
        // 快照写入交还运行时的唯一写者（工具层不再直接改写节点状态与 milestoneUsed）
        const written = host.orchestrator.markMilestoneNode(sessionId, { nodeId: result.nodeId, status: result.status });
        used = written.milestoneUsed;
        marked.push(result);
    }
    // 预算已随每次写入落在快照上（可审计 + 续跑继承；父代理自动完成路径永不写它）
    if (host.persistRun)
        await host.persistRun(facts.runId);
    return {
        marked,
        issues: [],
        budget: markBudgetOf(flow, {
            milestoneMax: facts.milestoneMax,
            milestoneUsed: used,
            patchOps: ops.length,
        }),
    };
}
/** 读取目标文档（模板 / 模式一实例 / 模式二服务视图）。 */
async function loadDoc(host, input) {
    // create 通路：新建模板尚不存在，基线为空图骨架（由本批 ops 填成合法图）
    if (input.newTemplateDoc)
        return input.newTemplateDoc;
    if (input.scope === 'template') {
        const template = await host.store.getFlowTemplate(input.targetId);
        if (!template)
            throw new WfError(`工作流模板不存在：${input.targetId}`, 'WF_ORG_NOT_FOUND');
        return template;
    }
    const workflow = await host.store.getWorkflow(input.sessionId, input.targetId);
    if (workflow)
        return workflow;
    const service = await host.store.getServiceAsFlow(input.targetId);
    if (service)
        return service;
    throw new WfError(`工作流/服务实例不存在或不属于本会话：${input.targetId}`, 'WF_ORG_NOT_FOUND');
}
/** 写回目标文档（模板 / 实例），并刷新活跃 run 的事实源。 */
async function saveDoc(host, input, doc) {
    const expected = Number.isFinite(Number(input.expectRevision))
        ? Number(input.expectRevision)
        : Number(doc.revision) || 0;
    // 服务端字段保留（P4）：补丁工具是服务端写者，保留 lastPatch（用户保存路径才清除标注）
    const keepServerFields = true;
    try {
        if (input.scope === 'template') {
            const template = await host.store.saveFlowTemplate({ ...doc, revision: expected }, { expectedRevision: expected, keepServerFields });
            return { id: template.id, revision: Number(template.revision) || 0 };
        }
        const isService = doc.mode === 'mode2';
        if (isService && host.store.saveServiceAsFlow) {
            const saved = await host.store.saveServiceAsFlow(doc, input.sessionId, { expectedRevision: expected, keepServerFields });
            await host.orchestrator.refreshActiveDefinitions(saved.id, input.sessionId, saved);
            return { id: saved.id, revision: Number(saved.revision) || 0 };
        }
        if (isService) {
            throw new WfError('模式二服务实例暂不支持由补丁直接改写（请改用 scope=\'template\' 规划，或先停止服务）', 'WF_SCOPE_INVALID');
        }
        const saved = await host.store.saveWorkflow({ ...doc, revision: expected }, input.sessionId, { expectedRevision: expected, keepServerFields });
        // 双向同步②：补丁落盘 → 刷新活跃 run 事实源（画布回显由前端轮询/保存事件驱动）
        await host.orchestrator.refreshActiveDefinitions(saved.id, input.sessionId, saved);
        return { id: saved.id, revision: Number(saved.revision) || 0 };
    }
    catch (error) {
        const code = error?.code ?? '';
        if (code === ERR_REVISION_CONFLICT) {
            throw new WfError('画布刚被修改，请基于最新拓扑重新提交（expectRevision 不匹配，本工具不自动重试）', 'WF_PATCH_CONFLICT');
        }
        throw error;
    }
}
/** 组装并执行一次补丁（导出供单测直接断言，无需起工具注册表）。 */
export async function executeGraphPatch(host, sessionId, args) {
    const scope = String(args?.scope ?? '');
    if (scope !== 'template' && scope !== 'instance') {
        throw new WfError('scope 必须是 \'template\' 或 \'instance\'', 'WF_SCOPE_INVALID');
    }
    const spec = parseNewTemplateSpec(args?.create);
    const ops = Array.isArray(args?.ops) ? args?.ops : [];
    if (ops.length === 0)
        throw new WfError('补丁为空：ops 至少需要一个操作', 'WF_BAD_ARGS');
    if (ops.length > PATCH_OPS_HARD_LIMIT) {
        throw new WfError(`单次补丁操作过多（${ops.length} > ${PATCH_OPS_HARD_LIMIT}），请拆分提交`, 'WF_BAD_ARGS');
    }
    const group = assertSingleGroup(ops);
    // 闸门同一时刻只有一个：标记组一次只允许 1 条 op，否则「已应用条数」与实际标记数不符
    if (group === 'mark' && ops.length !== 1) {
        throw new WfError(`mark 组一次只能提交 1 条 op（当前闸门只有一个），收到 ${ops.length} 条`, 'WF_BAD_ARGS');
    }
    const expectRevision = Number.isFinite(Number(args?.expectRevision)) ? Number(args.expectRevision) : undefined;
    // —— create 通路的参数层约束（先于任何读盘，错误可立即自我修正） ——
    if (spec && scope !== 'template') {
        throw new WfError("create 只能用于 scope='template'（新建的是工作流模板，不是实例）", 'WF_SCOPE_INVALID');
    }
    if (spec && group !== 'graph') {
        throw new WfError(`create 只能与 graph 组同用（当前是 ${group} 组）：新建模板必须一次给出完整合法图`, 'WF_SCOPE_INVALID');
    }
    if (spec && expectRevision !== undefined) {
        throw new WfError('create 与 expectRevision 互斥：新建没有可比的旧版本', 'WF_BAD_ARGS');
    }
    let targetId = String(args?.targetId ?? '').trim();
    if (spec) {
        if (!targetId)
            targetId = generateTemplateId(host);
        // 显式给 id 时绝不静默覆盖既有模板（TOCTOU 由 saveDoc 的 expectedRevision=0 二次兜底）
        const existing = await host.store.getFlowTemplate(targetId);
        if (existing) {
            throw new WfError(`工作流模板已存在：${targetId}。若要改它，请去掉 create 并带上 expectRevision=${Number(existing.revision) || 0}`, 'WF_PATCH_CONFLICT');
        }
    }
    else if (!targetId) {
        throw new WfError('补丁需要 targetId（templateId 或 flowId）', 'WF_BAD_ARGS');
    }
    const baseInput = {
        scope,
        sessionId,
        targetId,
        ...(expectRevision !== undefined ? { expectRevision } : {}),
        ...(spec ? { newTemplateDoc: newTemplateDoc(targetId, spec) } : {}),
    };
    // 新建路径跳过「目标必须已存在」校验（它正是本批补丁要创建的东西）
    if (!spec)
        await assertScopeTarget(host, scope, { sessionId, targetId });
    if (group === 'graph') {
        const { revision, issues, result, budget } = await runGraphGroup(host, baseInput, ops);
        return {
            ok: true,
            scope,
            targetId,
            revision,
            applied: ops.length,
            budget,
            warnings: warningsOf(issues),
            // create 通路：明确告知模型「这是新模板 id，后续补丁/投产都用它」
            ...(spec ? { newTemplate: true } : {}),
            created: result.createdNodeIds,
            removed: result.removedNodeIds,
            updated: result.updatedNodeIds,
            connected: result.connectedLineIds,
            disconnected: result.disconnectedLineIds,
        };
    }
    const { marked, issues, budget } = await runMarkGroup(host, sessionId, ops);
    // 标记组不改文档：revision 取自运行快照（run 记录内的文档版本），避免白读一次磁盘
    const entry = host.orchestrator.activeRunForSession(sessionId);
    return {
        ok: true,
        scope,
        targetId,
        revision: Number(entry?.baseFlow?.revision) || 0,
        applied: ops.length,
        budget,
        warnings: warningsOf(issues),
        marked: marked[0],
        // 闸门预算进度：让父代理立刻看到「还剩几次闸门」，无需再查目录
        milestoneUsed: Math.max(0, Math.floor(Number(entry?.snapshot?.milestoneUsed) || 0)),
    };
}
/**
 * 注册 wf_graph_patch（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfGraphPatch(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_graph_patch');
    }
    const def = defineTool({
        name: WF_GRAPH_PATCH,
        // 描述只写「何时调用 / 前置条件 / 失败语义 / 副作用」，字段形状与提交规则不在此重复：
        // 常驻文本会随每次请求付费，而完整契约按需从 wf_org_catalog 的 rules 取（同一事实源）。
        description: 'Apply one patch to a workflow template or the running instance. Two op groups: graph structure and run-state marking; a patch must use ops from ONE group at a time. ' +
            PATCH_CONTRACT_POINTER + ' ' +
            'Planning a NEW template: pass scope=template plus create={name, description?, mode?} with graph ops that build a complete valid graph (start + executable units + end). The response returns newTemplate=true and targetId = the new template id; expectRevision must be omitted there. ' +
            'The patch is atomic: if ANY op fails, nothing is persisted and every failing op is reported in one reply with its own code. ' +
            'The flow graph must stay an acyclic DAG even for review rework: model "review failed" as a forward conditional branch (condition={type:"fail"}) into a repair node that rejoins the main line downstream — a back-edge to an upstream node is rejected with flowCycle. ' +
            'mark group: mark_node — completes the CURRENT milestone gate only, i.e. while the parent turn is a gate driven by a proxy with data.role=milestone; the response reports milestoneUsed. ' +
            'The response always carries a read-only budget (effective limits plus current usage and remaining room). ' +
            'Never pass node positions: coordinates are view-only and re-laid out by the canvas automatically.',
        parameters: {
            scope: { type: 'string', required: true, enum: ['template', 'instance'], description: 'template: plan a reusable workflow template; instance: adjust the current running instance.' },
            targetId: { type: 'string', description: 'Workflow template id (scope=template) or workflow/instance id (scope=instance). Required unless create is given; with create you may omit it to let the server mint a new id.' },
            create: {
                type: 'object',
                additionalProperties: false,
                description: 'Create a NEW workflow template (scope=template and graph ops only). Omit when updating an existing target. Fails with WF_PATCH_CONFLICT if the given targetId already exists.',
                properties: {
                    name: { type: 'string', required: true, description: 'Human-readable template name.' },
                    description: { type: 'string', description: 'Optional template description.' },
                    mode: { type: 'string', enum: ['mode1', 'mode2'], description: 'Workflow mode; default mode1.' },
                },
            },
            expectRevision: { type: 'number', description: 'Optimistic-lock revision you last read; mismatch is rejected without retry (WF_PATCH_CONFLICT).' },
            ops: {
                type: 'array',
                required: true,
                description: 'Patch operations; all ops must belong to ONE group (graph | mark) and are applied in array order. '
                    + 'Exact field shapes are NOT listed here — read rules.patchContract from wf_org_catalog (omit ids). '
                    + 'Example: [{ "op": "create_node", "node": { "kind": "agent", "id": "n1", "data": { "label": "分析", "presetId": "<combo id>" } } }, '
                    + '{ "op": "connect", "source": "n1", "target": "n2" }].',
                items: { type: 'object', additionalProperties: true },
            },
        },
        output: {
            // 【关键】additionalProperties: false + 声明必须覆盖 executeGraphPatch 的全部返回字段，
            // 否则宿主对工具返回体做 JSON Schema 校验时会判定「is not a declared property」并
            // 把成功调用变成错误（实机验证发现：各组的变更清单与标记结果漏声明会让整组 op 不可用）。
            // 单测直接调 executeGraphPatch 绕过该校验，故另有「output schema 覆盖」用例守护本文件。
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true, description: 'true when the patch was persisted.' },
                    scope: { type: 'string', required: true, enum: ['template', 'instance'], description: 'Echo of the patch scope.' },
                    targetId: { type: 'string', required: true, description: 'Echo of the patched target id.' },
                    revision: { type: 'number', required: true, description: 'New revision after persisting.' },
                    applied: { type: 'number', required: true, description: 'Number of ops applied.' },
                    warnings: { type: 'array', required: true, description: 'Checker warnings (non-blocking).', items: { type: 'object', additionalProperties: true } },
                    // 只读预算：两组都会返回（additionalProperties:true，避免嵌套字段被宿主判为未声明）
                    budget: { type: 'object', required: true, additionalProperties: true, description: 'Read-only org budget for the patched target: effective limits plus current usage and remaining room (both op groups).' },
                    newTemplate: { type: 'boolean', description: 'true when this patch created a new template; targetId is then the new template id.' },
                    milestoneUsed: { type: 'number', description: 'Completed milestone gates in this run after a mark_node patch (the first orchestration is not counted).' },
                    // graph 组：本次补丁实际改动的 id 清单（节点/连线），供模型继续引用
                    created: { type: 'array', items: { type: 'string' }, description: 'Node ids created by this patch (graph group).' },
                    removed: { type: 'array', items: { type: 'string' }, description: 'Node ids removed by this patch (graph group; includes proxy nodes dropped with their source).' },
                    updated: { type: 'array', items: { type: 'string' }, description: 'Node/group ids updated by this patch (graph group).' },
                    connected: { type: 'array', items: { type: 'string' }, description: 'Line ids created by this patch (graph group).' },
                    disconnected: { type: 'array', items: { type: 'string' }, description: 'Line ids removed by this patch (graph group).' },
                    // mark 组：本次标记结果（nodeId/status/runId）
                    marked: {
                        type: 'object',
                        additionalProperties: false,
                        description: 'Marked milestone node after a mark_node patch (mark group).',
                        properties: {
                            nodeId: { type: 'string', required: true, description: 'The marked parent/gate node id.' },
                            status: { type: 'string', required: true, enum: ['ok', 'fail'], description: 'Milestone marking status.' },
                            runId: { type: 'string', required: true, description: 'The active run id the marking belongs to.' },
                        },
                    },
                },
            },
            render: textRender,
        },
        async execute(args, exec) {
            const caller = callerOf(exec);
            if (caller.isChild)
                throw new WfError('子代理无法调用 wf_graph_patch（改图是父代理的组织权限）', 'WF_NOT_ROOT');
            if (!caller.sessionId)
                throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER');
            return executeGraphPatch(host, caller.sessionId, (args ?? {}));
        },
    });
    return tools.register(def);
}
export { hasBlockingIssues };
//# sourceMappingURL=tool.js.map
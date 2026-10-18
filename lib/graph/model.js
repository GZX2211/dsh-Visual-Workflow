// src/host/graph/model.ts
//
// 工作流图模型（T-013）：节点/连线工厂函数、连接点兼容矩阵与拓扑查询助手。
// 纯类型定义见 src/host/shared/graph-model.ts（T-014，零 import 纯类型层），
// 本文件是 host 侧运行时逻辑（校验/归一化见 validate.ts）。
//
// 为什么矩阵与类型分家（架构文档 §2.3）：shared 层必须零 import 供 client 类型引用；
// 矩阵/工厂等运行时值只能落在 host 侧 graph/ 目录，避免污染 client 纯度门。
//
// 设计要点（需求文档 §4.2/§4.3）：
//   - 「节点 JSON 即事实源」：拖入画布即深拷贝内联，本模型不含 templateId 引用（§4.2.1）。
//   - 连接点分三通道：flow（控制流）/ ctx（上下文）/ db（数据库服务标识，不注入内容）。
//   - 连线为有向线段；条件仅流程线（§4.3 规则 4）。
import { DEFAULT_OUTPUT_CONTRACT_TEXT, STAGE_LABELS } from '../shared/protocol.js';
import { createHash } from 'node:crypto';
import { isFlowLine } from './dag.js';
/**
 * 连接点兼容矩阵（NODE_HANDLES）。
 *
 * 语义依据：
 *   - 角色节点（parent/agent）：左入 数据库/上下文/流程入，右出 上下文/流程出（§4.2.3.1/§4.2.3.2）
 *   - 任务节点：无左入，右出 上下文（任务描述文本直通，§4.2.4.1）
 *   - 数据库节点：无左入，右出 数据库（服务标识，§4.2.4.2）
 *   - 启动/输入（start）：无左入，右出 流程出 + 上下文出（上下文出仅模式二输入节点，§4.2.5.1）
 *   - 结束/输出（end）：左入 流程入（+ 上下文入仅模式二输出节点），无右出（§4.2.5.1）
 *   - 暂停（pause）：左入 流程入，右出 流程出（流程门语义，仅模式一，§4.2.5.1）
 *   - Team（group）：左入 流程入 / 上下文入，右出 流程出；ctx-in 表示团队整体任务
 *     （父代理读图理解，不注入成员），Team 卡片不提供 ctx-out/db 连接点（§4.2.5.2）
 *   - 虚拟节点（proxy）：与主节点（角色）一致——运行时解析为主节点共享执行实例（§4.2.3.2 规则 7）
 *
 * 模式差异（mode1/mode2）不在此矩阵体现，由 validate.ts 按 flow.mode 做额外约束
 * （如 mode1 的 start 禁用 ctx-out、mode2 的 end 启用 ctx-in）。
 *
 * 技术债（ctx-out 停用）：角色节点（parent/agent/proxy）的 ctx-out 已不再是注入来源——
 * 上游产出改由流程线自动注入下游（见 autoContextSourceIds）。该连接点**暂予保留**，
 * 连线仍然合法（结构校验不变、旧图零迁移），但画布 UI 已删除该接点、历史连线隐藏，
 * 连上也不再产生任何注入效果；未来若需要「手动指定注入内容」可在此扩展。
 * 检索标记：`技术债（ctx-out 停用）`。
 */
export const NODE_HANDLES = {
    parent: { inputs: ['flow-in', 'ctx-in', 'db-in'], outputs: ['flow-out', 'ctx-out'] },
    agent: { inputs: ['flow-in', 'ctx-in', 'db-in'], outputs: ['flow-out', 'ctx-out'] },
    task: { inputs: [], outputs: ['ctx-out'] },
    database: { inputs: [], outputs: ['db-out'] },
    start: { inputs: [], outputs: ['flow-out', 'ctx-out'] },
    end: { inputs: ['flow-in', 'ctx-in'], outputs: [] },
    pause: { inputs: ['flow-in'], outputs: ['flow-out'] },
    group: { inputs: ['flow-in', 'ctx-in'], outputs: ['flow-out'] },
    proxy: { inputs: ['flow-in', 'ctx-in', 'db-in'], outputs: ['flow-out', 'ctx-out'] },
};
/**
 * 通道本体：三条通道各自的出/入连接点名（**唯一来源**）。
 *
 * 为什么收敛在此：通道判定此前散落为 `line.targetHandle === 'ctx-in'` 之类的裸字面量，
 * 与 HANDLE_PAIRING 构成**两套口径**——任一处改名/新增通道都必然漏改。现在全模块
 * （配对矩阵、结构校验、质量检查、拓扑查询）只允许引用本表，裸字面量只出现在这里。
 */
export const HANDLE_CHANNELS = {
    flow: { out: 'flow-out', in: 'flow-in' },
    ctx: { out: 'ctx-out', in: 'ctx-in' },
    db: { out: 'db-out', in: 'db-in' },
};
/** 某通道的输入连接点。 */
export function channelIn(channel) {
    return HANDLE_CHANNELS[channel].in;
}
/** 某通道的输出连接点。 */
export function channelOut(channel) {
    return HANDLE_CHANNELS[channel].out;
}
/** 连接点 → 所属通道（输出侧查询；未登记返回 null）。 */
export function channelOfOut(handle) {
    if (handle === HANDLE_CHANNELS.flow.out)
        return 'flow';
    if (handle === HANDLE_CHANNELS.ctx.out)
        return 'ctx';
    if (handle === HANDLE_CHANNELS.db.out)
        return 'db';
    return null;
}
/** 连接点 → 所属通道（输入侧查询；未登记返回 null）。 */
export function channelOfIn(handle) {
    if (handle === HANDLE_CHANNELS.flow.in)
        return 'flow';
    if (handle === HANDLE_CHANNELS.ctx.in)
        return 'ctx';
    if (handle === HANDLE_CHANNELS.db.in)
        return 'db';
    return null;
}
/**
 * 输出连接点 → 允许的输入连接点映射（三通道互斥，§4.3 连线类型规范）。
 *
 * 键值全部取自 HANDLE_CHANNELS：本矩阵是通道本体的投影，不是第二份口径。
 * 查询契约：**只以输出连接点为源**（所有连线都是 out → in），故入点三键是恒等占位，
 * 仅为 `Record<Handle, Handle>` 的类型完整性存在，永不作为查询键。
 */
export const HANDLE_PAIRING = {
    [HANDLE_CHANNELS.flow.out]: HANDLE_CHANNELS.flow.in,
    [HANDLE_CHANNELS.ctx.out]: HANDLE_CHANNELS.ctx.in,
    [HANDLE_CHANNELS.db.out]: HANDLE_CHANNELS.db.in,
    [HANDLE_CHANNELS.flow.in]: HANDLE_CHANNELS.flow.in,
    [HANDLE_CHANNELS.ctx.in]: HANDLE_CHANNELS.ctx.in,
    [HANDLE_CHANNELS.db.in]: HANDLE_CHANNELS.db.in,
};
/**
 * 配对查询的单一入口（validate 与 wf_graph_patch 共用，避免各自散落 `HANDLE_PAIRING[…]`）。
 * 未登记的源连接点回退为其自身：让调用方按「通道不匹配」报错，而不是抛类型错误。
 */
export function pairingTargetOf(sourceHandle) {
    return HANDLE_PAIRING[sourceHandle] ?? sourceHandle;
}
/** 条件连线类型全集（§4.3 连线类型表）。 */
export const CONDITION_TYPES = ['pass', 'fail', 'content'];
/** 全部节点种类（供校验/测试枚举）。 */
export const NODE_KINDS = [
    'parent',
    'agent',
    'task',
    'database',
    'start',
    'end',
    'pause',
    'group',
    'proxy',
];
// ---------------------------------------------------------------------------
// 工厂函数（画布交互/导入/测试用；与旧项目 newNode/newEdge 同构）
// ---------------------------------------------------------------------------
/** 生成画布内唯一的节点 id（node-<12位随机十六进制>，无需时钟参与，前缀稳定）。 */
export function makeNodeId() {
    return `node-${createHash('sha1').update(Math.random().toString(36) + Date.now().toString(36)).digest('hex').slice(0, 12)}`;
}
/** 生成画布内唯一的连线 id。 */
export function makeLineId() {
    return `line-${createHash('sha1').update(Math.random().toString(36) + Date.now().toString(36)).digest('hex').slice(0, 12)}`;
}
/**
 * 新建角色节点（父/子代理，数据形状见 shared RoleNode）。
 * 深拷贝解耦语义：工厂只产出空白默认值，由调用方把模板数据复制进来（§4.2.1）。
 *
 * 输出契约默认文本直接落盘（不靠读取期兜底）：界面显示、运行期注入与磁盘存的是同一个值。
 * 父代理不参与节点交接（产出由编排器按需转述），故它不落默认契约。
 */
export function newRoleNode(kind, label, position = { x: 120, y: 80 }) {
    return {
        id: makeNodeId(),
        kind,
        position: { x: position.x, y: position.y },
        data: {
            label,
            systemPrompt: '',
            provider: '',
            model: '',
            reasoning: undefined,
            presetId: null,
            retryLimit: 3,
            reactLimit: null,
            inputSchema: '',
            outputSchema: kind === 'agent' ? DEFAULT_OUTPUT_CONTRACT_TEXT : '',
            injectSystemPrompt: true,
            injectToolSections: true,
            promptFilePath: undefined,
            groupId: null,
        },
    };
}
/**
 * 新建任务节点（文本描述任务，§4.2.4.1）。
 * label 为节点名称（卡片设计必填字段），content 为任务描述正文（允许为空）。
 */
export function newTaskNode(label, position = { x: 120, y: 80 }) {
    return {
        id: makeNodeId(),
        kind: 'task',
        position: { x: position.x, y: position.y },
        data: { label, content: '' },
    };
}
/**
 * 新建数据库节点（§4.2.4.2）。
 * label 为名称、description 为描述（卡片设计必填字段）。
 */
export function newDatabaseNode(dbType, label, position = { x: 120, y: 80 }) {
    return {
        id: makeNodeId(),
        kind: 'database',
        position: { x: position.x, y: position.y },
        data: {
            label,
            description: '',
            dbType,
            dbKind: dbType === 'local' ? 'sqlite' : 'mysql',
            localPath: dbType === 'local' ? '' : undefined,
            conn: dbType === 'server' ? { host: '', port: 3306, user: '', password: '', db: '' } : undefined,
            vectorSource: dbType === 'local' ? 'embedding' : undefined,
        },
    };
}
/** 新建阶段节点（start/end/pause；label 由模式决定，硬编码锁定，§4.2.5.1）。 */
export function newStageNode(kind, mode, position = { x: 120, y: 80 }) {
    return {
        id: makeNodeId(),
        kind,
        position: { x: position.x, y: position.y },
        data: { label: stageLabel(kind, mode) },
    };
}
/** 阶段节点硬编码名称（§4.2.5.1 卡片设计表：启动/输入、结束/输出、暂停）。 */
export function stageLabel(kind, mode) {
    return STAGE_LABELS[mode][kind];
}
/** 新建 Team 节点（§4.2.5.2）。 */
export function newGroupNode(label, position = { x: 120, y: 80 }) {
    return {
        id: makeNodeId(),
        kind: 'group',
        position: { x: position.x, y: position.y },
        data: { label, collabPrompt: '', memberIds: [], size: { w: 360, h: 240 } },
    };
}
/** 新建虚拟节点：引用主节点 id，不携带独立配置（§4.2.3.2 规则 4/7）。 */
export function newProxyNode(sourceId, position = { x: 120, y: 80 }) {
    return { id: makeNodeId(), kind: 'proxy', position: { x: position.x, y: position.y }, proxySourceId: sourceId };
}
/** 新建连线（无条件的默认流程线；type 由 condition 派生，§4.3 规则 1）。 */
export function newLine(source, target, sourceHandle, targetHandle, condition) {
    return { id: makeLineId(), source, target, sourceHandle, targetHandle, condition };
}
// ---------------------------------------------------------------------------
// 拓扑查询助手（编排器/任务块组装共用）
// ---------------------------------------------------------------------------
/** 显式启动节点：kind='start' 的节点即流程入口（§4.2.5.1；架构文档 §4.2 入口解析）。 */
export function entryNodes(flow) {
    return (flow.nodes ?? []).filter((n) => n.kind === 'start');
}
/** 某节点的流程出边列表（用于下游推进/条件分支，§4.3；仅完整通道配对的流程线）。 */
export function flowOutEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => isFlowLine(l) && l.source === nodeId);
}
/** 某节点的流程入边列表（上游流程来源；仅完整通道配对的流程线）。 */
export function flowInEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => isFlowLine(l) && l.target === nodeId);
}
// 流程线判定（isFlowLine）的**唯一本体在 dag.ts**：本文件的「参与流程 / 被流程驱动」
// 判定复用该实现，避免同一概念出现两套口径（历史上曾以「或」语义重复实现，会把
// ctx/db 通道的非法线误判为流程线）。
/**
 * 节点是否参与流程拓扑（作为任一流程线的源或目标；ctx/db 连线不计）。
 * 虚拟节点（proxy）的流程线归属其主角色节点：主节点自身或其任一虚拟节点参与
 * 流程线即视为该角色参与流程（用户批注：无流程连接的 agent 为「不执行任务的
 * 无关节点」——不进入编排清单，也不作为「可执行单元」的判定依据）。
 */
export function nodeParticipatesInFlow(flow, nodeId) {
    const lines = flow.lines ?? [];
    if (lines.some((l) => isFlowLine(l) && (l.source === nodeId || l.target === nodeId)))
        return true;
    return proxiesOf(flow, nodeId).some((p) => lines.some((l) => isFlowLine(l) && (l.source === p.id || l.target === p.id)));
}
/**
 * 节点是否被流程线**驱动**（存在流程入边，或其任一虚拟节点存在流程入边）。
 * 与「参与流程」的区别：仅有流程出而无流程入的节点不会被上游激活——
 * 父代理「被流程线连接」的判定以驱动（流程入）为准，与编排运行时
 * （prepareParentExecutor/parentExecutorOf）语义保持一致。
 * 入边判定复用 isFlowLine（两端通道配对）：只看目标侧 handle 会把「上下文出 → 流程入」
 * 这类幽灵线算成驱动，与流程子图口径分裂——本函数与 isFlowLine 同源。
 */
export function nodeHasFlowIn(flow, nodeId) {
    const lines = flow.lines ?? [];
    const hasIn = (id) => lines.some((l) => isFlowLine(l) && l.target === id);
    if (hasIn(nodeId))
        return true;
    return proxiesOf(flow, nodeId).some((p) => hasIn(p.id));
}
/**
 * 某节点的 ctx-in 入边列表。
 * 现状（技术债（ctx-out 停用））：角色节点的 ctx 出线已不再是注入来源，该查询只剩
 * task 数据源节点这一真实消费方——调用方必须按来源 kind 过滤，不得再把角色来源当上下文。
 */
export function ctxInEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => l.target === nodeId && l.targetHandle === channelIn('ctx'));
}
/** 某节点的 db-in 入边列表（数据库服务标识来源；有边才注入 wf_db_query，§4.4.3 规则 5）。 */
export function dbInEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => l.target === nodeId && l.targetHandle === channelIn('db'));
}
/**
 * 自动上下文注入的来源节点 id 清单（保序、去重；元素语义是「快照记账节点 id」）。
 *
 * 语义（用户裁决 2026-10）：节点交接不再依赖手动 ctx 连线，下游节点自动接收
 * **直接流程前驱**的最终产出。三条边界：
 *   - 无产出的阶段节点（pause）不携带交接内容，跳过它继续向前找；
 *   - Team 与上下游解耦（输入与产出由父代理协调），遇到它既不取来源也不回溯，
 *     否则会把组的上游产出越权塞给组的下游；
 *   - 虚拟节点的流程线归属其主节点（与 nodeParticipatesInFlow 同源），proxy 前驱
 *     解析为它引用的主节点——快照按主节点记账。
 *
 * 返回的是「可能提供产出」的来源，是否真的注入由调用方按快照产出判定
 * （未产出或有状态无内容都不构成上下文）。纯函数，同输入同输出。
 */
export function autoContextSourceIds(flow, nodeId) {
    const sources = [];
    const emitted = new Set();
    const expanded = new Set();
    const queue = [];
    const enqueueIncoming = (id) => {
        for (const line of flowInEdges(flow, id))
            queue.push(line.source);
    };
    enqueueIncoming(nodeId);
    for (const proxy of proxiesOf(flow, nodeId))
        enqueueIncoming(proxy.id);
    while (queue.length > 0) {
        const sourceId = queue.shift();
        if (expanded.has(sourceId))
            continue;
        expanded.add(sourceId);
        const source = nodeById(flow, sourceId);
        if (!source)
            continue;
        if (source.kind === 'proxy') {
            const main = nodeById(flow, source.proxySourceId);
            if (main && (main.kind === 'agent' || main.kind === 'parent') && !emitted.has(main.id)) {
                emitted.add(main.id);
                sources.push(main.id);
            }
            continue;
        }
        // start 是模式二的输入节点（承载用户问题）；模式一由调用方按快照产出过滤
        if (source.kind === 'agent' || source.kind === 'parent' || source.kind === 'start') {
            if (!emitted.has(source.id)) {
                emitted.add(source.id);
                sources.push(source.id);
            }
            continue;
        }
        if (source.kind === 'pause')
            enqueueIncoming(source.id);
    }
    return sources;
}
/** 某节点 flow-out 直接下游节点 id 列表（含条件连线，供父代理按拓扑推进）。 */
export function downstreamFlowNodeIds(flow, nodeId) {
    return flowOutEdges(flow, nodeId).map((l) => l.target);
}
/** 按 id 取节点；不存在返回 undefined。 */
export function nodeById(flow, nodeId) {
    return (flow.nodes ?? []).find((n) => n.id === nodeId);
}
/** 按 id 取连线。 */
export function lineById(flow, lineId) {
    return (flow.lines ?? []).find((l) => l.id === lineId);
}
/** 某主节点的全部虚拟节点（§4.2.3.2 规则 4：复制按钮生成）。 */
export function proxiesOf(flow, nodeId) {
    return (flow.nodes ?? []).filter((n) => n.kind === 'proxy' && n.proxySourceId === nodeId);
}
/** 某角色节点所属 Team id（不在组内返回 null）。 */
export function memberGroupId(flow, nodeId) {
    const n = nodeById(flow, nodeId);
    return n && (n.kind === 'parent' || n.kind === 'agent') ? (n.data.groupId ?? null) : null;
}
/** 判断角色节点是否为 Team 成员（§4.2.5.2 规则 4：组内成员仅 ctx/db 连接点）。 */
export function isGroupMember(flow, nodeId) {
    return memberGroupId(flow, nodeId) !== null;
}
//# sourceMappingURL=model.js.map
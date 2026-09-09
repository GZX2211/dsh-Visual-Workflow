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
import { createHash } from 'node:crypto';
/**
 * 连接点兼容矩阵（NODE_HANDLES）。
 *
 * 语义依据：
 *   - 角色节点（parent/agent）：左入 数据库/上下文/流程入，右出 上下文/流程出（§4.2.3.1/§4.2.3.2）
 *   - 文件节点：无左入，右出 上下文（文本内容直通 / 受管路径索引，§4.2.4.1）
 *   - 数据库节点：无左入，右出 数据库（服务标识，§4.2.4.2）
 *   - 启动/输入（start）：无左入，右出 流程出 + 上下文出（上下文出仅模式二输入节点，§4.2.5.1）
 *   - 结束/输出（end）：左入 流程入（+ 上下文入仅模式二输出节点），无右出（§4.2.5.1）
 *   - 暂停（pause）：左入 流程入，右出 流程出（流程门语义，仅模式一，§4.2.5.1）
 *   - 协作组（group）：左入 流程入，右出 流程出；组卡片不提供 ctx/db 连接点（§4.2.5.2）
 *   - 虚拟节点（proxy）：与主节点（角色）一致——运行时解析为主节点共享执行实例（§4.2.3.2 规则 7）
 *
 * 模式差异（mode1/mode2）不在此矩阵体现，由 validate.ts 按 flow.mode 做额外约束
 * （如 mode1 的 start 禁用 ctx-out、mode2 的 end 启用 ctx-in）。
 */
export const NODE_HANDLES = {
    parent: { inputs: ['flow-in', 'ctx-in', 'db-in'], outputs: ['flow-out', 'ctx-out'] },
    agent: { inputs: ['flow-in', 'ctx-in', 'db-in'], outputs: ['flow-out', 'ctx-out'] },
    file: { inputs: [], outputs: ['ctx-out'] },
    database: { inputs: [], outputs: ['db-out'] },
    start: { inputs: [], outputs: ['flow-out', 'ctx-out'] },
    end: { inputs: ['flow-in', 'ctx-in'], outputs: [] },
    pause: { inputs: ['flow-in'], outputs: ['flow-out'] },
    group: { inputs: ['flow-in'], outputs: ['flow-out'] },
    proxy: { inputs: ['flow-in', 'ctx-in', 'db-in'], outputs: ['flow-out', 'ctx-out'] },
};
/** 输出连接点 → 允许的输入连接点映射（三通道互斥，§4.3 连线类型规范）。 */
export const HANDLE_PAIRING = {
    'flow-out': 'flow-in',
    'ctx-out': 'ctx-in',
    'db-out': 'db-in',
    // 入点不作映射源；以下三键仅为类型完整性，实际校验只查询 out→in。
    'flow-in': 'flow-in',
    'ctx-in': 'ctx-in',
    'db-in': 'db-in',
};
/** 条件连线类型全集（§4.3 连线类型表）。 */
export const CONDITION_TYPES = ['pass', 'fail', 'content'];
/** 全部节点种类（供校验/测试枚举）。 */
export const NODE_KINDS = [
    'parent',
    'agent',
    'file',
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
            outputSchema: '',
            injectSystemPrompt: true,
            injectToolSections: true,
            promptFilePath: undefined,
            groupId: null,
        },
    };
}
/**
 * 新建文件节点（text 或受管 file，§4.2.4.1）。
 * label 为节点名称（卡片设计必填字段）。
 */
export function newFileNode(fileKind, label, position = { x: 120, y: 80 }) {
    return {
        id: makeNodeId(),
        kind: 'file',
        position: { x: position.x, y: position.y },
        data: { fileKind, label, content: fileKind === 'text' ? '' : undefined, managedPath: undefined, fileName: '' },
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
    if (kind === 'start')
        return mode === 'mode1' ? '启动' : '输入';
    if (kind === 'end')
        return mode === 'mode1' ? '结束' : '输出';
    return '暂停';
}
/** 新建协作组节点（§4.2.5.2）。 */
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
/** 某节点的 flow-out 出边列表（用于下游推进/条件分支，§4.3）。 */
export function flowOutEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => l.source === nodeId && l.sourceHandle === 'flow-out');
}
/** 某节点的 flow-in 入边列表（上游流程来源）。 */
export function flowInEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => l.target === nodeId && l.targetHandle === 'flow-in');
}
/** 某连线是否为流程线（流程出 → 流程入；ctx/db 连线不参与编排调度，§4.3 连线类型规范）。 */
export function isFlowLine(line) {
    return line.sourceHandle === 'flow-out' || line.targetHandle === 'flow-in';
}
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
 * 节点是否被流程线**驱动**（存在 flow-in 入边，或其任一虚拟节点存在 flow-in 入边）。
 * 与「参与流程」的区别：仅有 flow-out 而无 flow-in 的节点不会被上游激活——
 * 父代理「被流程线连接」的判定以驱动（flow-in）为准，与编排运行时
 * （prepareParentExecutor/parentExecutorOf）语义保持一致。
 */
export function nodeHasFlowIn(flow, nodeId) {
    const lines = flow.lines ?? [];
    const hasIn = (id) => lines.some((l) => l.target === id && l.targetHandle === 'flow-in');
    if (hasIn(nodeId))
        return true;
    return proxiesOf(flow, nodeId).some((p) => hasIn(p.id));
}
/** 某节点的 ctx-in 入边列表（上游上下文来源，§4.2.3.2 规则 5 显式连线）。 */
export function ctxInEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => l.target === nodeId && l.targetHandle === 'ctx-in');
}
/** 某节点的 db-in 入边列表（数据库服务标识来源；有边才注入 wf_db_query，§4.4.3 规则 5）。 */
export function dbInEdges(flow, nodeId) {
    return (flow.lines ?? []).filter((l) => l.target === nodeId && l.targetHandle === 'db-in');
}
/** 某节点经 ctx 连线收到的上游来源节点 id 列表（去重，供任务块组装注入上游产出）。 */
export function upstreamCtxNodeIds(flow, nodeId) {
    return [...new Set(ctxInEdges(flow, nodeId).map((l) => l.source))];
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
/** 某协作组的成员节点 id 列表。 */
export function groupMemberIds(flow, groupId) {
    const g = nodeById(flow, groupId);
    return g && g.kind === 'group' ? g.data.memberIds : [];
}
/** 某角色节点所属协作组 id（不在组内返回 null）。 */
export function memberGroupId(flow, nodeId) {
    const n = nodeById(flow, nodeId);
    return n && (n.kind === 'parent' || n.kind === 'agent') ? (n.data.groupId ?? null) : null;
}
/** 判断角色节点是否为协作组成员（§4.2.5.2 规则 4：组内成员仅 ctx/db 连接点）。 */
export function isGroupMember(flow, nodeId) {
    return memberGroupId(flow, nodeId) !== null;
}
//# sourceMappingURL=model.js.map
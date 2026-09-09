import type { ConditionType, DatabaseNode, FileNode, GraphNode, GroupNode, Handle, Line, NodeKind, ProxyNode, RoleNode, StageNode, WorkflowDocument, WorkflowMode } from '../shared/graph-model.js';
/** 单类节点的连接点定义：入点集合与出点集合。 */
export interface NodeHandleDef {
    inputs: Handle[];
    outputs: Handle[];
}
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
export declare const NODE_HANDLES: Record<NodeKind, NodeHandleDef>;
/** 输出连接点 → 允许的输入连接点映射（三通道互斥，§4.3 连线类型规范）。 */
export declare const HANDLE_PAIRING: Record<Handle, Handle>;
/** 条件连线类型全集（§4.3 连线类型表）。 */
export declare const CONDITION_TYPES: ConditionType[];
/** 全部节点种类（供校验/测试枚举）。 */
export declare const NODE_KINDS: NodeKind[];
/** 生成画布内唯一的节点 id（node-<12位随机十六进制>，无需时钟参与，前缀稳定）。 */
export declare function makeNodeId(): string;
/** 生成画布内唯一的连线 id。 */
export declare function makeLineId(): string;
/**
 * 新建角色节点（父/子代理，数据形状见 shared RoleNode）。
 * 深拷贝解耦语义：工厂只产出空白默认值，由调用方把模板数据复制进来（§4.2.1）。
 */
export declare function newRoleNode(kind: 'parent' | 'agent', label: string, position?: {
    x: number;
    y: number;
}): RoleNode;
/**
 * 新建文件节点（text 或受管 file，§4.2.4.1）。
 * label 为节点名称（卡片设计必填字段）。
 */
export declare function newFileNode(fileKind: 'text' | 'file', label: string, position?: {
    x: number;
    y: number;
}): FileNode;
/**
 * 新建数据库节点（§4.2.4.2）。
 * label 为名称、description 为描述（卡片设计必填字段）。
 */
export declare function newDatabaseNode(dbType: 'local' | 'server', label: string, position?: {
    x: number;
    y: number;
}): DatabaseNode;
/** 新建阶段节点（start/end/pause；label 由模式决定，硬编码锁定，§4.2.5.1）。 */
export declare function newStageNode(kind: 'start' | 'end' | 'pause', mode: WorkflowMode, position?: {
    x: number;
    y: number;
}): StageNode;
/** 阶段节点硬编码名称（§4.2.5.1 卡片设计表：启动/输入、结束/输出、暂停）。 */
export declare function stageLabel(kind: 'start' | 'end' | 'pause', mode: WorkflowMode): string;
/** 新建协作组节点（§4.2.5.2）。 */
export declare function newGroupNode(label: string, position?: {
    x: number;
    y: number;
}): GroupNode;
/** 新建虚拟节点：引用主节点 id，不携带独立配置（§4.2.3.2 规则 4/7）。 */
export declare function newProxyNode(sourceId: string, position?: {
    x: number;
    y: number;
}): ProxyNode;
/** 新建连线（无条件的默认流程线；type 由 condition 派生，§4.3 规则 1）。 */
export declare function newLine(source: string, target: string, sourceHandle: Handle, targetHandle: Handle, condition?: Line['condition']): Line;
/** 显式启动节点：kind='start' 的节点即流程入口（§4.2.5.1；架构文档 §4.2 入口解析）。 */
export declare function entryNodes(flow: Partial<WorkflowDocument>): GraphNode[];
/** 某节点的 flow-out 出边列表（用于下游推进/条件分支，§4.3）。 */
export declare function flowOutEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/** 某节点的 flow-in 入边列表（上游流程来源）。 */
export declare function flowInEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/** 某连线是否为流程线（流程出 → 流程入；ctx/db 连线不参与编排调度，§4.3 连线类型规范）。 */
export declare function isFlowLine(line: Line): boolean;
/**
 * 节点是否参与流程拓扑（作为任一流程线的源或目标；ctx/db 连线不计）。
 * 虚拟节点（proxy）的流程线归属其主角色节点：主节点自身或其任一虚拟节点参与
 * 流程线即视为该角色参与流程（用户批注：无流程连接的 agent 为「不执行任务的
 * 无关节点」——不进入编排清单，也不作为「可执行单元」的判定依据）。
 */
export declare function nodeParticipatesInFlow(flow: Partial<WorkflowDocument>, nodeId: string): boolean;
/**
 * 节点是否被流程线**驱动**（存在 flow-in 入边，或其任一虚拟节点存在 flow-in 入边）。
 * 与「参与流程」的区别：仅有 flow-out 而无 flow-in 的节点不会被上游激活——
 * 父代理「被流程线连接」的判定以驱动（flow-in）为准，与编排运行时
 * （prepareParentExecutor/parentExecutorOf）语义保持一致。
 */
export declare function nodeHasFlowIn(flow: Partial<WorkflowDocument>, nodeId: string): boolean;
/** 某节点的 ctx-in 入边列表（上游上下文来源，§4.2.3.2 规则 5 显式连线）。 */
export declare function ctxInEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/** 某节点的 db-in 入边列表（数据库服务标识来源；有边才注入 wf_db_query，§4.4.3 规则 5）。 */
export declare function dbInEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/** 某节点经 ctx 连线收到的上游来源节点 id 列表（去重，供任务块组装注入上游产出）。 */
export declare function upstreamCtxNodeIds(flow: Partial<WorkflowDocument>, nodeId: string): string[];
/** 某节点 flow-out 直接下游节点 id 列表（含条件连线，供父代理按拓扑推进）。 */
export declare function downstreamFlowNodeIds(flow: Partial<WorkflowDocument>, nodeId: string): string[];
/** 按 id 取节点；不存在返回 undefined。 */
export declare function nodeById(flow: Partial<WorkflowDocument>, nodeId: string): GraphNode | undefined;
/** 按 id 取连线。 */
export declare function lineById(flow: Partial<WorkflowDocument>, lineId: string): Line | undefined;
/** 某主节点的全部虚拟节点（§4.2.3.2 规则 4：复制按钮生成）。 */
export declare function proxiesOf(flow: Partial<WorkflowDocument>, nodeId: string): GraphNode[];
/** 某协作组的成员节点 id 列表。 */
export declare function groupMemberIds(flow: Partial<WorkflowDocument>, groupId: string): string[];
/** 某角色节点所属协作组 id（不在组内返回 null）。 */
export declare function memberGroupId(flow: Partial<WorkflowDocument>, nodeId: string): string | null;
/** 判断角色节点是否为协作组成员（§4.2.5.2 规则 4：组内成员仅 ctx/db 连接点）。 */
export declare function isGroupMember(flow: Partial<WorkflowDocument>, nodeId: string): boolean;

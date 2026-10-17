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
 *   - Team（group）：左入 流程入，右出 流程出；Team 卡片不提供 ctx/db 连接点（§4.2.5.2）
 *   - 虚拟节点（proxy）：与主节点（角色）一致——运行时解析为主节点共享执行实例（§4.2.3.2 规则 7）
 *
 * 模式差异（mode1/mode2）不在此矩阵体现，由 validate.ts 按 flow.mode 做额外约束
 * （如 mode1 的 start 禁用 ctx-out、mode2 的 end 启用 ctx-in）。
 *
 * 技术债（ctx-out 停用）：角色节点（parent/agent/proxy）的 ctx-out 已不再是注入来源——
 * 上游产出改由流程线自动注入下游（见 autoContextSourceIds）。该连接点**暂予保留**，
 * 连线仍然合法（结构校验不变、旧图零迁移），但连上不再产生任何注入效果；
 * 未来若需要「手动指定注入内容」可在此扩展。检索标记：`技术债（ctx-out 停用）`。
 */
export declare const NODE_HANDLES: Record<NodeKind, NodeHandleDef>;
/**
 * 通道名（三通道互斥，§4.3 连线类型规范）。
 * 用于按通道（而非按连接点字面量）表达判定：下游规则查「这条线走哪个通道」，
 * 不必知道连接点叫什么。
 */
export type HandleChannel = 'flow' | 'ctx' | 'db';
/**
 * 通道本体：三条通道各自的出/入连接点名（**唯一来源**）。
 *
 * 为什么收敛在此：通道判定此前散落为 `line.targetHandle === 'ctx-in'` 之类的裸字面量，
 * 与 HANDLE_PAIRING 构成**两套口径**——任一处改名/新增通道都必然漏改。现在全模块
 * （配对矩阵、结构校验、质量检查、拓扑查询）只允许引用本表，裸字面量只出现在这里。
 */
export declare const HANDLE_CHANNELS: {
    readonly flow: {
        readonly out: "flow-out";
        readonly in: "flow-in";
    };
    readonly ctx: {
        readonly out: "ctx-out";
        readonly in: "ctx-in";
    };
    readonly db: {
        readonly out: "db-out";
        readonly in: "db-in";
    };
};
/** 某通道的输入连接点。 */
export declare function channelIn(channel: HandleChannel): Handle;
/** 某通道的输出连接点。 */
export declare function channelOut(channel: HandleChannel): Handle;
/** 连接点 → 所属通道（输出侧查询；未登记返回 null）。 */
export declare function channelOfOut(handle: Handle): HandleChannel | null;
/** 连接点 → 所属通道（输入侧查询；未登记返回 null）。 */
export declare function channelOfIn(handle: Handle): HandleChannel | null;
/**
 * 输出连接点 → 允许的输入连接点映射（三通道互斥，§4.3 连线类型规范）。
 *
 * 键值全部取自 HANDLE_CHANNELS：本矩阵是通道本体的投影，不是第二份口径。
 * 查询契约：**只以输出连接点为源**（所有连线都是 out → in），故入点三键是恒等占位，
 * 仅为 `Record<Handle, Handle>` 的类型完整性存在，永不作为查询键。
 */
export declare const HANDLE_PAIRING: Record<Handle, Handle>;
/**
 * 配对查询的单一入口（validate 与 wf_graph_patch 共用，避免各自散落 `HANDLE_PAIRING[…]`）。
 * 未登记的源连接点回退为其自身：让调用方按「通道不匹配」报错，而不是抛类型错误。
 */
export declare function pairingTargetOf(sourceHandle: Handle): Handle;
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
 *
 * 输出契约默认文本直接落盘（不靠读取期兜底）：界面显示、运行期注入与磁盘存的是同一个值。
 * 父代理不参与节点交接（产出由编排器按需转述），故它不落默认契约。
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
/** 新建 Team 节点（§4.2.5.2）。 */
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
/** 某节点的流程出边列表（用于下游推进/条件分支，§4.3；仅完整通道配对的流程线）。 */
export declare function flowOutEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/** 某节点的流程入边列表（上游流程来源；仅完整通道配对的流程线）。 */
export declare function flowInEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/**
 * 节点是否参与流程拓扑（作为任一流程线的源或目标；ctx/db 连线不计）。
 * 虚拟节点（proxy）的流程线归属其主角色节点：主节点自身或其任一虚拟节点参与
 * 流程线即视为该角色参与流程（用户批注：无流程连接的 agent 为「不执行任务的
 * 无关节点」——不进入编排清单，也不作为「可执行单元」的判定依据）。
 */
export declare function nodeParticipatesInFlow(flow: Partial<WorkflowDocument>, nodeId: string): boolean;
/**
 * 节点是否被流程线**驱动**（存在流程入边，或其任一虚拟节点存在流程入边）。
 * 与「参与流程」的区别：仅有流程出而无流程入的节点不会被上游激活——
 * 父代理「被流程线连接」的判定以驱动（流程入）为准，与编排运行时
 * （prepareParentExecutor/parentExecutorOf）语义保持一致。
 * 入边判定复用 isFlowLine（两端通道配对）：只看目标侧 handle 会把「上下文出 → 流程入」
 * 这类幽灵线算成驱动，与流程子图口径分裂——本函数与 isFlowLine 同源。
 */
export declare function nodeHasFlowIn(flow: Partial<WorkflowDocument>, nodeId: string): boolean;
/**
 * 某节点的 ctx-in 入边列表。
 * 现状（技术债（ctx-out 停用））：角色节点的 ctx 出线已不再是注入来源，该查询只剩
 * file 数据源节点这一真实消费方——调用方必须按来源 kind 过滤，不得再把角色来源当上下文。
 */
export declare function ctxInEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
/** 某节点的 db-in 入边列表（数据库服务标识来源；有边才注入 wf_db_query，§4.4.3 规则 5）。 */
export declare function dbInEdges(flow: Partial<WorkflowDocument>, nodeId: string): Line[];
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
export declare function autoContextSourceIds(flow: Partial<WorkflowDocument>, nodeId: string): string[];
/** 某节点 flow-out 直接下游节点 id 列表（含条件连线，供父代理按拓扑推进）。 */
export declare function downstreamFlowNodeIds(flow: Partial<WorkflowDocument>, nodeId: string): string[];
/** 按 id 取节点；不存在返回 undefined。 */
export declare function nodeById(flow: Partial<WorkflowDocument>, nodeId: string): GraphNode | undefined;
/** 按 id 取连线。 */
export declare function lineById(flow: Partial<WorkflowDocument>, lineId: string): Line | undefined;
/** 某主节点的全部虚拟节点（§4.2.3.2 规则 4：复制按钮生成）。 */
export declare function proxiesOf(flow: Partial<WorkflowDocument>, nodeId: string): GraphNode[];
/** 某角色节点所属 Team id（不在组内返回 null）。 */
export declare function memberGroupId(flow: Partial<WorkflowDocument>, nodeId: string): string | null;
/** 判断角色节点是否为 Team 成员（§4.2.5.2 规则 4：组内成员仅 ctx/db 连接点）。 */
export declare function isGroupMember(flow: Partial<WorkflowDocument>, nodeId: string): boolean;

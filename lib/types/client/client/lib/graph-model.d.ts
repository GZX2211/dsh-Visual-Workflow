import type { GraphNode, Line, NodeKind, WorkflowDocument } from '../../host/shared/graph-model.js';
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate, RunSnapshot } from '../../host/shared/types.js';
type HandleSpec = {
    inputs: string[];
    outputs: string[];
};
export declare const HANDLES: Record<string, HandleSpec>;
/** 阶段节点显示名（模式一：启动/结束；模式二：输入/输出，需求 §4.2.5.1）。 */
export declare function stageLabels(mode: string): {
    start: string;
    end: string;
    pause: string;
};
/** 阶段节点固定卡片（模式二没有暂停，需求 §4.2.5.1 规则 1/2）。 */
export declare function stageTemplateKinds(mode: string): Array<{
    kind: NodeKind;
    label: string;
}>;
export declare function defaultOutputHandle(kind: string): string;
export declare function defaultInputHandle(kind: string): string;
/** 画布节点 = 存储节点（节点 JSON 即事实源）+ 视图补充字段。 */
export type CanvasNode = GraphNode;
/** 画布连线 = 存储连线 + 视图补充（颜色 class / 显示标签）。 */
export type CanvasLine = Line & {
    lineType: string;
    label: string;
};
/** 条件连线标签（需求 §4.3 连线类型表）。 */
export declare function conditionLabel(condition: Line['condition'] | null | undefined): string;
/** 连线颜色 class（flow 默认 / ctx / db / 条件 pass|fail|content）。 */
export declare function lineColorClass(line: Line): string;
export type TemplateKind = 'role' | 'file' | 'database';
export type TemplateMap = Map<string, RoleTemplate | FileTemplate | DatabaseTemplate>;
/** 模板映射：{ role: Map, file: Map, database: Map }（id → 模板）。 */
export declare function templatesToMaps(roleTemplates: RoleTemplate[] | null | undefined, fileTemplates: FileTemplate[] | null | undefined, databaseTemplates: DatabaseTemplate[] | null | undefined): Record<TemplateKind, TemplateMap>;
/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
 *  kind 限定 role/file/database；传入 GroupTemplate 时按 None 处理（协作组模板走
 *  placeGroupFromTemplate，不进本函数）。 */
export declare function templateToNodeData(kind: 'role' | 'file' | 'database', template: RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate | null | undefined): Record<string, unknown> | null;
/** 画布节点 kind 统一读取（顶层 kind 优先，兼容 data.kind 历史数据）。 */
export declare function nodeKindOf(node: GraphNode | {
    kind?: string;
    data?: {
        kind?: string;
    };
} | null | undefined): string;
/** flow → 画布连线（line 条件对象 → 显示标签/颜色）。 */
export declare function flowToCanvasLines(lines: Line[] | null | undefined): CanvasLine[];
/**
 * 序列化写回：画布节点 → 存储节点（剔除视图字段；虚拟节点只保留 proxySourceId；
 * 阶段节点只保留 label 硬编码；组节点保留 memberIds/size）。
 */
export declare function serializeFlow(currentFlow: WorkflowDocument, nodes: CanvasNode[], lines: CanvasLine[]): WorkflowDocument;
/** 画布节点 kind → 模板 kind（parent/agent → role；proxy/stage/group 无模板）。 */
export declare function templateKindOfNode(nodeKind: string): TemplateKind | null;
export interface ConnectionProblem {
    valid: boolean;
    code: string;
    branch?: string;
}
/** 连接校验：在画布上建立一条连线（sourceHandle → targetHandle）。 */
export declare function connectionProblem(nodes: CanvasNode[], lines: CanvasLine[], connection: {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    lineId?: string;
}): ConnectionProblem;
export declare function connectionProblemMessage(problem: ConnectionProblem, copy: Record<string, string>): string;
export declare function graphSnapshot(nodes: CanvasNode[], lines: CanvasLine[]): {
    nodes: CanvasNode[];
    lines: CanvasLine[];
};
/** 布局输入的最小结构（仅依赖 id 与 position，兼容各类节点投影）。 */
export interface LayoutNodeLike {
    id: string;
    position: {
        x: number;
        y: number;
    };
}
/** 层次布局：按 flow 边拓扑排序分列排布（照搬旧项目 layoutNodes；泛型保留节点形状）。 */
export declare function layoutNodes<T extends LayoutNodeLike>(nodes: T[], lines: CanvasLine[]): T[];
/** 布局原语：可传边缘筛选函数。 */
export declare function layoutGraph<T extends LayoutNodeLike>(nodes: T[], lines: CanvasLine[], channelFilter: (line: Line) => boolean): T[];
/** 运行快照 → 节点状态映射（画布回显用）。 */
export declare function runStatusMap(snapshot: RunSnapshot | null | undefined): Record<string, {
    status: string;
    attempts: number;
    outputSummary: string;
}>;
/** 运行中节点 id 列表（需求 §4.5.8「当前运行节点高亮」；画布高亮数据源，防回环只写视图）。 */
export declare function runningNodeIds(snapshot: RunSnapshot | null | undefined): string[];
/**
 * 合并重复节点（修复历史数据中协作组节点被重复追加的缺陷）：
 *  - 同 id 的协作组节点合并为一个，memberIds 取**并集**（不丢任何成员），其余字段保留后出现者；
 *  - 每个协作组节点的 memberIds **一律去重**（即便单组内出现重复 id，也会被清理）。
 * 非协作组节点同 id 直接保留最后出现者。返回合并后的新数组。
 */
export declare function consolidateGroups<T extends {
    id: string;
    data: Record<string, unknown>;
}>(nodes: T[]): T[];
/**
 * 原子入组：一次变更同时设置「成员节点 data.groupId」与「协作组 data.memberIds（追加去重）」。
 * 入组限定角色节点（parent/agent），返回新 nodes 数组；非角色/非组则原样返回。
 * 先把重复的协作组节点合并（并集），再在**唯一**的组上追加，杜绝「删 1 个移出多个 / 只显示一个」的不一致。
 * 供左栏模板拖入与画布内节点拖入两条路径共用。
 */
export declare function joinNodeToGroup<T extends {
    id: string;
    data: Record<string, unknown>;
}>(nodes: T[], nodeId: string, groupId: string): T[];
/**
 * 移除指定节点的流程连线（角色拖入协作组后仅保留上下文/数据库线，§4.2.5.2 规则 4）：
 * 组内成员只有上下文/数据库连接点，无流程接点；已连的流程线在入组时自动断开。
 */
export declare function dropNodeFlowLines<T extends {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}>(lines: T[], nodeId: string): T[];
export {};

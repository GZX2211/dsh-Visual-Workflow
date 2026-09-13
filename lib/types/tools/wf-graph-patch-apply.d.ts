import type { GraphNode, WorkflowDocument } from '../shared/graph-model.js';
import type { GraphPatchOp, GraphPatchResult, MarkPatchOp, MarkPatchResult } from './wf-graph-patch-types.js';
/**
 * 各图操作的「最小字段契约」（**单一事实源**）。
 *
 * 为什么放在这里而不是只写进工具描述（2026-09 实机取证）：
 *   模型写补丁时唯一能看到的事实源是工具 Schema，而 ops 是 `additionalProperties:true`
 *   的自由对象——描述里只举 create_node 一例时，模型对 connect 的端点字段只能猜
 *   （实测猜成 from/to，报「源节点不存在「」」）。契约文本同时供两处消费：
 *     ① wf_graph_patch 的 ops 描述（可发现性）；② 参数层错误消息（自我修正通道）。
 *   两处共用一份常量，避免文档与实现再次漂移。
 */
export declare const OP_FIELD_SHAPES: Record<string, string>;
/** 深拷贝文档骨架（保持元数据字段；节点/连线走 JSON 深拷贝避免共享引用）。 */
export declare function cloneDoc(doc: WorkflowDocument): WorkflowDocument;
/**
 * 协作组一致性：成员节点的 groupId 与组的 memberIds 双向对齐。
 * 入组：写 node.data.groupId；出组：置 null。组不存在或成员不存在 → 稳定错误。
 */
export declare function ensureGroupConsistency(nodes: GraphNode[], groupId: string, memberIds: string[]): GraphNode[];
/**
 * 应用 A 组图结构操作（按序，纯函数）。
 * 失败一律抛 WfError（稳定 code），调用方据此返回带修复建议的补丁错误。
 */
export declare function applyGraphOps(input: {
    doc: WorkflowDocument;
    ops: GraphPatchOp[];
}): GraphPatchResult;
/**
 * 运行状态标记（C 组）纯函数：校验节点存在 + 闸门预算，给出标记结果。
 * 状态机分工（P3）：**「必须是当前闸门轮 / 当前闸门节点」由 runMarkGroup 判定**
 * （需要入口 entry 与解析后的画布），本函数只负责与单据无关的校验——
 * status 取值、节点是否在快照内、以及 status=ok 时的闸门预算（D-21：不含首次编排）。
 */
export declare function applyMarkOp(input: {
    op: MarkPatchOp;
    runId: string;
    nodeIds: string[];
    /** 已用闸门次数（P3 预算判定用；本轮由宿主缝给出 0）。 */
    milestoneUsed?: number;
    /** 元参数闸门上限（0 = 不限制）。 */
    milestoneMax?: number;
}): MarkPatchResult;

import type { GraphNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
import { WfError } from './errors.js';
/**
 * 生成某节点的数据库工具说明。
 * - 存在 db-in 连线时，返回包含所连数据节点 id 与 label 的提示——子代理必须把该 id
 *   作为 wf_db_query 的 dataId 传入（BUG 修复：此前提示未携带 id，子代理无法定位数据源，
 *   只能用猜测的 id → WF_DB_BAD_DATA）。
 * - 无 db-in 连线时返回空串（工具白名单也不注入 wf_db_query）。
 * 纯函数：输入同则输出同，不读时钟/随机源。
 */
export declare function dbToolHintOf(flow: WorkflowDocument, nodeId: string): string;
/** 节点人类可读名称（提示语与错误消息用）。 */
export declare function labelOf(node: GraphNode): string;
/** 流程中的暂停节点 id 清单（编排指令与节点任务块动态态共用）。 */
export declare function pauseNodeIdsOf(flow: WorkflowDocument): string[];
/**
 * 编排指令 facts 的节点清单（仅可执行且参与流程的 agent 节点；父代理即编排者本人不列）。
 * 「参与流程」判定：节点自身或其虚拟节点作为任一流程线（flow-out/flow-in）的源/目标；
 * 未参与流程的 agent 节点 = 用户批注的「不执行任务的无关节点」，不进入清单。
 * 协作组是包裹层（无执行，只注入协作协议），proxy 镜像主节点 agent id 相同，
 * 阶段/文件/数据库均非可执行节点——一律不列入待编排节点（用户批注，图3）。
 * 协作组并行说明见 collabGroupList（单独成段，不并入节点清单）。
 */
export declare function orchestrationNodeList(flow: WorkflowDocument): Array<{
    id: string;
    label: string;
}>;
/** 编排指令 facts 的协作组说明（组内成员并行启动提示；仅列参与流程的协作组卡片）。 */
export declare function collabGroupList(flow: WorkflowDocument): Array<{
    groupId: string;
    label: string;
    memberIds: string[];
}>;
/** 读取某角色节点所属协作组的协作 Prompt（组卡片 data.collabPrompt；非组内成员返回空串）。 */
export declare function collabPromptOf(flow: WorkflowDocument, nodeId: string): string;
/**
 * 构建某角色节点的协作成员清单块（追加到其首条用户消息）。
 * 始终列出本组全部成员（id + 角色名，告知协作对象与可发消息对象），再追加自定义协作说明。
 * 非组内成员返回空串（不注入）。
 */
export declare function collabBlockOf(flow: WorkflowDocument, nodeId: string): string;
/** 运行前完整性检查：缺失的启动/结束节点（按模式渲染中文名）。 */
export declare function missingStageLabels(flow: WorkflowDocument): string[];
/** 运行前校验（防御：保存时已校验，此处拦截非法快照）。 */
export declare function validateFlowForRun(flow: WorkflowDocument): WfError | null;
/**
 * 节点执行上下文组装（纯函数）：上游产出 / 文件路径索引 / 数据库工具说明。
 * buildNodeBlocks（子代理任务块）与 prepareParentExecutor（父代理执行单元）共用，
 * 保证同一节点的上下文注入完全一致。
 */
export declare function buildNodeContextFacts(input: {
    flow: WorkflowDocument;
    node: RoleNode;
    /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
    snapshot: RunSnapshot;
    documentTextLimit: number;
}): {
    upstreamContext: Array<{
        source: string;
        content: string;
    }>;
    filePaths: string[];
    dbToolHint: string;
};

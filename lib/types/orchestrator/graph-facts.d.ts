import { type CommTarget } from '../prompts/index.js';
import type { GraphNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
import { WfError } from './errors.js';
/**
 * 生成某节点的数据库工具说明（正文见 prompts/texts/rule-db-tool.ts）。
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
 * 参与流程的可调度 agent 节点清单（catalog 的 `schedulable` 与编排调度口径的等价参照）。
 *
 * 编排指令**不再内联节点清单**：拓扑只经 wf_org_catalog 的 instance 通道召回，父代理自行读取
 * 每个节点的 schedulable 标记。本函数保留为「可调度单元」这一口径的唯一可测表达。
 * 「参与流程」判定：节点自身或其虚拟节点作为任一流程线（flow-out/flow-in）的源/目标；
 * 未参与流程的 agent 节点 = 用户批注的「不执行任务的无关节点」，不进入清单。
 * Team 卡片是包裹层（不是执行主体），proxy 镜像主节点 agent id 相同，
 * 阶段/文件/数据库均非可执行节点——一律不列入。
 */
export declare function orchestrationNodeList(flow: WorkflowDocument): Array<{
    id: string;
    label: string;
}>;
/**
 * 编排指令 facts 的 Team 说明（Team 卡片 + 成员节点 id；仅列参与流程的 Team 卡片）。
 * Team 卡片只标出团队的执行位置，父代理按此逐个调度其成员节点（Team 卡片本身不可作为调度目标）。
 */
export declare function collabGroupList(flow: WorkflowDocument): Array<{
    groupId: string;
    label: string;
    memberIds: string[];
}>;
/** 读取某角色节点所属 Team 的协作 Prompt（Team 卡片 data.collabPrompt；非组内成员返回空串）。 */
export declare function collabPromptOf(flow: WorkflowDocument, nodeId: string): string;
/**
 * 某节点的可通信对象清单（注入子代理任务块的「可通信对象」段）。
 *
 * 组成（用户裁决 2026-10）：父代理固定别名 + 本组其他成员节点；非组内成员只有父代理。
 * 上下游节点的 id 不进本清单——可通信面只由组关系决定，不由数据流决定。
 * 不列节点自身：wf_send_message 拒绝自投，列出只会误导模型。
 */
export declare function commTargetsOf(flow: WorkflowDocument, nodeId: string): CommTarget[];
/** 运行前完整性检查：缺失的启动/结束节点（按模式渲染中文名）。 */
export declare function missingStageLabels(flow: WorkflowDocument): string[];
/** 运行前校验（防御：保存时已校验，此处拦截非法快照）。 */
export declare function validateFlowForRun(flow: WorkflowDocument): WfError | null;
/**
 * 节点执行上下文组装（纯函数）：上游产出 / 文件路径索引 / 数据库工具说明。
 * buildNodeBlocks（子代理任务块）与 prepareParentExecutor（父代理执行单元）共用，
 * 保证同一节点的上下文注入完全一致。
 *
 * 上游来源有两条（用户裁决 2026-10）：
 *   - 数据源：file 节点经 ctx 出线注入的文本（截断直通）或受管文件路径索引——
 *     file 无流程线，只能靠手动连线，故该通道保留；
 *   - 流程前驱产出：全链路自动注入（autoContextSourceIds），无需手动连线。
 * 角色节点之间的旧 ctx 交接线已停用（静默忽略）；Team 与上下游解耦，不参与注入。
 */
export declare function buildNodeContextFacts(input: {
    flow: WorkflowDocument;
    node: RoleNode;
    /** 运行快照：上游角色节点最终产出（自动注入）的读取源。 */
    snapshot: RunSnapshot;
    documentTextLimit: number;
}): {
    upstreamContext: Array<{
        nodeId: string;
        source: string;
        content: string;
    }>;
    filePaths: string[];
    dbToolHint: string;
};

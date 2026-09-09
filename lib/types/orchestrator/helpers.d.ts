import type { OrchestrationDirectiveParams, ParentPromptVariant } from '../prompts/orchestration.js';
import { type ExecutorContextFacts } from '../prompts/executor.js';
import type { GraphNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
import type { RunNodeArgs } from './run-types.js';
import { WfError } from './seams.js';
/**
 * 生成某节点的数据库工具说明。
 * - 存在 db-in 连线时，返回包含所连数据节点 id 与 label 的提示——子代理必须把该 id
 *   作为 wf_db_query 的 dataId 传入（BUG 修复：此前提示未携带 id，子代理无法定位数据源，
 *   只能用猜测的 id → WF_DB_BAD_DATA）。
 * - 无 db-in 连线时返回空串（工具白名单也不注入 wf_db_query）。
 * 纯函数：输入同则输出同，不读时钟/随机源。
 */
export declare function dbToolHintOf(flow: WorkflowDocument, nodeId: string): string;
/** 错误消息提取（Error 或任意值）。 */
export declare function messageOf(error: unknown): string;
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
/** 节点任务块组装：角色任务上下文 + 输入输出结构 + 软约束 + 执行与交付约定。 */
export declare function buildNodeBlocks(input: {
    flow: WorkflowDocument;
    node: RoleNode;
    /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
    snapshot: RunSnapshot;
    documentTextLimit: number;
    /** 系统语言名（从 DSH 用户设置读取；注入「回复/注释/思考必须使用该语言」规则）。 */
    systemLanguage: string;
}): Array<{
    type: 'text';
    text: string;
}>;
/**
 * 父代理提示词变体判定（三情况，纯函数）：
 *   - orchestrator：纯编排——无父代理节点，或父代理（含其虚拟节点）未被流程线驱动
 *     （无 flow-in 入边）；
 *   - hybrid：编排 + 自执行——父代理被流程线驱动，且画布中**还存在其他参与流程的
 *     可执行单元**（agent 角色或其虚拟节点、协作组卡片任一参与流程线）；
 *   - executor：纯执行——父代理是唯一参与流程的可执行单元；画布上允许存在未参与
 *     流程的无关 agent/协作组节点（不执行任务，不进入编排清单）。
 */
export declare function parentPromptVariantOf(flow: WorkflowDocument): ParentPromptVariant;
/**
 * 父代理是否为执行者模式：父代理（或其虚拟节点）被流程线连接，作为执行单元
 * 先执行自身任务再视情况继续调度。判定结果与 parentPromptVariantOf 一致：
 * 返回 null = 纯编排（orchestrator），否则返回父代理节点身份。
 */
export declare function parentExecutorOf(flow: WorkflowDocument): {
    nodeId: string;
    nodeLabel: string;
} | null;
/** 编排指令参数组装（facts 静态事实 + dynamic 末段动态态，前缀稳定）。 */
export declare function directiveParams(flow: WorkflowDocument, defPath: string, mode: 'mode1' | 'mode2', extra?: {
    /** 断点继续事实（resumeRun 用）。 */
    resume?: {
        resumeFromNodeId?: string;
        resumedFromRunId: string;
    };
    /** 模式二用户问题（不稳定内容，仅末段）。 */
    question?: string;
    /** 情况2（hybrid）：父代理执行单元身份（父代理被流程线连接；静态）。 */
    parentNode?: {
        nodeId: string;
        nodeLabel: string;
    };
    /** 情况2：父代理自执行单元任务块（buildParentTaskSpec 输出；动态值仅末段）。 */
    parentTaskBlock?: string;
    /** 系统语言名（从 DSH 用户设置读取；注入语言规则）。 */
    systemLanguage?: string;
}): OrchestrationDirectiveParams;
/**
 * 父代理运行提示词统一组装（startRun/resumeRun 共用；三情况整体替换组装）：
 *   - orchestrator（情况1）：buildOrchestratorPrompt，纯编排；
 *   - hybrid（情况2）：buildHybridPrompt，编排指令 + 末段【你的节点任务】执行单元任务块；
 *   - executor（情况3）：buildParentExecutorPrompt，纯执行提示（无任何编排要素）；
 *   - 续跑继承边界：hybrid/executor 但父代理执行单元已 ok（断点继承完成、无任务块）
 *     时按 orchestrator 变体组装（剩余运行只有编排/收尾，不再含自执行任务内容），
 *     避免提示词出现「先执行自身节点任务」但无任务可执行的自相矛盾。
 * 纯函数：入参（flow/defPath/mode/executor/动态）不变则输出字节不变。
 */
export declare function buildParentRunPrompt(input: {
    flow: WorkflowDocument;
    defPath: string;
    mode: 'mode1' | 'mode2';
    /** 模式二用户问题（不稳定内容，仅末段）。 */
    question?: string;
    /** 断点继续事实（resumeRun 用）。 */
    resume?: {
        resumeFromNodeId?: string;
        resumedFromRunId: string;
    };
    /** 父代理执行单元（具体情况2/3）；纯编排或续跑继承完成时为 null。 */
    executor: {
        nodeId: string;
        nodeLabel: string;
        task: ExecutorContextFacts;
        runContextText: string;
    } | null;
    /** 系统语言名（从 DSH 用户设置读取；注入语言规则）。 */
    systemLanguage: string;
}): string;
/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
export declare function effectiveRetryLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number;
/** 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认。 */
export declare function effectiveReactLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number | undefined;
/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
export declare function effectiveThinkingOf(node: RoleNode, args: RunNodeArgs): string | undefined;

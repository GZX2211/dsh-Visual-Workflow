import { type CollabChannel, type ExecutorContextFacts, type OrchestrationDirectiveParams, type ParentPromptVariant } from '../prompts/index.js';
import type { WorkflowDocument } from '../shared/graph-model.js';
/**
 * 父代理提示词变体判定（三情况，纯函数）：
 *   - orchestrator：纯编排——无父代理节点，或父代理（含其虚拟节点）未被流程线驱动
 *     （无 flow-in 入边）；
 *   - hybrid：编排 + 自执行——父代理被流程线驱动，且画布中**还存在其他成员执行主体**
 *     （参与流程的 agent 角色或其虚拟节点，或属于某个 Team 的成员节点）；
 *   - executor：纯执行——父代理是唯一执行主体；画布上允许存在未参与流程、也不属于任何 Team
 *     的无关 agent 节点（不执行任务，不进入编排清单）。
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
export declare function directiveParams(flow: WorkflowDocument, mode: 'mode1' | 'mode2', extra?: {
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
    /** 协作通道（官方 Agent Team 可用性；决定 Team 段文案与启动方式）。 */
    collabChannel?: CollabChannel;
}): OrchestrationDirectiveParams;
/**
 * 父代理运行提示词统一组装（startRun/resumeRun 共用；三情况整体替换组装）：
 *   - orchestrator（情况1）：buildOrchestratorPrompt，纯编排；
 *   - hybrid（情况2）：buildHybridPrompt，编排指令 + 末段【你的节点任务】执行单元任务块；
 *   - executor（情况3）：buildParentExecutorPrompt，纯执行提示（无任何编排要素）；
 *   - 续跑继承边界：hybrid/executor 但父代理执行单元已 ok（断点继承完成、无任务块）
 *     时按 orchestrator 变体组装（剩余运行只有编排/收尾，不再含自执行任务内容），
 *     避免提示词出现「先执行自身节点任务」但无任务可执行的自相矛盾。
 * 纯函数：入参（flow/mode/executor/动态）不变则输出字节不变。
 */
export declare function buildParentRunPrompt(input: {
    flow: WorkflowDocument;
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
    /** 协作通道（官方 Agent Team 可用性；决定 Team 段文案与启动方式）。 */
    collabChannel?: CollabChannel;
}): string;

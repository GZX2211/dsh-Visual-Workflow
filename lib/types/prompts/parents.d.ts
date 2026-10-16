import type { CollabChannel } from './child.js';
/** 父代理提示词变体（三情况组装分发）：orchestrator=纯编排 / hybrid=编排+自执行 / executor=纯执行。 */
export type ParentPromptVariant = 'orchestrator' | 'hybrid' | 'executor';
/**
 * 编排系模板（情况1/2）的入参。
 * `facts` 是同一 run 内字节稳定的静态事实；`dynamic` 是运行期动态状态。
 */
export interface OrchestrationDirectiveParams {
    facts: {
        /** 工作流名称（人类可读标题）。 */
        workflowName: string;
        /** 工作流目标描述；可为空字符串。 */
        workflowGoal: string;
        /** Team 卡片与成员清单（画布含 Team 卡片时组装该段；空数组 = 不组装该段）。 */
        collabGroups: Array<{
            groupId: string;
            label: string;
            memberIds: string[];
        }>;
        /** 协作通道：official = 官方 Agent Team 可用；legacy = 成员降级为普通子代理。缺省 legacy。 */
        collabChannel?: CollabChannel;
        /** 情况2（hybrid）：父代理自身执行单元身份；情况1 缺省 null。 */
        parentNode?: {
            nodeId: string;
            nodeLabel: string;
        } | null;
        /** 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。 */
        systemLanguage: string;
    };
    /** 运行期动态状态（缺省即「全新运行，无断点、无暂停、无额外运行参数」）。 */
    dynamic: {
        /** 断点继续标记：true 表示本次为恢复运行。 */
        isResume?: boolean;
        /** 断点恢复时待继续的起始节点 id。 */
        resumeFromNodeId?: string;
        /** 继承链来源 run id。 */
        resumedFromRunId?: string;
        /** 暂停节点 id 清单。 */
        pauseNodeIds?: string[];
        /** 本次运行的额外运行参数说明文本。 */
        runParamsText?: string;
        /** 模式二本次外部请求的用户问题。 */
        question?: string;
        /** 情况2：父代理自执行单元任务块（buildParentTaskSpec 输出）。 */
        parentTaskBlock?: string;
    };
}
/** 执行单元共用的过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）。 */
export interface ExecutorContextFacts {
    /** 节点人类可读名称。 */
    nodeLabel: string;
    /** 上游产出上下文（全链路自动注入；数组元素为「来源名称 + 来源节点 id + 内容」，可为空）。 */
    upstreamContext: Array<{
        nodeId: string;
        source: string;
        content: string;
    }>;
    /** 文件路径索引（data/files/ 受管路径），可为空。 */
    filePaths: string[];
    /** 数据库工具说明（db-in 连线存在时非空），可为空。 */
    dbToolHint: string;
    /** Team 成员标记：注入组内通信必须经 wf_ask_agent 的软约束。 */
    isGroupMember: boolean;
}
/** 情况2 父代理自执行单元任务块入参。 */
export interface ParentTaskSpecParams {
    facts: ExecutorContextFacts;
    /** 本次执行单元的运行上下文说明（runId、attempt 等；可为空）。 */
    runContextText?: string;
    /** 系统语言名（如 '中文' / 'English'）。 */
    systemLanguage: string;
}
/** 情况3 纯执行父代理提示词入参。 */
export interface ParentExecutorPromptParams {
    /** 工作流名称。 */
    workflowName: string;
    facts: ExecutorContextFacts;
    /** 本次执行的运行上下文说明（runId、attempt 等）。 */
    runContextText: string;
    /** 系统语言名（如 '中文' / 'English'）。 */
    systemLanguage: string;
}
/** 情况1（纯编排）父代理提示词构建器（纯函数）。 */
export declare function buildOrchestratorPrompt(params: OrchestrationDirectiveParams): string;
/** 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。 */
export declare function buildHybridPrompt(params: OrchestrationDirectiveParams): string;
/**
 * 情况2 父代理自执行单元任务块（编排指令末段小节正文；纯函数）。
 * 只列过程性信息与运行上下文，不含块级标题（避免与编排指令嵌套冲突）。
 */
export declare function buildParentTaskSpec(params: ParentTaskSpecParams): string;
/** 情况3 纯执行父代理提示词构建器（纯函数）。 */
export declare function buildParentExecutorPrompt(params: ParentExecutorPromptParams): string;

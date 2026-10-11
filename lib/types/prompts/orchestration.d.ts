import type { CollabChannel } from './collab.js';
/** 父代理提示词变体（三情况组装分发）：orchestrator=纯编排 / hybrid=编排+自执行 / executor=纯执行。 */
export type ParentPromptVariant = 'orchestrator' | 'hybrid' | 'executor';
/**
 * 编排系模板（情况1/2）的入参（中文注释每个字段）。
 * `facts` 是同一 run 内字节稳定的静态事实；`dynamic` 是仅注入末段的动态状态。
 */
export interface OrchestrationDirectiveParams {
    facts: {
        /** 工作流名称（人类可读标题，注入节点清单标题）。 */
        workflowName: string;
        /** 工作流目标描述；可为空字符串。 */
        workflowGoal: string;
        /** 流程事实源文件路径（父代理需 read 的只读 JSON 路径）。 */
        definitionPath: string;
        /** 节点清单：流程中参与流程的可调度 agent 节点（id + 人类可读名称）。 */
        nodes: Array<{
            id: string;
            label: string;
        }>;
        /** 协作组成员说明（画布含协作组时组装该段；空数组 = 不组装协作组段）。 */
        collabGroups: Array<{
            groupId: string;
            label: string;
            memberIds: string[];
        }>;
        /**
         * 协作通道（协作组段文案的分支依据）：
         *   - official = 官方 Agent Team 可用 → 指示父代理对协作组卡片调用 wf_run_node 启动官方团队；
         *   - legacy = 官方团队不可用 → 指示父代理逐个启动成员节点（既有语义）。
         * 缺省 legacy。
         */
        collabChannel?: CollabChannel;
        /** 情况2（hybrid）：父代理自身执行单元身份（被流程线连接）；情况1 缺省 null。 */
        parentNode?: {
            nodeId: string;
            nodeLabel: string;
        } | null;
        /** 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。注入语言规则。 */
        systemLanguage: string;
    };
    /**
     * 末段动态状态（不稳定内容，仅注入尾段，保证前中段前缀稳定）。
     * 全部字段可选：缺省即「全新运行，无断点、无暂停、无额外运行参数」。
     */
    dynamic: {
        /** 断点继续标记：true 表示本次为恢复运行（已 ok 节点不重跑，从 resumeFromNodeId 继续）。 */
        isResume?: boolean;
        /** 断点恢复时待继续的起始节点 id（isResume 为 true 时给出）。 */
        resumeFromNodeId?: string;
        resumeNodeIds?: string[];
        /** 继承链来源 run id（恢复运行上一跳记录；空为首次运行）。 */
        resumedFromRunId?: string;
        /** 暂停节点 id 清单：父代理对其中任一调用 wf_run_node（nodeId=暂停节点 id）即触发暂停门。 */
        pauseNodeIds?: string[];
        /** 本次运行的额外运行参数说明文本（如模式二 wait 阻塞调度）。 */
        runParamsText?: string;
        /** 模式二本次外部请求的用户问题（不稳定内容，仅末段注入；模式一无）。 */
        question?: string;
        /**
         * 「本次组织预算」末段文本（自主编排方案 §6.4；buildOrgBudgetText 输出）。
         * 取值口径 = 快照冻结元参数（D-13 第三层）+ 当前图规模 → **剩余量**；
         * 属动态值，只在末段注入（P2 正式接入，见 runtime-launch 的 startRun/resumeRun）。
         */
        orgBudgetText?: string;
        /** 情况2：父代理自执行单元任务块（buildParentTaskSpec 输出；本 run 内字节稳定）。 */
        parentTaskBlock?: string;
    };
}
/**
 * 编排系关键约束短语（首段与末段同时出现，供 W-02 双位测试断言与组装任务引用）。
 * 用中文面向模型（W-04）；工具名与工具 schema 描述保留英文（W-03）；措辞独立于动态值，避免前缀漂移。
 */
export declare const ORCH_HARD_CONSTRAINTS: {
    /** 父代理「仅调度不执行」核心短语（情况1 首段 + 末段重申双位）。 */
    readonly dispatchOnly: "仅编排：你只负责调度子代理，不亲自执行节点任务；不得自行搜索或处理未授权的节点输入";
    /**
     * 节点完成判定（双重汇报防治，一句话）：子代理主动 report ≠ 完成；
     * 只有 DSH 自动送达的结算通知才是节点完成的权威信号。
     */
    readonly nodeSettledSignal: "节点判定：收到结算通知（Background subagent … finished …）后，依据运行快照、声明产物和任务要求判断；请求输入或回复路径不等于成功。证据明确后执行合法工具动作：推进、有依据重试、等待未结算节点/外部事件、请求补充，或按完成条件收尾；不要无新证据、无工具动作地反复论证同一结论";
    readonly inputBindings: "输入由运行时绑定并在 wf_run_node 首次任务中交付；不使用原生 send_message 补充工作流输入，不使用 wf_graph_patch 保存临时运行数据。输入缺失时报告具体节点，通过宿主允许的用户交互或工作台绑定尚未派发节点；附件上传不等于输入绑定；WF_INPUT_REQUIRED 时仅以 Runtime 确认的绑定和 inputRevision 为依据，自然语言“已上传”不是新证据。WF_BUSY、WF_INPUT_STATE_CONFLICT、WF_INPUT_REVISION_CONFLICT 时按错误处理，不循环派发；不能热绑定则引导停止后配置输入并新建运行。不能猜路径或搜索文件。显式 ctx 优先，auto 仅交接唯一已结算上游，遇到歧义需明确绑定";
    readonly safeTermination: "达到有效重试上限不再调用同一节点，不以错误结果推进下游；有合法用户修复路径可请求干预，无法继续时调用 wf_finish(status=failed)，说明失败节点、原因和已完成节点。工具返回错误须如实处理，未获成功返回不能声称锁已释放；沙箱故障按真实原因报告，不绕过守卫或沙箱";
    /** 收尾协议：wf_finish 幂等收尾、释放锁。 */
    readonly finishIdempotent: "收尾时调用 wf_finish （只调用一次，幂等，释放运行锁）";
    /** 失败语义：节点失败需显式处置，不静默跳过。 */
    readonly failureSemantics: "绝不静默跳过失败节点；重试前核对真实结算、产物验证、未满足的任务要求、retryLimit 和新的修复依据；无新依据不原样重复派发，允许次数继续遵守既有 retryLimit";
    /** 条件连线语义：条件分支由父代理按上游实际产出语义判断。 */
    readonly conditionSemantics: "条件分支由你依据上游节点的实际产出进行语义判断";
    /** 情况2 执行者模式核心短语：你本人也是执行节点，先执行自身任务再调度。 */
    readonly executorRole: "执行+编排：你既是执行节点，也要负责调度子代理；你只执行指向自身的节点任务";
};
/** 续跑仅注入当前调度事实；图、角色与历史产出继续从稳定引用读取。 */
export declare function buildResumeOrchestrationPrompt(params: OrchestrationDirectiveParams): string;
/**
 * 情况1（纯编排）父代理提示词构建器（纯函数）。
 * 首段仅编排身份 + 完成判定信号 + 调度协议；不包含执行者模式条目。
 */
export declare function buildOrchestratorPrompt(params: OrchestrationDirectiveParams): string;
/**
 * 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。
 * 首段以执行者模式取代「仅编排」；末段重申含收尾与失败语义，
 * dynamic.parentTaskBlock 为父代理自执行单元任务块（buildParentTaskSpec 输出）。
 */
export declare function buildHybridPrompt(params: OrchestrationDirectiveParams): string;

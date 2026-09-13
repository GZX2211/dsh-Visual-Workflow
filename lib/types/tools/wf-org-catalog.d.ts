import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js';
/** 预算化上限（返回体 ≤8KB 的设计目标；超出即截断并在返回体标注 truncated）。 */
export declare const CATALOG_LIMITS: {
    /** 角色条目上限。 */
    readonly roles: 60;
    /** 组合条目上限。 */
    readonly combos: 30;
    /** preset 条目上限。 */
    readonly presets: 40;
    /** 模板条目上限。 */
    readonly templates: 40;
    /** 数据源条目上限。 */
    readonly dataSources: 40;
    /** 工具清单条目上限（available/disabled 各自）。 */
    readonly tools: 120;
    /** 单条摘要文本上限（字符）。 */
    readonly summary: 200;
    /** 角色提示词正文上限（仅 detail 定向请求时返回）。 */
    readonly prompt: 4000;
    /** 模板拓扑摘要的节点/连线上限。 */
    readonly topology: 60;
};
/** 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。 */
export interface OrgCatalogHost {
    /** 数据层：角色模板 / 工具组合 / 工作流模板 / 工作流实例 / 运行历史。 */
    store: {
        listTemplates(kind: 'role' | 'group'): Promise<unknown[]>;
        listToolCombos(): Promise<unknown[]>;
        listFlowTemplates(): Promise<WorkflowTemplate[]>;
        getFlowTemplate(id: string): Promise<WorkflowTemplate | null>;
        listWorkflows(sessionId?: string): Promise<WorkflowDocument[]>;
        getRun(runId: string): Promise<unknown>;
        listRuns(flowId: string): Promise<unknown[]>;
    };
    /**
     * 全局工具开关现状（关闭即从所有会话上下文剔除）。
     * ensureFresh 可选：宿主实现为 ToolSwitchStore 时会先做跨进程刷新（模式二服务进程
     * 与 GUI 不在同一进程），单测 fake 可省略。
     */
    toolSwitches: {
        currentDisabled(): ReadonlySet<string>;
        ensureFresh?(): Promise<void>;
    };
    /** 全局可见工具清单（缺失时返回空数组）。 */
    listTools?: () => Promise<Array<{
        name: string;
        description?: string;
    }>>;
    /** agent preset 目录（缺失时返回空数组）。 */
    listPresets?: () => Promise<Array<{
        id: string;
        name?: string;
        description?: string;
    }>>;
    /** 模型目录（缺失时返回空数组）。 */
    listModels?: () => Promise<Array<{
        provider: string;
        model: string;
    }>>;
    /** 当前会话激活运行（有则顺带刷新空闲基准；返回 null = 无运行）。 */
    activeRunOf?: (sessionId: string) => {
        snapshot: {
            flowId: string;
            id: string;
            status: string;
        };
    } | null;
    /** 取激活运行的最新画布（运行中的事实源口径；缺省回退实例文档）。 */
    currentResolvedFlowOf?: (sessionId: string) => Promise<WorkflowDocument | null>;
    /** 刷新运行的空闲基准（有 run 时的双保险；见自主编排方案 §5.1）。 */
    touchRun?: (sessionId: string) => void;
    /**
     * 父代理闸门已用次数（不含首次编排，D-21）。
     * 缺省 0：闸门计数状态机在 P3 落地（本轮不实现门判定）——此处只保留取值缝，
     * 刻意不用「运行记录条数」这类语义不符的近似值充数，避免污染预算语义。
     */
    milestoneUsedOf?: (sessionId: string) => number;
}
/** 文本截断（超限追加省略标记，供模型感知「还有更多」）。 */
export declare function clip(value: unknown, limit: number): string;
/** 拓扑摘要（templateId 定向勘察时返回，供父代理复用既有编排）。 */
export declare function topologySummaryOf(flow: WorkflowDocument | WorkflowTemplate): {
    nodeCount: number;
    lineCount: number;
    nodes: Array<{
        id: string;
        kind: string;
        label: string;
        groupId?: string | null;
    }>;
    lines: Array<{
        id: string;
        source: string;
        target: string;
        sourceHandle: string;
        targetHandle: string;
        condition?: string;
    }>;
    truncated: boolean;
};
/** 组装目录（导出供单测直接断言，无需起工具注册表）。 */
export declare function buildOrgCatalog(host: OrgCatalogHost, sessionId: string, options: {
    templateId?: string;
    includeRuns?: boolean;
    detailRoleId?: string;
}): Promise<Record<string, unknown>>;
/**
 * 注册 wf_org_catalog（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfOrgCatalog(ctx: {
    get(name: string): unknown;
}, host: OrgCatalogHost): () => void;

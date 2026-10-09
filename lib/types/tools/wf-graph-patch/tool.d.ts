import { hasBlockingIssues } from '../../graph/index.js';
import { type PatchScope } from './types.js';
import type { GraphNode, Line, WorkflowDocument, WorkflowTemplate } from '../../shared/graph-model.js';
import type { OrgBudget } from '../../shared/types.js';
import type { MilestoneMarkResult, MilestoneRunFacts, RunEntry } from '../../orchestrator/index.js';
/** 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。 */
export interface GraphPatchHost {
    /** 数据层读写（模板/实例文档 + 运行事实源刷新）。 */
    store: {
        getFlowTemplate(id: string): Promise<WorkflowTemplate | null>;
        saveFlowTemplate(template: WorkflowTemplate, options: {
            expectedRevision: number;
            keepServerFields?: boolean;
        }): Promise<WorkflowTemplate>;
        getWorkflow(sessionId: string, flowId: string): Promise<WorkflowDocument | null>;
        saveWorkflow(doc: WorkflowDocument, sessionId: string, options: {
            expectedRevision: number;
            keepServerFields?: boolean;
        }): Promise<WorkflowDocument>;
        getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null>;
        saveServiceAsFlow?(doc: WorkflowDocument, sessionId: string, options: {
            expectedRevision: number;
            keepServerFields?: boolean;
        }): Promise<WorkflowDocument>;
        getRun(runId: string): Promise<unknown>;
        listRuns(flowId: string): Promise<unknown[]>;
        /** 工具组合清单：节点 presetId 的取值来源之一（存在性校验用）。 */
        listToolCombos(): Promise<unknown[]>;
    };
    /**
     * agent preset 目录（presetId 的另一取值来源）。
     * 属 best-effort 生态缝：缺失或枚举失败时该来源不参与存在性判定。
     */
    listPresets?: () => Promise<Array<{
        id?: unknown;
    }>>;
    /**
     * 模型清单（provider/model 配对的**唯一取值来源**，reasoning 档位的来源）。
     * 与 listPresets 同为 best-effort 生态缝：缺失或枚举失败时本批取值不参与存在性判定。
     */
    listModels?: () => Promise<unknown[]>;
    /** 编排运行时能力（mark_node 路径 + 事实源刷新 + 空闲基准）。 */
    orchestrator: {
        activeRunForSession(sessionId: string): RunEntry | null;
        flowLockInfo(flowId: string): {
            runId: string;
            sessionId: string;
            status: string;
        } | null;
        currentResolvedFlow(entry: RunEntry): Promise<WorkflowDocument>;
        touchRunForSession(sessionId: string): boolean;
        refreshActiveDefinitions(flowId: string, sessionId: string, flow: WorkflowDocument): Promise<void>;
        /** 闸门标记所需的运行事实（只读；快照归运行时所有）。 */
        milestoneFactsFor(sessionId: string): MilestoneRunFacts | null;
        /** 闸门节点状态写入（运行快照的唯一写者）；返回递增后的已用次数。 */
        markMilestoneNode(sessionId: string, input: {
            nodeId: string;
            status: 'ok' | 'fail';
        }): MilestoneMarkResult;
    };
    /** 运行快照落盘（mark_node 后固化状态；缺省跳过持久化——单测可省）。 */
    persistRun?: (runId: string) => Promise<void>;
    /** 闸门已用次数（不含首次编排 D-21）；P3 实现真实计数，缺省 0。 */
    milestoneUsedOf?: (sessionId: string) => number;
    /**
     * 新建模板 id 生成缝（create 通路；缺省用 node:crypto 的 randomUUID 截断）。
     * 抽成缝的原因：单测需要确定性 id，而 id 生成不是工具的校验逻辑。
     */
    newTemplateId?: () => string;
    /**
     * 记录「本会话成功改过图」的事实（D-05；经验域编排职责判据之一）。
     *
     * 为什么是可选缝：它不影响补丁本身的成败（图已落盘），单测可省略；实现方必须自行保证
     * **不抛错**（记录失败降级为进程内事实并告警），否则会让调用方看到「补丁失败」的假象。
     */
    recordGraphPatch?: (input: {
        sessionId: string;
        targetId: string;
        scope: string;
    }) => Promise<void>;
}
/** 补丁执行结果（工具返回体）。 */
export interface GraphPatchToolResult {
    ok: true;
    scope: PatchScope;
    targetId: string;
    revision: number;
    applied: number;
    /**
     * 只读预算：生效元参数上限 + 当前规模 → 剩余量。
     * 为什么进返回体：元参数对改图方是硬护栏且**不可自行调整**，父代理需要立刻看到
     * 「还剩多少规模」，否则只能靠撞护栏报错来试出边界。
     */
    budget: OrgBudget;
    warnings: Array<{
        code: string;
        message: string;
    }>;
    /** true = 本次补丁新建了模板（scope=template + create）；targetId 即新模板 id。 */
    newTemplate?: boolean;
    /** mark_node 后本 run 已完成的闸门次数（不含首次编排）。 */
    milestoneUsed?: number;
    created?: string[];
    removed?: string[];
    updated?: string[];
    connected?: string[];
    disconnected?: string[];
    marked?: {
        nodeId: string;
        status: 'ok' | 'fail';
        runId: string;
    };
}
/** 组装并执行一次补丁（导出供单测直接断言，无需起工具注册表）。 */
export declare function executeGraphPatch(host: GraphPatchHost, sessionId: string, args: {
    scope?: unknown;
    targetId?: unknown;
    ops?: unknown;
    expectRevision?: unknown;
    create?: unknown;
}): Promise<GraphPatchToolResult>;
/**
 * 注册 wf_graph_patch（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfGraphPatch(ctx: {
    get(name: string): unknown;
}, host: GraphPatchHost): () => void;
export type { GraphNode, Line };
export { hasBlockingIssues };

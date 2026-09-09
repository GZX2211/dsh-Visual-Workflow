import type { WorkflowDocument, GraphNode, WorkflowTemplate } from '../shared/graph-model.js';
import type { ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate, ToolCombo, RunSnapshot } from '../shared/types.js';
/** 模板种类：角色 / 文件 / 数据库 / 协作组（§4.2.3/§4.2.4/§4.2.5.2；左侧栏各 Tab）。 */
export type TemplateKind = 'role' | 'file' | 'database' | 'group';
/** 全部模板的判别联合（按目录区分；data/ 内 file/database 以字段判别；groups/ 为协作组）。 */
export type Template = RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate;
/** 保存选项：陈旧快照冲突保护（旧项目 nextFlowRevision 语义保留）。 */
export interface SaveOptions {
    /** 客户端加载时的 revision；与当前不一致且非 force 时抛冲突。 */
    expectedRevision?: number | null;
    /** 强制覆盖（跳过冲突检查）。 */
    force?: boolean;
}
/** revision 冲突错误：另一会话已保存更新的版本（架构文档 §4.1 原子性与锁一致）。 */
export declare class FlowRevisionConflictError extends Error {
    readonly id: string;
    readonly expectedRevision: number | null;
    readonly actualRevision: number;
    readonly code = "FLOW_REVISION_CONFLICT";
    constructor(id: string, expectedRevision: number | null, actualRevision: number);
}
export declare class FlowStore {
    readonly root: string;
    /** 全部子目录名（init 时创建，常量表供测试断言）。 */
    static readonly DIRS: readonly ["workflows", "services", "roles", "data", "data/files", "groups", "runs", "orchestrations", "flow-templates"];
    constructor(root: string);
    /** 初始化目录结构（幂等：mkdir recursive，重复调用安全）。 */
    init(): Promise<void>;
    private workflowPath;
    private servicePath;
    private sessionsPath;
    private templatePath;
    /** 工作流模板文件路径（flow-templates/ 目录，全局共享）。 */
    private flowTemplatePath;
    private runsPath;
    private orchestrationPath;
    private combosPath;
    /**
     * 列出工作流（按 updatedAt 倒序）。
     * 工作台全局化改版：sessionId 缺省时列出**全部会话**的工作流实例（工作台
     * 全局面板「所有实例」数据源）；传入 sessionId 时仍按会话过滤（定时任务
     * 检测目标会话已有实例、旧单会话面板兼容调用）。
     */
    listWorkflows(sessionId?: string): Promise<WorkflowDocument[]>;
    /** 读取单个工作流；不属于该会话返回 null（隔离语义）。 */
    getWorkflow(sessionId: string, flowId: string): Promise<WorkflowDocument | null>;
    /** 保存工作流（创建/更新统一；revision 递增 + 冲突保护 + 原子写）。 */
    saveWorkflow(flow: WorkflowDocument, sessionId: string, options?: SaveOptions): Promise<WorkflowDocument>;
    /** 删除工作流；仅当归属会话匹配时删除（返回是否删除成功）。 */
    deleteWorkflow(sessionId: string, flowId: string): Promise<boolean>;
    /**
     * 列出服务（跳过 *.sessions.json 映射文件；按 updatedAt 倒序）。
     * 工作台全局化改版：sessionId 缺省时列出**全部会话**的服务实例；传入时按
     * 会话过滤（旧单会话面板兼容调用）。
     */
    listServices(sessionId?: string): Promise<ServiceState[]>;
    /** 读取单个服务；不属于该会话返回 null。 */
    getService(sessionId: string, serviceId: string): Promise<ServiceState | null>;
    /** 按 id 读取服务（不校验归属会话；服务管理器/服务进程用）。 */
    getServiceById(serviceId: string): Promise<ServiceState | null>;
    /** 列出全部服务（不按会话过滤；自动恢复扫描用）。 */
    listServicesAll(): Promise<ServiceState[]>;
    /** 服务文档 → 模式二工作流视图（编排运行入口的 flow 形态）。 */
    getServiceAsFlow(serviceId: string): Promise<WorkflowDocument | null>;
    /** 保存服务（revision 递增 + 冲突保护；status/port 等运行字段由服务管理器独立更新）。 */
    saveService(service: ServiceState, sessionId: string, options?: SaveOptions): Promise<ServiceState>;
    /** 删除服务（级联删除其 sessions 映射文件）。 */
    deleteService(sessionId: string, serviceId: string): Promise<boolean>;
    /** 列出角色模板（精确返回类型重载，供调用方免断言）。 */
    listTemplates(kind: 'role'): Promise<RoleTemplate[]>;
    /** 列出文件模板（data/ 下按字段判别过滤）。 */
    listTemplates(kind: 'file'): Promise<FileTemplate[]>;
    /** 列出数据库模板（data/ 下按字段判别过滤）。 */
    listTemplates(kind: 'database'): Promise<DatabaseTemplate[]>;
    /** 列出协作组模板（groups/ 目录）。 */
    listTemplates(kind: 'group'): Promise<GroupTemplate[]>;
    /** 列出某类模板（kind 联合兜底；具体子类型请用窄签名）。 */
    listTemplates(kind: TemplateKind): Promise<Template[]>;
    /** 按 id 取单个模板（无则 null；导入导出用）。 */
    getTemplate(kind: TemplateKind, id: string): Promise<Template | null>;
    /** 保存模板（原子写；模板 id 由调用方生成；返回带 createdAt/updatedAt 的持久化副本）。 */
    saveTemplate(kind: TemplateKind, template: Template): Promise<Template>;
    /** 删除模板（仅删文件，不影响画布中已深拷贝的节点——§4.2.1 解耦语义）。 */
    deleteTemplate(kind: TemplateKind, id: string): Promise<boolean>;
    /** 列出全部工作流模板（按 updatedAt 倒序；全局共享，所有会话可见）。 */
    listFlowTemplates(): Promise<WorkflowTemplate[]>;
    /** 按 id 读取单个工作流模板（无则 null）。 */
    getFlowTemplate(templateId: string): Promise<WorkflowTemplate | null>;
    /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护 + 原子写；无 sessionId 隔离）。 */
    saveFlowTemplate(template: WorkflowTemplate, options?: SaveOptions): Promise<WorkflowTemplate>;
    /** 删除工作流模板（仅删文件，不影响已生成的实例——模板/实例深拷贝解耦语义）。 */
    deleteFlowTemplate(templateId: string): Promise<boolean>;
    /**
     * 列出某工作流的全部 run（按 startedAt 倒序）。
     * @param sessionId 可选会话过滤：传入时仅返回归属该会话的 run（历史查询端点
     *   必须传，防跨会话运行历史泄露；resume 侧因调用前已按会话定位 flow 可不传）。
     */
    listRuns(flowId: string, sessionId?: string): Promise<RunSnapshot[]>;
    /** 读取单个 run 快照。 */
    getRun(runId: string): Promise<RunSnapshot | null>;
    /** run 是否存在（恢复入口校验用）。 */
    runExists(runId: string): Promise<boolean>;
    /** 保存 run 快照（断点持久化走同一入口；原子写保证崩溃不撕裂）。 */
    saveRun(run: RunSnapshot): Promise<RunSnapshot>;
    /** 扫描全部 run id（reconcileStaleRuns 用，T-027）。 */
    listAllRunIds(): Promise<string[]>;
    /** 列出全部工具组合（全局共享）。 */
    listToolCombos(): Promise<ToolCombo[]>;
    /** 保存工具组合（id 须为 combo- 前缀，§4.6 规则 2）。 */
    saveToolCombo(combo: ToolCombo): Promise<ToolCombo>;
    /** 删除工具组合。 */
    deleteToolCombo(id: string): Promise<boolean>;
    /** 读取某服务的 userId 映射（返回副本，防调用方意外修改内部缓存）。 */
    userIdMap(serviceId: string): Promise<Record<string, string>>;
    /** 保存某服务的 userId 映射（原子写；映射持久化在服务重启后仍有效）。 */
    saveUserIdMap(serviceId: string, map: Record<string, string>): Promise<void>;
    /**
     * 合并写入某服务的 userId 映射（读改写在同一把 withJsonLock 内完成）。
     * 为什么必须合并而不是「先 userIdMap 再 saveUserIdMap」：后者是两次独立锁
     * 作用域内的读改-写，不同 userId 并发首解析时互相覆盖（丢失映射 → 重启后
     * 上下文断裂）。合并写把 read-modify-write 收进同一临界区，并发安全。
     */
    mergeUserIdMap(serviceId: string, entries: Record<string, string>): Promise<Record<string, string>>;
    /** 保存运行时流程定义（startRun 时写入，父代理只读的事实源）。 */
    saveOrchestration(runId: string, flow: WorkflowDocument): Promise<void>;
    /** 读取运行时流程定义。 */
    readOrchestration(runId: string): Promise<WorkflowDocument | null>;
    /** 运行时流程定义文件的绝对路径（编排指令 facts.definitionPath 注入用，T-021）。 */
    orchestrationFilePath(runId: string): string;
    /** 删除运行时流程定义（run 收尾/清理时调用）。 */
    deleteOrchestration(runId: string): Promise<boolean>;
    /** 数据模板按子类筛选：file（文件）或 database（数据库）——复用 listTemplates 重载的精确过滤。 */
    listDataTemplates(subKind: 'file' | 'database'): Promise<Array<FileTemplate | DatabaseTemplate>>;
    /** 节点 → 模板深拷贝（§4.2.1：拖入画布时深拷贝模板嵌入工作流 JSON，此后断引用）。 */
    templateToNode(template: Template, id: string, position: {
        x: number;
        y: number;
    }): GraphNode | null;
}

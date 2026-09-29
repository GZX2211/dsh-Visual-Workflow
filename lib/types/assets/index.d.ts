import type { AssetVersionEntry, AssetVersionSource, ExperienceDraft, ExperienceEntry, ExperienceIndexEntry, ExperiencePatch, RoleAssetDetail, RoleAssetReference, RoleAssetSummary, RoleAssetType, WorkflowAssetDetail, WorkflowAssetSummary } from '../shared/asset-types.js';
import type { GraphNode, Line, WorkflowMode } from '../shared/graph-model.js';
import type { OrgMeta } from '../shared/org-meta.js';
import type { RoleTemplate } from '../shared/template-types.js';
import { type ExperienceInsertResult } from './experiences.js';
import { type IdGeneratorDeps } from './ids.js';
export { AssetError } from './errors.js';
export type { AssetErrorCode } from './errors.js';
export { contentFingerprint, stableStringify } from './fingerprint.js';
export type { ExperienceInsertResult } from './experiences.js';
export { EXPERIENCE_INDEX_MAX_LIMIT } from './experiences.js';
export { EXPERIENCE_ID_PREFIX, ROLE_ASSET_ID_PREFIX, WORKFLOW_ASSET_ID_PREFIX, newExperienceId, newRoleAssetId, newWorkflowAssetId, versionRowId, type IdGeneratorDeps, type RandomSource, } from './ids.js';
export { ASSET_DB_FILE } from './schema.js';
/** AssetStore 依赖：时钟与 id 生成（测试可确定化；缺省用系统实现）。 */
export interface AssetStoreDeps {
    /** 当前时间毫秒（缺省 Date.now）。 */
    now?: () => number;
    /** id 生成依赖（随机源/时间/序号；缺省系统实现）。 */
    ids?: IdGeneratorDeps;
}
/** 角色模版晋升入参。 */
export interface RolePromoteInput {
    templateId: string;
    fingerprint: string;
    role: RoleTemplate;
    source: AssetVersionSource;
}
/** 工作流模版晋升入参。 */
export interface WorkflowPromoteInput {
    templateId: string;
    fingerprint: string;
    mode: WorkflowMode;
    name: string;
    description: string;
    nodes: GraphNode[];
    lines: Line[];
    meta?: OrgMeta;
    source: AssetVersionSource;
}
/** 角色资产态保存入参（登记新版本）。 */
export interface RoleSaveInput {
    assetId: string;
    role: RoleTemplate;
    source: AssetVersionSource;
}
/** 工作流资产态保存入参。 */
export interface WorkflowSaveInput {
    assetId: string;
    mode: WorkflowMode;
    name: string;
    description: string;
    nodes: GraphNode[];
    lines: Line[];
    meta?: OrgMeta;
    source: AssetVersionSource;
}
/**
 * 影响面预览入参（只读 discriminated union）：
 *   - role：内容确实变更时返回引用了该角色资产的其它工作流资产；
 *   - workflow：本次节点集会为哪些角色资产登记新版本，进而牵连哪些其它工作流资产。
 */
export type AssetCascadePreviewInput = {
    kind: 'role';
    assetId: string;
    role: RoleTemplate;
} | {
    kind: 'workflow';
    workflowAssetId: string | null;
    nodes: GraphNode[];
};
/** 晋升/保存结果。 */
export interface AssetPromoteResult {
    assetId: string;
    versionId: number;
    rowId: string;
    /** 内容与既有版本全等（或指纹短路）时为 true：未新增版本。 */
    unchanged: boolean;
    /** 角色资产类型（角色晋升/保存返回；工作流路径不含单个角色类型）。 */
    roleAssetType?: RoleAssetType;
    /** 本次操作中被合并为 shared 的角色资产 id（去重）。 */
    sharedRoleAssetIds: string[];
    /** 本次登记使「已无任何工作流引用」而自动归档的角色资产 id（去重）。 */
    archivedRoleAssetIds: string[];
}
/**
 * 资产库（单文件 SQLite）。
 *
 * 读改写语义：每个公开写方法与读方法都在**一笔事务**内完成（进程内串行 + BEGIN IMMEDIATE），
 * 失败整体回滚，不留半成品。
 */
export declare class AssetStore {
    private readonly db;
    private readonly now;
    private readonly ids;
    private initialized;
    constructor(root: string, deps?: AssetStoreDeps);
    /** 打开库并幂等建表（重复调用无副作用）。 */
    init(): Promise<void>;
    /** 关闭连接（幂等；关闭后再次调用读接口会重新要求 init）。 */
    close(): void;
    /** 角色资产列表（活跃；Active 版本投影；currentTemplateFingerprint 由 API 边界填充）。 */
    listRoleAssets(): Promise<RoleAssetSummary[]>;
    /** 历史（已归档）角色资产列表（最新版本行投影；不进父代理召回面）。 */
    listRetiredRoleAssets(): Promise<RoleAssetSummary[]>;
    /** 角色资产详情（活跃取 Active 版本、归档取最新版本行，归档时带 retired 标记）。 */
    getRoleAsset(assetId: string): Promise<RoleAssetDetail | null>;
    /**
     * 按角色版本行 id 取**该版本**详情；行不存在或资产已退役返回 null。
     * 用途：目录勘察把工作流资产里钉住的角色版本标注为可召回的 `role-*` 资产
     * （按钉住版本返回，不能读 Active，否则回滚后标注会撒谎）。
     */
    getRoleAssetVersion(roleRowId: string): Promise<RoleAssetDetail | null>;
    /** 角色资产版本列表（版本号倒序；归档资产同样可列，用于重新启用）。 */
    listRoleVersions(assetId: string): Promise<AssetVersionEntry[]>;
    /** 回滚角色资产到指定版本（活跃资产挪 Active 指针；归档资产即重新启用）。 */
    rollbackRoleAsset(assetId: string, versionId: number): Promise<RoleAssetDetail>;
    /** 恢复已归档角色资产（取最新版本行重建 Active 指针；已活跃时为幂等无操作）。 */
    restoreRoleAsset(assetId: string): Promise<RoleAssetDetail>;
    /** 归档角色资产（删 Active 行；历史、引用统计与版本内容全部保留）。 */
    retireRoleAsset(assetId: string): Promise<void>;
    /** 角色模版晋升为资产（算法 C）。 */
    promoteRole(input: RolePromoteInput): Promise<AssetPromoteResult>;
    /** 资产态保存角色（算法 D：登记新版本；归档资产的保存只迭代版本、不重建 Active 行）。 */
    saveRoleVersion(input: RoleSaveInput): Promise<AssetPromoteResult>;
    /** 工作流资产列表（活跃；Active 版本投影；currentTemplateFingerprint 由 API 边界填充）。 */
    listWorkflowAssets(): Promise<WorkflowAssetSummary[]>;
    /** 历史（已归档）工作流资产列表（最新版本行投影；不进父代理召回面）。 */
    listRetiredWorkflowAssets(): Promise<WorkflowAssetSummary[]>;
    /** 工作流资产详情（活跃取 Active 版本、归档取最新版本行，归档时带 retired 标记）。 */
    getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>;
    /** 工作流资产版本列表（版本号倒序；归档资产同样可列，用于重新启用）。 */
    listWorkflowVersions(assetId: string): Promise<AssetVersionEntry[]>;
    /** 回滚工作流资产到指定版本（活跃资产挪 Active 指针；归档资产即重新启用）。 */
    rollbackWorkflowAsset(assetId: string, versionId: number): Promise<WorkflowAssetDetail>;
    /** 恢复已归档工作流资产（取最新版本行重建 Active 指针；已活跃时为幂等无操作）。 */
    restoreWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail>;
    /** 归档工作流资产（删 Active 行；历史行与其内联角色资产全部保留）。 */
    retireWorkflowAsset(assetId: string): Promise<void>;
    /**
     * 保存前的影响面预览（只读）：本次内容会牵连哪些**其他**工作流资产。
     * 判据与登记路径同源，因此预览结论与真实保存不会分叉。
     */
    previewAssetCascade(input: AssetCascadePreviewInput): Promise<RoleAssetReference[]>;
    /** 工作流模版晋升为资产（算法 E）。 */
    promoteWorkflow(input: WorkflowPromoteInput): Promise<AssetPromoteResult>;
    /**
     * 资产态保存工作流（算法 E：内容查重后登记新版本，来源绑定继承自被保存版本）。
     *
     * 与晋升路径的差异（用户裁决）：资产态保存**不做指纹短路**（入参无指纹，保留被保存版本
     * 的来源绑定，使「入库按钮锁定」判据不会被一次保存静默解锁），但同样走内容查重——
     * 名称/描述/mode/meta + 节点内容（忽略坐标）+ 连线全等即视为未变化、不新增版本。
     */
    saveWorkflowVersion(input: WorkflowSaveInput): Promise<AssetPromoteResult>;
    /** 经验索引（**召回面**：只含活跃经验；按 created_at 倒序，limit 条）。 */
    listExperienceIndex(limit: number): Promise<ExperienceIndexEntry[]>;
    /** 经验列表（界面数据源：活跃与已归档一并返回；条目自带 active 标记）。 */
    listExperiences(limit: number): Promise<ExperienceEntry[]>;
    /**
     * 经验详情（**召回面**：已归档经验一律查不到）。
     * 消费方是父代理的目录召回，归档即不可召回必须在读取处生效，而不是靠调用方自觉过滤。
     */
    getExperiences(ids: string[]): Promise<ExperienceEntry[]>;
    /** 保存经验（就地更新可编辑字段；无版本语义，不产生历史行）。 */
    saveExperience(id: string, patch: ExperiencePatch): Promise<ExperienceEntry>;
    /** 经验归档 / 恢复（状态切换的唯一入口；内容与历史一概不动）。 */
    setExperienceActive(id: string, active: boolean): Promise<ExperienceEntry>;
    /**
     * 批量插入经验：空字段与重复 insight 跳过并回传原因，其余入库。
     * 整批在一笔事务内完成，任一条插入失败则整批回滚（不留下半批经验）。
     */
    insertExperiences(drafts: ExperienceDraft[], reviewedAt: number): Promise<ExperienceInsertResult>;
}

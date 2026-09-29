import type { AssetVersionEntry, RoleAssetDetail, RoleAssetReference, RoleAssetSummary, RoleAssetType } from '../shared/asset-types.js';
import type { RoleTemplate } from '../shared/template-types.js';
import type { AssetTxContext } from './db.js';
import { roleRowValues, type RoleAssetActiveRow, type RoleAssetRow, type RoleContentFields } from './row-codec.js';
/** 端口运行环境：时钟由 AssetStore 注入（测试可确定化）。 */
export interface RolePortContext {
    tx: AssetTxContext;
    now: () => number;
}
/** 登记结果（含类型与共享资产，供 AssetPromoteResult 组装）。 */
export interface RoleRegistration {
    assetId: string;
    versionId: number;
    rowId: string;
    unchanged: boolean;
    roleAssetType: RoleAssetType;
}
/** 晋升/保存入参（AssetStore 组装后传入）。 */
export interface RolePromoteRequest {
    /** 命中去重/绑定前预分配的新资产 id（仅真正新建时使用，保证调用方可用固定随机源测试）。 */
    newAssetId: string;
    /** 晋升路径的来源模版 id；资产态保存为 null（不覆盖既有绑定）。 */
    sourceTemplateId: string | null;
    fingerprint: string | null;
    role: RoleTemplate;
    source: 'human' | 'agent';
}
/** 晋升/保存结果（含被合并进 shared 的资产清单）。 */
export interface RoleWriteResult extends RoleRegistration {
    sharedRoleAssetIds: string[];
}
/** 角色版本行读取（无匹配返回 null）。 */
export declare function readRoleVersionRow(ctx: AssetTxContext, assetId: string, versionId: number): RoleAssetRow | null;
/** 是否处于未退役状态（Active 行存在）。 */
export declare function isRoleAssetLive(ctx: AssetTxContext, assetId: string): boolean;
/** 角色资产 Active 行（未归档资产必有；归档后为 null）。 */
export declare function readRoleActive(ctx: AssetTxContext, assetId: string): RoleAssetActiveRow | null;
/**
 * 最新版本行（max version_id）。
 *
 * 归档资产没有 Active 指针，详情投影、保存在此基础上续版、版本列表都以它为准；
 * 行不存在即资产完全不存在（既未活跃也无历史）。
 */
export declare function latestRoleVersionRow(ctx: AssetTxContext, assetId: string): RoleAssetRow | null;
/** 该角色资产当前类型（Active 版本行的类型）；归档或行缺失返回 null。 */
export declare function roleAssetCurrentType(ctx: AssetTxContext, assetId: string): RoleAssetType | null;
/** 下一个版本号 = 该资产下 max(version_id) + 1。 */
export declare function nextRoleVersionId(ctx: AssetTxContext, assetId: string): number;
/**
 * 内容去重（算法 B）：`kind + system_prompt` 全等，匹配范围为**未退役资产的全部版本行**，
 * 命中时取版本号最大的那一行（用户看到的是该资产的最新内容）。
 * 已退役资产不参与匹配：用户已明确将其移出复用面，再次晋升应产出新资产。
 */
export declare function findRoleVersionByContent(ctx: AssetTxContext, fields: RoleContentFields): {
    assetId: string;
    versionId: number;
    row: RoleAssetRow;
} | null;
/** 新建角色资产（版本 1）：写入历史行与 Active 行。 */
export declare function createRoleAsset(ctx: RolePortContext, input: {
    assetId: string;
    fields: RoleContentFields;
    roleAssetType: RoleAssetType;
    source: 'human' | 'agent';
    /** 预分配版本号（新建恒为 1；保留参数与 addRoleVersion 同构）。 */
    versionId?: number;
    /**
     * 来源模版绑定与指纹（仅「角色模版晋升」路径携带）。
     * 工作流内联角色新建的 inline 资产不带绑定：它不由模版直接晋升，
     * 带上绑定会让「跳转来源模版」指向一个并非其来源的模版。
     */
    sourceTemplateId?: string | null;
    sourceFingerprint?: string | null;
}): RoleRegistration;
/**
 * 在既有资产下登记新版本并移动 Active 指针。
 * `inheritSource`: 来源绑定与指纹的继承值（晋升路径取来源模版，保存路径取被保存的 Active 行）。
 * `previousRow`: 被保存的 Active 版本行（调用方已读取时传入，避免重复回表；
 * 缺省时自行读取，语义相同）。
 * `activate`: 是否同步把 Active 指针移向新版本。归档资产的保存为 false——历史资产的
 * 「保存」只做版本迭代，不改变归档状态（重新启用只能经显式回滚）。
 */
export declare function addRoleVersion(ctx: RolePortContext, input: {
    assetId: string;
    fields: RoleContentFields;
    roleAssetType: RoleAssetType;
    source: 'human' | 'agent';
    inheritSource: {
        sourceTemplateId: string | null;
        sourceFingerprint: string | null;
    };
    previousRow?: RoleAssetRow | null;
    /** 预分配版本号（调用方已解析时传入，避免二次计算）；缺省为 max+1。 */
    versionId?: number;
    /** 缺省 true（登记即激活）；归档资产保存传 false。 */
    activate?: boolean;
}): RoleRegistration;
/** 追加引用（引用统计专用）：把工作流版本行 id 去重追加，并同步 reference_status。 */
export declare function appendRoleReference(ctx: RolePortContext, rowId: string, workflowRowId: string): void;
/** 引用列表长度（用于「被两个以上工作流版本引用即升 shared」判定）。 */
export declare function referenceCount(ctx: AssetTxContext, rowId: string): number;
/**
 * 解除引用（引用统计的唯一删减点）：把 `workflowAssetId` 挂在本版本行上的引用全部移除。
 *
 * 为什么整段移除而不是按版本行精确匹配：一次工作流保存会把该资产的旧版本行引用一并作废
 * （新版本已不再引用该角色版本），逐行匹配没有额外信息量。`<assetId>@<versionId>` 的
 * 分隔符保证前缀匹配不会误伤同前缀的其它资产 id。
 *
 * @returns 发生变更时返回该行所属角色资产 id，未变更返回 null。
 */
export declare function releaseRoleReference(ctx: RolePortContext, rowId: string, workflowAssetId: string): string | null;
/** 该角色资产是否仍被任何工作流资产版本引用（归档判定的唯一依据）。 */
export declare function roleAssetReferencedByAnyWorkflow(ctx: AssetTxContext, assetId: string): boolean;
/**
 * 角色资产类型降级为 standalone（归档的伴随动作）。
 *
 * 为什么可以整表改写类型：role_asset_type 被 DDL 与模块规则同时声明为**可变统计缓存**
 * （内容列才不可变）。资产离开活跃复用面后，「是否内联 / 是否被多工作流共享」这两个事实
 * 都已不成立，保留旧类型只会让左侧「历史资产」显示错误标签。
 */
export declare function demoteRoleAssetType(ctx: RolePortContext, assetId: string): void;
/** 版本行的当前类型（可能与该资产 Active 版本不同：类型只随被引用/被合并的那一行变化）。 */
export declare function roleVersionType(ctx: AssetTxContext, rowId: string): RoleAssetType | null;
/**
 * 把版本行升为 shared，并刷新其 updated_at。
 * 为什么只改这一行：其他历史版本的类型描述「它当时是否共享」，回滚到旧版本不应携带
 * 新版本的共享事实；而 Active 行若正指向该行，则随之一致（同一行）。
 */
export declare function markRoleVersionShared(ctx: RolePortContext, rowId: string): void;
/**
 * 角色资产列表（活跃资产 = 有 Active 行的资产；Active 版本投影）。
 * 列表读语义：单行损坏（JSON 非法/缺列）跳过该条并 warn，保证列表仍可用。
 */
export declare function listRoleAssets(ctx: AssetTxContext): RoleAssetSummary[];
/**
 * 历史（已归档）角色资产列表：有历史行、但没有 Active 行的资产，按**最新版本行**投影。
 *
 * 为什么必须与活跃列表分开而不是加一个标志位：活跃列表是父代理召回面（`wf_org_catalog`
 * 与本地向量索引都消费它），归档资产绝不能混进召回面；分开返回使「召回什么」在类型上可见。
 */
export declare function listRetiredRoleAssets(ctx: AssetTxContext): RoleAssetSummary[];
/**
 * 引用了该角色资产**任一版本**的工作流资产（按资产聚合去重）。
 *
 * 口径为什么是资产级：`reference_workflow_ids` 记的是工作流版本行 id，且新版本行的引用从零
 * 开始计数，因此「单看 Active 版本行的数组长度」既不是引用方数量也不是引用次数——
 * 它会给出「shared 资产被 0 个工作流引用」这种与类型定义直接矛盾的读数。
 *
 * 名称取工作流资产的**最新版本行**（资产没有独立名称列）：归档工作流资产仍会被计入，
 * 因为它的历史版本仍钉住该角色版本（与归档确认框的说明一致）。
 */
export declare function listRoleAssetReferences(ctx: AssetTxContext, assetId: string): RoleAssetReference[];
/**
 * 角色资产详情：活跃资产取 Active 版本；归档资产取**最新版本行**（并标 `retired`）。
 * resource 完全不存在（无 Active 且无历史行）返回 null，行损坏抛可诊断错误。
 */
export declare function getRoleAssetDetail(ctx: AssetTxContext, assetId: string): RoleAssetDetail | null;
/**
 * 按角色版本行 id（`<assetId>@<versionId>`）取**该版本**的角色资产详情。
 *
 * 与 getRoleAssetDetail 的区别：后者读 Active 版本，回滚或升版后会指到别的版本——目录把
 * 工作流资产里钉住的角色版本标注为可召回的 `role-*` 资产时，必须按钉住版本返回，否则标注的
 * 版本号与内容会撒谎。版本行 id 形状非法 / 行不存在 / 资产已退役（Active 行缺失）返回 null。
 */
export declare function getRoleAssetVersionDetail(ctx: AssetTxContext, roleRowId: string): RoleAssetDetail | null;
/**
 * 角色资产版本列表（按版本号倒序，最新在前）。
 * 归档资产同样可列（无 Active 指针时全部标 `active: false`）——历史资产的「重新启用」
 * 与「保存迭代」都以本列表为入口，因资产归档而报「不存在」会让界面无从操作。
 */
export declare function readRoleVersionEntries(ctx: AssetTxContext, assetId: string): AssetVersionEntry[];
/**
 * 回滚：把 Active 指针移向目标版本（含 name / retrieval_context / 来源指纹的同步），
 * 不新增版本、不改历史行——历史内容不可变是回滚语义的前提。
 *
 * 归档资产（无 Active 行）的回滚即「重新启用」：按目标版本重建 Active 行。
 * 这也是归档资产恢复活跃的唯一入口（保存只做版本迭代，不改变归档状态）。
 */
export declare function rollbackRoleAssetTo(ctx: RolePortContext, assetId: string, versionId: number): RoleAssetDetail;
/** 归档：删除 Active 行（历史、引用统计与类型列全部保留，供审计与重新启用判定）。 */
export declare function retireRoleAssetRow(tx: AssetTxContext, assetId: string): void;
/**
 * 角色晋升（算法 C）：
 *   1. 已有 Active 且绑定同一来源模版 → 走该资产的新版本路径（内容全等即 unchanged）；
 *   2. 否则内容去重：standalone 冲突直接拦截；inline/shared 冲突则合并（类型升 shared，不建新资产）；
 *   3. 均未命中 → 新建 standalone 资产（版本 1）。
 */
export declare function promoteRoleVersion(ctx: RolePortContext, request: RolePromoteRequest): RoleWriteResult;
/**
 * 资产态保存（算法 D）：登记新版本，来源绑定与指纹**继承**自被保存的版本
 * （保存不改写来源模版事实，只有晋升会刷新它）。
 *
 * 归档资产同样可保存（历史资产的版本迭代）：基线与继承源取最新版本行，且不重建 Active 行
 * ——归档状态只由显式回滚改变。
 */
export declare function saveRoleAssetVersion(ctx: RolePortContext, input: {
    assetId: string;
    role: RoleTemplate;
    source: 'human' | 'agent';
}): RoleWriteResult;
/**
 * 保存前的影响面预览（角色资产，只读）：内容确实会变更时返回「引用了本资产的其它工作流资产」。
 *
 * 内容判据与 saveRoleAssetVersion 完全同源（同一个 `sameRoleFields` 与同一份字段映射），
 * 因此不会出现「预览说没事、保存却登记了新版本」的分叉。内容未变更返回空数组。
 */
export declare function previewRoleAssetCascade(ctx: RolePortContext, assetId: string, role: RoleTemplate): RoleAssetReference[];
/**
 * 历史行插入（导出给工作流写路径复用：角色节点升版与角色资产升版必须落同一份列映射，
 * 否则两条路径的行形状会漂移）。
 */
export declare function insertRoleVersionRow(tx: AssetTxContext, values: ReturnType<typeof roleRowValues>): void;
/** Active 行插入或替换（asset_id 主键，指针语义；导出给工作流写路径复用）。 */
export declare function writeRoleActiveRow(tx: AssetTxContext, values: {
    assetId: string;
    versionId: number;
    name: string;
    retrievalContext: string;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    updatedAt: number;
}): void;
/** 版本行 → 详情契约（不读模版，currentTemplateFingerprint 由 API 边界填充）。 */
export declare function roleAssetRowToDetail(row: RoleAssetRow): RoleAssetDetail;

// src/host/assets/index.ts
//
// 资产库公共入口：AssetStore（单文件 SQLite 资产库）与配套导出。
//
// 状态所有权：本模块是「资产（模版的晋升形态）」与「经验（复盘沉淀）」两个事实的唯一
// 所有者，磁盘文件固定 `<root>/assets.db`；调用方只经本入口读写，不得自行拼路径或建表。
// 依赖方向：只依赖 shared 的纯类型/协议常量与 Node 内置能力，不反向依赖 api/tools/client。
import { AssetDb } from './db.js';
import { assetNotFound, AssetError } from './errors.js';
import { getActivePromptRow, listPromptRows } from './experience-prompts.js';
import { insertExperienceRowsChecked, listActiveExperienceEmbeddingRows, listExperienceRows, readExperiencesByIds, setExperienceActiveRow, updateExperienceFieldsRow, } from './experiences.js';
import { newExperienceId, newRoleAssetId, newWorkflowAssetId } from './ids.js';
import { getRoleAssetDetail, getRoleAssetVersionDetail, listRetiredRoleAssets, listRoleAssets, previewRoleAssetCascade, promoteRoleVersion, readRoleVersionEntries, restoreRoleAssetTo, retireRoleAssetRow, rollbackRoleAssetTo, saveRoleAssetVersion, } from './role-assets.js';
import { createWorkflowAsset, findWorkflowAssetByTemplate, getWorkflowAssetDetail, listRetiredWorkflowAssets, listWorkflowAssets, latestWorkflowVersionRow, previewWorkflowAssetCascade, readWorkflowActive, readWorkflowVersionEntries, registerWorkflowVersion, restoreWorkflowAssetTo, retireWorkflowAssetRow, rollbackWorkflowAssetTo, } from './workflow-assets.js';
export { AssetError } from './errors.js';
export { contentFingerprint, stableStringify } from './fingerprint.js';
export { decodeEmbedding, encodeEmbedding } from './embedding-blob.js';
export { EXPERIENCE_LIST_MAX_LIMIT } from './experiences.js';
export { EXPERIENCE_PROMPT_SEED_VERSION, EXPERIENCE_PROMPT_SEEDS } from './experience-seeds.js';
export { EXPERIENCE_ID_PREFIX, ROLE_ASSET_ID_PREFIX, WORKFLOW_ASSET_ID_PREFIX, newExperienceId, newRoleAssetId, newWorkflowAssetId, versionRowId, } from './ids.js';
export { ASSET_DB_FILE } from './schema.js';
/**
 * 资产库（单文件 SQLite）。
 *
 * 读改写语义：每个公开写方法与读方法都在**一笔事务**内完成（进程内串行 + BEGIN IMMEDIATE），
 * 失败整体回滚，不留半成品。
 */
export class AssetStore {
    db;
    now;
    ids;
    initialized = false;
    constructor(root, deps = {}) {
        this.now = deps.now ?? Date.now;
        this.db = new AssetDb(root, this.now);
        this.ids = deps.ids ?? {};
    }
    /** 打开库并幂等建表（重复调用无副作用）。 */
    async init() {
        if (this.initialized)
            return;
        try {
            await this.db.open();
        }
        catch (error) {
            // 打开/建表失败即关掉半开的连接，避免留下占用库文件的句柄
            this.db.close();
            throw error;
        }
        this.initialized = true;
    }
    /** 关闭连接（幂等；关闭后再次调用读接口会重新要求 init）。 */
    close() {
        this.db.close();
        this.initialized = false;
    }
    // -------------------------------------------------------------------------
    // 角色资产
    // -------------------------------------------------------------------------
    /** 角色资产列表（活跃；Active 版本投影；currentTemplateFingerprint 由 API 边界填充）。 */
    listRoleAssets() {
        return this.db.withTx((tx) => listRoleAssets(tx));
    }
    /** 历史（已归档）角色资产列表（最新版本行投影；不进父代理召回面）。 */
    listRetiredRoleAssets() {
        return this.db.withTx((tx) => listRetiredRoleAssets(tx));
    }
    /** 角色资产详情（活跃取 Active 版本、归档取最新版本行，归档时带 retired 标记）。 */
    getRoleAsset(assetId) {
        return this.db.withTx((tx) => getRoleAssetDetail(tx, assetId));
    }
    /**
     * 按角色版本行 id 取**该版本**详情；行不存在或资产已退役返回 null。
     * 用途：目录勘察把工作流资产里钉住的角色版本标注为可召回的 `role-*` 资产
     * （按钉住版本返回，不能读 Active，否则回滚后标注会撒谎）。
     */
    getRoleAssetVersion(roleRowId) {
        return this.db.withTx((tx) => getRoleAssetVersionDetail(tx, roleRowId));
    }
    /** 角色资产版本列表（版本号倒序；归档资产同样可列，用于重新启用）。 */
    listRoleVersions(assetId) {
        return this.db.withTx((tx) => readRoleVersionEntries(tx, assetId));
    }
    /** 回滚角色资产到指定版本（活跃资产挪 Active 指针；归档资产即重新启用）。 */
    rollbackRoleAsset(assetId, versionId) {
        return this.db.withTx((tx) => rollbackRoleAssetTo({ tx, now: this.now }, assetId, versionId));
    }
    /** 恢复已归档角色资产（取最新版本行重建 Active 指针；已活跃时为幂等无操作）。 */
    restoreRoleAsset(assetId) {
        return this.db.withTx((tx) => restoreRoleAssetTo({ tx, now: this.now }, assetId));
    }
    /** 归档角色资产（删 Active 行；历史、引用统计与版本内容全部保留）。 */
    async retireRoleAsset(assetId) {
        await this.db.withTx((tx) => retireRoleAssetRow(tx, assetId));
    }
    /** 角色模版晋升为资产（算法 C）。 */
    promoteRole(input) {
        return this.db.withTx((tx) => {
            const result = promoteRoleVersion({ tx, now: this.now }, {
                newAssetId: newRoleAssetId(this.ids),
                sourceTemplateId: input.templateId,
                fingerprint: input.fingerprint,
                role: input.role,
                source: input.source,
            });
            return {
                assetId: result.assetId,
                versionId: result.versionId,
                rowId: result.rowId,
                unchanged: result.unchanged,
                roleAssetType: result.roleAssetType,
                sharedRoleAssetIds: result.sharedRoleAssetIds,
                archivedRoleAssetIds: [],
            };
        });
    }
    /** 资产态保存角色（算法 D：登记新版本；归档资产的保存只迭代版本、不重建 Active 行）。 */
    saveRoleVersion(input) {
        return this.db.withTx((tx) => {
            const result = saveRoleAssetVersion({ tx, now: this.now }, {
                assetId: input.assetId,
                role: input.role,
                source: input.source,
            });
            return {
                assetId: result.assetId,
                versionId: result.versionId,
                rowId: result.rowId,
                unchanged: result.unchanged,
                roleAssetType: result.roleAssetType,
                sharedRoleAssetIds: result.sharedRoleAssetIds,
                archivedRoleAssetIds: [],
            };
        });
    }
    // -------------------------------------------------------------------------
    // 工作流资产
    // -------------------------------------------------------------------------
    /** 工作流资产列表（活跃；Active 版本投影；currentTemplateFingerprint 由 API 边界填充）。 */
    listWorkflowAssets() {
        return this.db.withTx((tx) => listWorkflowAssets(tx));
    }
    /** 历史（已归档）工作流资产列表（最新版本行投影；不进父代理召回面）。 */
    listRetiredWorkflowAssets() {
        return this.db.withTx((tx) => listRetiredWorkflowAssets(tx));
    }
    /** 工作流资产详情（活跃取 Active 版本、归档取最新版本行，归档时带 retired 标记）。 */
    getWorkflowAsset(assetId) {
        return this.db.withTx((tx) => getWorkflowAssetDetail(tx, assetId));
    }
    /** 工作流资产版本列表（版本号倒序；归档资产同样可列，用于重新启用）。 */
    listWorkflowVersions(assetId) {
        return this.db.withTx((tx) => readWorkflowVersionEntries(tx, assetId));
    }
    /** 回滚工作流资产到指定版本（活跃资产挪 Active 指针；归档资产即重新启用）。 */
    rollbackWorkflowAsset(assetId, versionId) {
        return this.db.withTx((tx) => rollbackWorkflowAssetTo({ tx, now: this.now }, assetId, versionId));
    }
    /** 恢复已归档工作流资产（取最新版本行重建 Active 指针；已活跃时为幂等无操作）。 */
    restoreWorkflowAsset(assetId) {
        return this.db.withTx((tx) => restoreWorkflowAssetTo({ tx, now: this.now }, assetId));
    }
    /** 归档工作流资产（删 Active 行；历史行与其内联角色资产全部保留）。 */
    async retireWorkflowAsset(assetId) {
        await this.db.withTx((tx) => retireWorkflowAssetRow(tx, assetId));
    }
    /**
     * 保存前的影响面预览（只读）：本次内容会牵连哪些**其他**工作流资产。
     * 判据与登记路径同源，因此预览结论与真实保存不会分叉。
     */
    previewAssetCascade(input) {
        return this.db.withTx((tx) => {
            if (input.kind === 'role')
                return previewRoleAssetCascade({ tx, now: this.now }, input.assetId, input.role);
            return previewWorkflowAssetCascade(tx, { workflowAssetId: input.workflowAssetId, nodes: input.nodes });
        });
    }
    /** 工作流模版晋升为资产（算法 E）。 */
    promoteWorkflow(input) {
        return this.db.withTx((tx) => {
            const ctx = { tx, now: this.now };
            const bound = findWorkflowAssetByTemplate(tx, input.templateId);
            const request = {
                assetId: bound?.assetId ?? newWorkflowAssetId(this.ids),
                mode: input.mode,
                name: input.name,
                description: input.description,
                nodes: input.nodes,
                lines: input.lines,
                meta: input.meta ?? null,
                source: input.source,
                sourceTemplateId: input.templateId,
                fingerprint: input.fingerprint,
                nextRoleAssetId: () => newRoleAssetId(this.ids),
            };
            const result = bound
                ? registerWorkflowVersion(ctx, { ...request, shortCircuitFingerprint: input.fingerprint })
                : createWorkflowAsset(ctx, request);
            return {
                assetId: result.assetId,
                versionId: result.versionId,
                rowId: result.rowId,
                unchanged: result.unchanged,
                sharedRoleAssetIds: result.sharedRoleAssetIds,
                archivedRoleAssetIds: result.archivedRoleAssetIds,
            };
        });
    }
    /**
     * 资产态保存工作流（算法 E：内容查重后登记新版本，来源绑定继承自被保存版本）。
     *
     * 与晋升路径的差异（用户裁决）：资产态保存**不做指纹短路**（入参无指纹，保留被保存版本
     * 的来源绑定，使「入库按钮锁定」判据不会被一次保存静默解锁），但同样走内容查重——
     * 名称/描述/mode/meta + 节点内容（忽略坐标）+ 连线全等即视为未变化、不新增版本。
     */
    saveWorkflowVersion(input) {
        return this.db.withTx((tx) => {
            const ctx = { tx, now: this.now };
            const active = readWorkflowActive(tx, input.assetId);
            // 归档资产没有 Active 行：来源绑定改从最新版本行继承（与角色资产的保存口径一致），
            // 使一次归档后的保存不会静默清空绑定、也不重建 Active 行。
            const binding = active ?? latestWorkflowVersionRow(tx, input.assetId);
            if (!binding)
                throw assetNotFound(input.assetId);
            const result = registerWorkflowVersion(ctx, {
                assetId: input.assetId,
                mode: input.mode,
                name: input.name,
                description: input.description,
                nodes: input.nodes,
                lines: input.lines,
                meta: input.meta ?? null,
                source: input.source,
                sourceTemplateId: binding.sourceTemplateId,
                fingerprint: binding.sourceFingerprint,
                shortCircuitFingerprint: null,
                nextRoleAssetId: () => newRoleAssetId(this.ids),
            });
            return {
                assetId: result.assetId,
                versionId: result.versionId,
                rowId: result.rowId,
                unchanged: result.unchanged,
                sharedRoleAssetIds: result.sharedRoleAssetIds,
                archivedRoleAssetIds: result.archivedRoleAssetIds,
            };
        });
    }
    // -------------------------------------------------------------------------
    // 经验
    // -------------------------------------------------------------------------
    /**
     * 生成新的经验 id。
     * 为什么由资产库发号：经验 id 的命名空间与格式属磁盘契约（前缀、跨进程唯一性策略），
     * 交给调用方各自拼装必然出现多套格式。
     */
    nextId() {
        return newExperienceId(this.ids);
    }
    /** 某主体类型当前生效的经验生成 Prompt（无活跃行返回 null，即该类型经验生成被关闭）。 */
    getActivePrompt(type) {
        return this.db.withTx((tx) => getActivePromptRow(tx, type));
    }
    /** 全量经验生成 Prompt（含历史版本；同类型内活跃行排在前）。 */
    listPrompts() {
        return this.db.withTx((tx) => listPromptRows(tx));
    }
    /** 界面经验列表（活跃与归档一并返回，条目自带 active 标记；超出上限按上限截断）。 */
    listRows(limit) {
        return this.db.withTx((tx) => listExperienceRows(tx, limit));
    }
    /**
     * 按 id 读经验（保持入参顺序，命中不到的略过）。
     * `activeOnly` = 召回面语义：归档经验一律查不到，避免调用方各自判断归档过滤。
     */
    getRows(ids, options) {
        return this.db.withTx((tx) => readExperiencesByIds(tx, ids, options));
    }
    /**
     * 某主体类型的活跃向量（召回输入：任务侧与决策侧双通道一次读盘）。
     * 向量不可用或只有单侧的行不返回：这类行无法参与双通道召回。
     */
    listActiveExperienceEmbeddings(type) {
        return this.db.withTx((tx) => listActiveExperienceEmbeddingRows(tx, type));
    }
    /**
     * 批量判重写入：该主体类型的活跃行读取、判重与写入在**同一笔事务**内完成，任一条失败整批回滚。
     * 向量必须在调用本方法**之前**算好随行传入：远程嵌入调用与首次模型加载都不得占用写事务。
     */
    insertChecked(input) {
        return this.db.withTx((tx) => insertExperienceRowsChecked({ tx, now: this.now, ids: this.ids }, input));
    }
    /**
     * 编辑保存：语义字段补丁 + 事务外算好的检索投影与向量一并写入。
     * 必填语义字段被清空即抛可行动错误（经验没有版本，改坏无从回滚）。
     */
    updateFields(id, patch, next) {
        return this.db.withTx((tx) => updateExperienceFieldsRow({ tx, now: this.now, ids: this.ids }, id, patch, next));
    }
    /** 经验归档 / 恢复（状态写入的唯一入口；内容与检索投影一概不动）。 */
    setActive(id, active) {
        return this.db.withTx((tx) => setExperienceActiveRow({ tx, now: this.now, ids: this.ids }, id, active));
    }
}
//# sourceMappingURL=index.js.map
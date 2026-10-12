import type { CatalogDetails, CatalogIndex, CatalogModelSource, CatalogPresetSource } from './types.js';
import type { RoleAssetDetail, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../../shared/asset-types.js';
import type { WorkflowDocument } from '../../shared/graph-model.js';
/**
 * 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。
 *
 * 为什么资产经独立缝而不是直接给 store：资产库是「Active 索引 + 版本行」两层事实的唯一
 * 所有者，工具只需这两层查询；组合清单仍来自宿主数据层（它不是资产事实）。
 * 为什么不含运行态与工具开关：工作流实例与运行事实由运行期编排指令提供——父代理只允许
 * 改当前正在运行的实例，不通过本工具枚举实例；被全局关闭的工具在模型侧表现为
 * UNKNOWN_TOOL，全量关闭清单一来与编排决策无关，二来会吃掉大量上下文预算。
 */
export interface OrgCatalogHost {
    /** 资产库（Active 索引 + 详情召回；资产事实唯一来源）。 */
    assets: {
        listWorkflowAssets(): Promise<WorkflowAssetSummary[]>;
        listRoleAssets(): Promise<RoleAssetSummary[]>;
        getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>;
        getRoleAsset(assetId: string): Promise<RoleAssetDetail | null>;
        /**
         * 可选缝：把工作流资产里钉住的**角色版本行 id** 回溯为角色资产 id。
         * 没有它时骨架仍给 roleVersionId（钉的是哪一版），只是无法标注角色资产名。
         */
        getRoleAssetVersion?: (roleRowId: string) => Promise<RoleAssetDetail | null>;
    };
    /** 组合清单（非资产事实，仍从宿主数据层取）。 */
    listToolCombos(): Promise<unknown[]>;
    /** agent preset 目录（可选缝；缺失按空清单处理）。 */
    listPresets?: () => Promise<CatalogPresetSource[]>;
    /** 模型目录（可选缝；缺失按空清单处理）：节点 provider/model/reasoning 的取值来源。 */
    listModels?: () => Promise<CatalogModelSource[]>;
    /**
     * 当前会话**正在运行**的实例文档（`instance` 召回的取数源；无活跃 run 返回 null）。
     *
     * 为什么必填：实例召回是本工具的一等能力，装配方必须显式给出；缺失是编程错误，
     * 不做「静默降级成没有实例」——那会把装配问题伪装成正常状态（工具层另有断言）。
     * 语义：只暴露 running 的实例，且取最新实例文档。历史 run、暂停中的运行与其他会话的
     * 实例在此缝之外就不可达（不是靠校验拦住，而是判据层没有形状）。
     */
    getActiveRunFlow(sessionId: string): Promise<WorkflowDocument | null>;
}
/**
 * 组装并执行一次勘察（导出供单测直接断言，无需起工具注册表）。
 *
 * @param sessionId 调用者会话；只有实例相关 id（`instance` / `instance#<nodeId>`）需要它。
 */
export declare function executeOrgCatalog(host: OrgCatalogHost, args: Record<string, unknown>, sessionId?: string): Promise<CatalogIndex | CatalogDetails>;
/**
 * 注册 wf_org_catalog（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfOrgCatalog(ctx: {
    get(name: string): unknown;
}, host: OrgCatalogHost): () => void;

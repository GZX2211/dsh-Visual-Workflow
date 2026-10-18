import type { RoleAssetDetail, WorkflowAssetDetail } from '../../shared/asset-types.js';
import type { WorkflowDocument } from '../../shared/graph-model.js';
import type { PatchOp, PatchOpFailure } from './types.js';
/**
 * 角色引用的宿主取数缝。
 *
 * 与 wf_org_catalog 的资产缝同源：真实装配由 ecosystemAdapters 一并提供，单测可注入
 * 最小 fake。`assets` 缺失时引用直接失败（不静默忽略），因为「忽略引用」会让父代理
 * 以为角色配置已写入，实际落成空壳节点。
 */
export interface RoleRefHost {
    assets?: {
        getRoleAsset(assetId: string): Promise<RoleAssetDetail | null>;
        getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>;
        /** 可选缝：把工作流资产钉住的角色版本行 id 回溯为角色资产 id。 */
        getRoleAssetVersion?: (roleRowId: string) => Promise<RoleAssetDetail | null>;
    };
    /** 当前会话正在运行的实例（instance#<node id> 的取数源；无活跃 run 返回 null）。 */
    getActiveRunFlow?: (sessionId: string) => Promise<WorkflowDocument | null>;
}
/** 展开结果：ops 与输入等长；失败索引由 apply 跳过（错误已在此报告）。 */
export interface RoleRefExpansion {
    ops: PatchOp[];
    errors: PatchOpFailure[];
    skipped: Set<number>;
}
/**
 * 展开一批补丁里的角色引用。
 *
 * 返回的 ops 与输入等长：成功项换成完整 data，失败项保持原样并由 skipped 标记，
 * 使调用方的错误索引仍与原批一致（apply 的容错应用逐条跳过失败项）。
 */
export declare function expandRoleRefs(host: RoleRefHost, ops: PatchOp[], sessionId: string): Promise<RoleRefExpansion>;

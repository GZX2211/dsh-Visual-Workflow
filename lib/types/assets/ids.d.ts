/** 随机源：返回 [0, 1) 区间浮点数（缺省 Math.random）。 */
export type RandomSource = () => number;
/** id 生成依赖（可注入，测试确定化）。 */
export interface IdGeneratorDeps {
    /** 随机源（缺省 Math.random）；返回 [0, 1) 区间浮点数。 */
    random?: RandomSource;
    /** 单调序号（缺省自增计数器；跨进程不保证唯一，故与随机源共同参与）。 */
    sequence?: () => number;
}
/** 角色资产逻辑 id 前缀（跨版本不变的身份标识）。 */
export declare const ROLE_ASSET_ID_PREFIX = "role-";
/** 工作流资产逻辑 id 前缀。 */
export declare const WORKFLOW_ASSET_ID_PREFIX = "flow-";
/** 经验 id 前缀。 */
export declare const EXPERIENCE_ID_PREFIX = "ex-";
/**
 * 经验使用事实行 id 前缀。
 * 为什么与经验 id 用不同前缀：使用/评价行是同一条经验的多条历史事实，混用前缀会让磁盘上
 * 无法一眼区分「经验本体」与「它的第 N 次使用」，排障时必须回表才能分辨。
 */
export declare const EXPERIENCE_USAGE_ID_PREFIX = "xus-";
/** 经验评价事实行 id 前缀。 */
export declare const EXPERIENCE_EVALUATION_ID_PREFIX = "xev-";
/** 新建角色资产逻辑 id（`role-` 前缀）。 */
export declare function newRoleAssetId(deps?: IdGeneratorDeps): string;
/** 新建工作流资产逻辑 id（`flow-` 前缀）。 */
export declare function newWorkflowAssetId(deps?: IdGeneratorDeps): string;
/** 新建经验 id（`ex-` 前缀）。 */
export declare function newExperienceId(deps?: IdGeneratorDeps): string;
/** 新建经验使用事实行 id（`xus-` 前缀；由资产库在写入事务内发号）。 */
export declare function newExperienceUsageId(deps?: IdGeneratorDeps): string;
/** 新建经验评价事实行 id（`xev-` 前缀；由资产库在写入事务内发号）。 */
export declare function newExperienceEvaluationId(deps?: IdGeneratorDeps): string;
/**
 * 版本行 id：`<asset_id>@<version_id>`。
 * 工作流版本行按此 id 反向引用角色版本行，因此格式是对外契约的一部分。
 */
export declare function versionRowId(assetId: string, versionId: number): string;

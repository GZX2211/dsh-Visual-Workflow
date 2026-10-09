/**
 * 属性栏展示的六项统计及其顺序（文档 §34）。
 * 取值键直接来自共享契约，`satisfies` 在编译期保证字段确实存在：契约改名时此处报错，
 * 而不是静默读成 undefined 后把「未知」显示成某个数。
 */
export declare const EXPERIENCE_STAT_FIELDS: readonly ["trust", "empiricalValue", "evidenceStrength", "stability", "usedCount", "harmRate"];
export type ExperienceStatField = (typeof EXPERIENCE_STAT_FIELDS)[number];
/** 只读统计行：field 供词典取标签，text 为已格式化的数值文本。 */
export interface ExperienceStatRow {
    field: ExperienceStatField;
    text: string;
}
/** 统计行投影：stats 缺失或任一项不是有限数时返回 null（界面显示「暂无统计」）。 */
export declare function experienceStatRowsOf(stats: unknown): readonly ExperienceStatRow[] | null;

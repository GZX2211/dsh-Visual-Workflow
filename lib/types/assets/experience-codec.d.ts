import type { ExperienceEntry, ExperienceEvaluationScores, ExperienceGenerationPromptEntry, ExperienceType } from "../shared/asset-types.js";
/**
 * 经验主体类型取值（与 DDL 的 CHECK 约束同域，两处必须一致：schema.test.ts 有一条
 * 从 sqlite_master 原文解析取值域并与本常量比对的门禁，防止两边各自漂移）。
 *
 * 为什么导出：取值域属对外契约（列表过滤、召回过滤、工具 enum 都按它取值），
 * 调用方与门禁必须引用同一本体，而不是各写一份字面量。
 */
export declare const EXPERIENCE_TYPE_VALUES: readonly ExperienceType[];
/**
 * 列值 → 主体类型。
 * CHECK 约束保证取值合法，非法值只在库被外部改坏时出现（含已退役的 'team'）；此时回落到
 * agent 而不是抛错，保证界面列表与召回读不会因单行损坏整次失败（损坏只影响该行的分类精度）。
 */
export declare function asExperienceType(value: unknown): ExperienceType;
/** JSON 数组列读取（缺失、非法 JSON 或非数组一律读成空数组）。 */
export declare function parseJsonArray(value: unknown): string[];
/** JSON 数组列写入（数组字段的磁盘形态固定为字符串数组，空值落 '[]' 而非 NULL）。 */
export declare function toJsonArray(value: unknown): string;
/** 双通道向量的解码结果（各自独立判定，缺失或不可用为 null）。 */
export interface RowEmbeddings {
    taskEmbedding: Float64Array | null;
    decisionEmbedding: Float64Array | null;
}
/**
 * 行内两条向量独立解码，共用同一记录维度。
 * 为什么不用一个「整体可用」布尔：判重只需要决策侧向量，召回要求两侧都可用，
 * 两个消费方的需求不同，合并判定会让「只有一侧可用」的行在一处可用、另一处凭空消失。
 */
export declare function decodeRowEmbeddings(row: Record<string, unknown>): RowEmbeddings;
/**
 * 经验行 → 契约条目。
 * 向量元信息与「两条向量都可用」同真同假：条目只声明向量元信息而不带向量本身，
 * 若元信息留在一条不可用的行上，调用方会据此认为该行可参与语义召回。
 */
export declare function experienceRowToEntry(row: Record<string, unknown>): ExperienceEntry;
/** 经验生成 Prompt 行 → 契约条目。 */
export declare function experiencePromptRowToEntry(row: Record<string, unknown>): ExperienceGenerationPromptEntry;
/**
 * 评价行 → 四维评分（聚合器的输入）。
 *
 * 为什么直接按契约收窄而不再校验取值域：`fit_score` 等列的 CHECK 约束已经把取值锁在锚点集合内，
 * 而校验清单的唯一本体在经验域；资产库再造一份锚点表只会变成第三处口径。
 *
 * 注：四列均为 `NOT NULL` + `CHECK(IN …)`，故 `row.*` 在合规库上不可能为 null/undefined，
 * `Number(null) === 0` 这条退化路径读不到——真正的形状守卫由 DDL 承担。
 */
export declare function evaluationScoresFromRow(row: Record<string, unknown>): ExperienceEvaluationScores;

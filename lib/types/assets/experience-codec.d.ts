import type { ExperienceEntry, ExperienceGenerationPromptEntry, ExperienceType } from "../shared/asset-types.js";
/**
 * 列值 → 主体类型。
 * CHECK 约束保证取值合法，非法值只在库被外部改坏时出现；此时回落到 agent 而不是抛错，
 * 保证界面列表与召回读不会因单行损坏整次失败（损坏只影响该行的分类精度）。
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

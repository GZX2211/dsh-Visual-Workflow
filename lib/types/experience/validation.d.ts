import type { ExperienceInsertDraft, ExperiencePatch, ExperienceType } from "../shared/asset-types.js";
/** 校验通过的经验语义核心（九个字段，已空白归一化）。 */
export interface ExperienceSemanticFields {
    responsibility: string;
    taskType: string;
    decisionDomain: string;
    situation: string;
    trigger: string;
    principle: string;
    recommendedAction: string;
    exclusions: string[];
    evidence: string[];
}
/** 校验并归一化后的保存补丁：`patch` 交给持久化端口写入，`fields` 是合并后的完整语义核心。 */
export interface ValidatedExperiencePatch {
    patch: ExperiencePatch;
    fields: ExperienceSemanticFields;
}
/**
 * 校验并归一化模型提交的候选。
 *
 * 批内「九个语义字段完全相同」判为调用错误：这是模型在同一次提交里自我复制，属可修正的
 * 调用问题；相近但不相同的经验由 0.8 语义判重跳过（那是内容判断，不是调用判断）。
 */
export declare function validateExperienceCandidates(payload: unknown, expectedType: ExperienceType): ExperienceInsertDraft[];
/**
 * 校验保存补丁并给出合并后的完整语义核心。
 * `undefined` = 本次不改；`null` 只允许用于数组字段（清空）；必填文本被清空即拒绝
 * ——经验没有版本，改坏无从回滚。
 */
export declare function validateExperiencePatch(current: ExperienceSemanticFields, patch: unknown): ValidatedExperiencePatch;

import type { ExperienceType } from '../../shared/asset-types.js';
/**
 * 批量映射候选（顺序即语义，不做归并/去重——那是 domain 的重复闸门职责）。
 * 非对象元素原样返回，由 domain 报出可诊断的校验错误。
 */
export declare function mapExperienceCandidates(raw: unknown[], type: ExperienceType): unknown[];

import type { OrgMeta } from '../shared/types.js';
import type { OrgUsage } from './org-meta-usage.js';
import { type GraphIssue } from './invariants-types.js';
/**
 * 元参数硬护栏判定：返回稳定 code 的 issue 列表；空数组 = 通过。
 * 纯函数：入参不变则输出不变（不读时钟/随机源）。
 */
export declare function metaLimitIssues(meta: OrgMeta, usage: OrgUsage): GraphIssue[];

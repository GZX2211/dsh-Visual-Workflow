import type { ExperienceDraft, ExperienceEntry, ExperienceIndexEntry, ExperiencePatch } from '../shared/asset-types.js';
import type { AssetTxContext } from './db.js';
import { type IdGeneratorDeps } from './ids.js';
/** 经验列表/索引查询的默认上限保护（避免无上限全表拉取；界面列表与召回索引共用）。 */
export declare const EXPERIENCE_INDEX_MAX_LIMIT = 1000;
/** 端口运行环境：时钟与 id 生成由 AssetStore 注入。 */
export interface ExperiencePortContext {
    tx: AssetTxContext;
    now: () => number;
    ids: IdGeneratorDeps;
}
/** 批量插入结果（skipped 回传原因，便于调用方区分「空字段」与「重复」）。 */
export interface ExperienceInsertResult {
    inserted: ExperienceEntry[];
    skipped: Array<{
        insight: string;
        reason: string;
    }>;
}
/** 单条经验行插入（列顺序与 DDL 一致；返回经验 id）。 */
export declare function insertExperienceRow(ctx: ExperiencePortContext, draft: ExperienceDraft, reviewedAt: number): string;
/**
 * 批量插入（算法 I）：逐条判空与判重，跳过的回传原因，入库的读回完整条目。
 * 批内去重同样生效：同一批里出现两条相同 task_type + insight 时只入库第一条。
 */
export declare function insertExperienceDrafts(ctx: ExperiencePortContext, drafts: ExperienceDraft[], reviewedAt: number): ExperienceInsertResult;
/** 已存在同 task_type + insight 的经验（去重判据）。 */
export declare function experienceExists(ctx: AssetTxContext, taskType: string, insight: string): boolean;
/**
 * 索引查询（召回面：只取活跃经验；按 created_at 倒序；id 升序兜底保证同毫秒写入的顺序确定）。
 * 归档过滤留在本查询内，而不是交给调用方各自过滤：召回面的定义只允许一处，
 * 两处各判一次必然在「归档经验还算不算可召回」上分叉。
 */
export declare function listExperienceIndexRows(ctx: AssetTxContext, limit: number): ExperienceIndexEntry[];
/**
 * 经验列表（界面数据源：活跃与已归档一并返回，条目自带 active 标记）。
 *
 * 为什么不像资产那样拆成两份列表：资产拆分的理由是「活跃列表即父代理召回面」，
 * 分开返回让召回面在类型上可见；经验的召回面是 listExperienceIndexRows（另一条查询），
 * 界面列表只服务管理操作，拆两份反而要在两处各判一次状态。
 */
export declare function listExperienceRows(ctx: AssetTxContext, limit: number): ExperienceEntry[];
/** 单条经验（无匹配返回 null）。 */
export declare function readExperienceRow(ctx: AssetTxContext, id: string): ExperienceEntry | null;
/**
 * 就地更新可编辑字段（无版本语义：不产生历史行，只刷新 updated_at）。
 *
 * `undefined` = 本次不改，`null` = 清空：两者语义不同，因此不能用 `??` 合并——
 * 否则「清空证据」会被当成「不改证据」而静默失败。
 * 必填字段（task_type / task_context / insight）被清空即拒绝：经验没有版本，
 * 改坏了无从回滚，宁可让用户看到可行动的错误。
 */
export declare function updateExperienceRow(ctx: ExperiencePortContext, id: string, patch: ExperiencePatch): ExperienceEntry;
/**
 * 状态切换（归档 / 恢复）：只改 is_active 与 updated_at，内容字段一律不动。
 * 返回切换后的条目；id 不存在抛「经验不存在」。
 */
export declare function setExperienceActiveRow(ctx: ExperiencePortContext, id: string, active: boolean): ExperienceEntry;
/**
 * 详情查询（保持入参顺序，命中不到的略过）。
 * `activeOnly` = 召回面语义：已归档经验不得被父代理召回（目录按 id 召回时同样过滤），
 * 因此归档 id 表现为「查不到」而不是「返回归档内容」。
 */
export declare function readExperiencesByIds(ctx: AssetTxContext, ids: string[], options?: {
    activeOnly?: boolean;
}): ExperienceEntry[];
/** 空字段判定（trim 后为空即视为未提供）。 */
export declare function emptyFieldReason(draft: ExperienceDraft): string | null;

import type { ExperienceEntry, ExperienceInsertCheckedInput, ExperiencePatch, ExperienceRetrievalUpdate, ExperienceType } from "../shared/asset-types.js";
import type { AssetTxContext } from "./db.js";
import type { IdGeneratorDeps } from "./ids.js";
/**
 * 界面经验列表一次最多返回的条数。
 * 为什么需要上限：列表服务于人工管理，不做无上限全表拉取；召回面另有向量读端口，
 * 两者上限语义不同，不可共用一个常量。
 */
export declare const EXPERIENCE_LIST_MAX_LIMIT = 1000;
/** 端口运行环境：时钟与 id 生成由 AssetStore 注入（测试可确定化）。 */
export interface ExperiencePortContext {
    tx: AssetTxContext;
    now: () => number;
    ids: IdGeneratorDeps;
}
/**
 * 批量判重写入结果。
 * `skipped` 同时回传原因与决策侧检索文本，使调用方能区分「字段缺失」与「重复」；
 * 重复时附带对上的既有行 id，便于界面直接跳转。
 */
export interface ExperienceInsertCheckedResult {
    inserted: ExperienceEntry[];
    skipped: Array<{
        reason: string;
        experienceId?: string;
        decisionRetrievalText: string;
    }>;
}
/**
 * 活跃向量读盘结果（召回输入）。
 * 双通道同时返回：召回要对任务侧与决策侧各取 topK 再合并，两条向量本来就在同一行，
 * 一次读盘即可，拆成两次查询只会多一遍全表扫描。
 */
export interface ExperienceEmbeddingRow {
    id: string;
    taskRetrievalText: string;
    taskEmbedding: Float64Array;
    decisionRetrievalText: string;
    decisionEmbedding: Float64Array;
}
/** 批量判重写入（调用方需已在本函数所在事务之外算好向量）。 */
export declare function insertExperienceRowsChecked(ctx: ExperiencePortContext, input: ExperienceInsertCheckedInput): ExperienceInsertCheckedResult;
/** 界面经验列表（活跃与归档一并返回；条目自带 active 标记）。 */
export declare function listExperienceRows(ctx: AssetTxContext, limit: number): ExperienceEntry[];
/** 单条经验（无匹配返回 null）。 */
export declare function readExperienceRow(ctx: AssetTxContext, id: string): ExperienceEntry | null;
/**
 * 按 id 读经验（保持入参顺序，命中不到的略过）。
 * `activeOnly` = 召回面语义：归档经验不得被召回，因此表现为「查不到」而不是返回内容。
 */
export declare function readExperiencesByIds(ctx: AssetTxContext, ids: string[], options?: {
    activeOnly?: boolean;
}): ExperienceEntry[];
/**
 * 某主体类型的活跃向量（召回输入）。
 * 双通道缺一即跳过该行：召回要两侧都能算分，只有一条向量的行无法参与合并，
 * 与其在半程报错，不如从读盘起就把它排除（损坏数据只让该行失去语义召回能力）。
 */
export declare function listActiveExperienceEmbeddingRows(ctx: AssetTxContext, type: ExperienceType): ExperienceEmbeddingRow[];
/**
 * 状态切换（归档 / 恢复）：只改 is_active 与 updated_at，内容与检索投影一概不动。
 * 经验没有版本，归档是唯一的状态事实，因此这里也是状态写入的唯一入口。
 */
export declare function setExperienceActiveRow(ctx: ExperiencePortContext, id: string, active: boolean): ExperienceEntry;
/**
 * 编辑保存：语义字段补丁 + 事务外算好的检索投影与向量一并写入，只刷新 updated_at。
 *
 * `undefined` = 本次不改，`null` = 清空：两者语义不同，因此不能用 `??` 合并——
 * 否则「清空排除条件」会被当成「不改排除条件」而静默失败。
 * 必填字符串字段被清空即拒绝：经验没有版本，改坏了无从回滚，宁可让用户看到可行动的错误。
 */
export declare function updateExperienceFieldsRow(ctx: ExperiencePortContext, id: string, patch: ExperiencePatch, next: ExperienceRetrievalUpdate): ExperienceEntry;

import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js';
import type { OrgBudget, OrgMeta, RunSnapshot } from '../shared/types.js';
import type { OrgUsage } from './org-meta-usage.js';
/** 上限类字段的缺省值（缺省即硬护栏生效；下限/软约束字段缺省即不约束）。 */
export declare const ORG_META_LIMIT_DEFAULTS: {
    /** 可执行节点数上限（自主编排方案 §6.4 示例：12）。 */
    readonly nodeMax: 12;
    /** 协作组数量上限（示例：3）。 */
    readonly groupMax: 3;
    /** 组内人数上限（示例：5）。 */
    readonly membersMax: 5;
};
/**
 * 归一化硬上限（防手改 JSON/畸形输入把预算写成天文数字）：
 * 仅作「夹取安全网」，不是业务约束——业务约束由用户在模板/实例 meta 中自定。
 */
export declare const ORG_META_NORMALIZE_CAPS: {
    /** 可执行节点数上限的安全网。 */
    readonly nodeMax: 200;
    /** 协作组数量上限的安全网。 */
    readonly groupMax: 50;
    /** 组内人数上限的安全网（画布 UI 既有上限为 8，此处放宽）。 */
    readonly membersMax: 50;
    /** 并行分支上限的安全网。 */
    readonly parallelBranchMax: 50;
    /** 闸门次数上限的安全网。 */
    readonly milestoneMax: 50;
    /** 单轮改图 op 上限的安全网。 */
    readonly patchOpsMax: 200;
    /** 每节点协作消息上限的安全网。 */
    readonly askPerNodeMax: 100;
};
/**
 * 规范化元参数：逐字段类型守卫 + 数值夹取 + 区间自洽（min > max 时丢弃 min）。
 * 未知字段一律丢弃；非法值按「未配置」处理（不抛错——磁盘 JSON 可能被手改）。
 */
export declare function normalizeOrgMeta(input: unknown): OrgMeta;
/**
 * 三层装配的前两层合并（D-13）：`effective = { ...template.meta, ...instance.meta }`。
 * 覆盖语义为**浅合并（后者优先）**——嵌套对象 `failurePolicy` 整体替换而非深合并，
 * 因为它的业务语义固定（D-22），深合并没有意义且会增加「哪层生效」的歧义。
 * 任一来源为空对象/undefined 即跳过（缺省 = 不约束）。
 */
export declare function effectiveOrgMeta(...sources: Array<OrgMeta | null | undefined>): OrgMeta;
/**
 * 读取文档（模板/实例）声明的元参数：规范化后返回。
 * 文档缺 meta 时按空对象处理（= 不约束），旧数据零行为变化。
 */
export declare function metaOfDocument(doc: Pick<WorkflowDocument | WorkflowTemplate, 'meta'> | null | undefined): OrgMeta;
/**
 * 组织预算（生效值 + 已用量 → 剩余量）。
 * 语义：上限字段为 0 表示「不限制」，对应剩余量为 null（提示词据此输出「不限」）。
 */
export declare function orgBudgetOf(meta: OrgMeta, usage: OrgUsage): OrgBudget;
/**
 * 冻结元参数（D-13 第三层）：startRun 时把有效值副本写入快照。
 * 未配置（空对象/undefined）时不写字段，保持既有快照形状（旧数据兼容、零行为变化）。
 * 写入的是**副本**：此后修改模板/实例 meta 不影响本次运行的冻结预算。
 */
export declare function freezeOrgMeta(snapshot: RunSnapshot, meta: OrgMeta | null | undefined): void;

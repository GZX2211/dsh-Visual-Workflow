/**
 * 元参数（OrgMeta）：父代理自主编排的可调节参数（自主编排方案 §6.4 七组字段）。
 * 全部字段可选——缺省即「不约束」，既有模板/实例不写 meta 时行为与此前完全一致。
 * 归一化会丢弃未知字段并把数值收敛到合理区间（见 graph/org-meta.ts）。
 */
export interface OrgMeta {
    /** 可执行节点数下限（提示级，产出 metaBelowMin 警告，不阻断落盘）。 */
    nodeMin?: number;
    /** 可执行节点数上限（硬护栏：超出 → metaLimitExceeded）。 */
    nodeMax?: number;
    /** 协作组数量上限（硬护栏）。 */
    groupMax?: number;
    /** 组内人数下限（提示级）。 */
    membersMin?: number;
    /** 组内人数上限（硬护栏：任一超限即报）。 */
    membersMax?: number;
    /** 并行分支数上限（硬护栏：无环分层后单层内可执行单元数）。 */
    parallelBranchMax?: number;
    /** 规划自由度：只能选现成角色模板 / 允许派生新角色（软约束，提示词注入）。 */
    planFreedom?: 'templates-only' | 'allow-new-role';
    /** 角色提示词来源：用户模板 / 代理生成（软约束，提示词注入）。 */
    promptSource?: 'user-template' | 'agent-generated';
    /** 角色粒度：宽角色 / 单一职责（软约束，服务「最少子代理数」目标）。 */
    roleGranularity?: 'broad' | 'narrow';
    /** 同角色多实例（proxy 复用）是否允许（软约束）。 */
    roleReuse?: 'forbid' | 'allow';
    /** 父代理闸门次数上限（**不含首次编排**，D-21；超限 → WF_MILESTONE_INVALID）。 */
    milestoneMax?: number;
    /** 允许触发的介入方式（软约束；本阶段仅作预算展示，不实现触发机制）。 */
    interveneTrigger?: Array<'user' | 'threshold' | 'milestone'>;
    /** 单轮改图 op 上限（硬护栏：超过 → metaLimitExceeded）。 */
    patchOpsMax?: number;
    /** 每节点最多发多少条协作消息（软约束，提示词注入）。 */
    askPerNodeMax?: number;
    /** 跨组通信策略：经父代理转发 / 禁止（L-01 占位：机制本轮不实现）。 */
    crossGroupPolicy?: 'via-parent' | 'forbid';
    /** 失败升级策略（语义固定；缺省即本默认值）。 */
    failurePolicy?: {
        retry: 1;
        thenEscalate: true;
        askUserOnUnresolved: true;
    };
    /** 拓扑禁令开关：命中的检查器 code（如 flowCycle / orphanNode）→ 提升为 error 级。 */
    forbiddenShapes?: string[];
    /** 命名约定（正则或前缀说明文本；未满足 → namingConvention 警告）。 */
    namingConvention?: string | null;
    /** 评估配置占位（后期实现，本阶段不解析）。 */
    eval?: Record<string, unknown>;
    /** 重组配置占位（后期实现，本阶段不解析）。 */
    restructure?: Record<string, unknown>;
}
/**
 * 组织预算（元参数生效值 + 已用量 → 剩余量）。
 * 注入形态遵循「给剩余量而非上限」（自主编排方案 §6.4）：父代理看到的是「还能用多少」。
 */
export interface OrgBudget {
    /** 可执行节点（agent/parent/group）已用数。 */
    nodeUsed: number;
    /** 可执行节点上限（0 = 不限制）。 */
    nodeMax: number;
    /** 可执行节点剩余（无上限时为 null）。 */
    nodeRemaining: number | null;
    /** 协作组已用数。 */
    groupUsed: number;
    /** 协作组上限（0 = 不限制）。 */
    groupMax: number;
    /** 协作组剩余。 */
    groupRemaining: number | null;
    /** 单个协作组内人数上限（0 = 不限制）。 */
    membersMax: number;
    /** 单列并行分支上限（0 = 不限制）。 */
    parallelBranchMax: number;
    /** 父代理闸门已用次数（不含首次编排，D-21）。 */
    milestoneUsed: number;
    /** 父代理闸门上限（0 = 不限制）。 */
    milestoneMax: number;
    /** 父代理闸门剩余（无上限时为 null）。 */
    milestoneRemaining: number | null;
    /** 单轮改图 op 上限（0 = 不限制）。 */
    patchOpsMax: number;
    /** 单轮改图 op 剩余。 */
    patchOpsRemaining: number | null;
    /** 禁用拓扑清单（检查器 code）。 */
    forbiddenShapes: string[];
    /** 命名约定（null = 未约定）。 */
    namingConvention: string | null;
}

import type { ExperienceDecisionEffectAnchor, ExperienceScoreAnchor, ExperienceType, NeutralStatsValues } from "../shared/asset-types.js";
/** 经验主体类型取值域（顺序稳定，用于错误消息与遍历）。 */
export declare const EXPERIENCE_TYPES: readonly ExperienceType[];
/** 单次提交的候选上限（模型一次产出过多候选说明没有做取舍，且会放大写入事务）。 */
export declare const MAX_CANDIDATES_PER_CALL = 8;
/** 判重阈值：同类型活跃经验的决策向量相似度达到该值即视为近似重复。 */
export declare const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
/** 召回候选数的默认值（= MMR 之后的最终返回条数）。 */
export declare const DEFAULT_RECALL_TOP_K = 15;
/** 召回候选数上限（候选是给模型判断用的摘要，过多只会挤占上下文）。 */
export declare const MAX_RECALL_TOP_K = 50;
/**
 * 语义候选池大小（Stage 1 候选生成，§16）。
 *
 * 为什么与最终返回条数分开：检索阶段的任务是「别漏掉潜在相关的经验」，
 * 而信任重排与 MMR 只允许在**这个池内**调整名次（§15 / §17）；
 * 池子若跟随调用方的 topK 伸缩，低相关高信任的经验就能靠缩小池子挤进前列。
 */
export declare const CANDIDATE_POOL_SIZE = 30;
/**
 * 中性先验强度（§10.1）：首次评价不能立刻决定长期价值。
 * 语义：相当于先验里已经有 3 单位、均值为 0 的样本。
 */
export declare const PRIOR_STRENGTH = 3;
/** 证据强度饱和尺度（§11）：evidence_strength = 1 - exp(-n_eff / 8)。 */
export declare const EVIDENCE_STRENGTH_SCALE = 8;
/** 单次评价权重的因果下限（§9.1）：C=0 仍保留 25% 最小统计权重，不完全丢弃。 */
export declare const CAUSAL_WEIGHT_FLOOR = 0.25;
/** 单次评价权重的因果跨度（§9.1）：evaluation_weight = F × (0.25 + 0.75 × C)。 */
export declare const CAUSAL_WEIGHT_SPAN = 0.75;
/** 正向收益的信息系数基准（§9.2）：positive_effect = D × (0.5 + 0.5 × I)。 */
export declare const EFFECT_INFO_BASE = 0.5;
/** 正向收益的信息系数跨度（§9.2）。 */
export declare const EFFECT_INFO_SPAN = 0.5;
/** 稳定性对质量信号的贡献（§14）：quality = value × evidence × (0.5 + 0.5 × stability)。 */
export declare const STABILITY_SIGNAL_BASE = 0.5;
/** 稳定性对质量信号的贡献跨度（§14）。 */
export declare const STABILITY_SIGNAL_SPAN = 0.5;
/** 信任度的中性中心（§14）：0.5 = 没有足够证据，当前保持中性。 */
export declare const TRUST_CENTER = 0.5;
/** 信任度的振幅（§14）：trust = 0.5 + 0.45 × quality_signal ∈ [0.05, 0.95]。 */
export declare const TRUST_AMPLITUDE = 0.45;
/** 召回时信任修正的最大幅度（§17）：adjusted = sim01 × (1 + β × quality_signal)，β = 0.20。 */
export declare const TRUST_ADJUSTMENT_BETA = 0.2;
/**
 * 语义硬保护阈值（§20）：默认关闭。
 *
 * 为什么默认关闭而不是先拍一个阈值：真正的相似度分布要由 benchmark 观察后再定，
 * 未经验证的绝对值会把「低相关但确有价值」的经验永久挡在门外，且无从发现。
 */
export declare const SEMANTIC_FLOOR: number | null;
/** MMR 的相关性权重（§19）。 */
export declare const MMR_RELEVANCE_WEIGHT = 0.4;
/** MMR 的多样性权重（§19）：V1 继续保留偏向高多样性的行为。 */
export declare const MMR_DIVERSITY_WEIGHT = 0.6;
/** 适用性 / 信息增益 / 因果置信度的合法取值（顺序稳定，用于错误消息与遍历）。 */
export declare const SCORE_ANCHORS: readonly ExperienceScoreAnchor[];
/** 决策效果的合法取值（顺序稳定，用于错误消息与遍历）。 */
export declare const DECISION_EFFECT_ANCHORS: readonly ExperienceDecisionEffectAnchor[];
/**
 * 锚点比较容差。
 * 为什么需要：取值来自模型侧的 JSON 数字，跨语言/跨序列化往返后不应因 1e-17 级误差被拒；
 * 容差同时必须远小于最小锚点间距（0.25），否则会把非法值误判为合法锚点。
 */
export declare const SCORE_ANCHOR_TOLERANCE = 1e-9;
/** 运行期判据：数值是否命中五级锚点之一。 */
export declare function isScoreAnchor(value: unknown): value is ExperienceScoreAnchor;
/** 运行期判据：数值是否命中决策效果锚点之一。 */
export declare function isDecisionEffectAnchor(value: unknown): value is ExperienceDecisionEffectAnchor;
/** 单次反馈可提交的评价条数上限（与候选上限同源：一次复盘不该产出无取舍的长列表）。 */
export declare const MAX_EVALUATIONS_PER_CALL = 8;
/** 评价证据说明的长度上限（与磁盘 TEXT 列的业务护栏一致）。 */
export declare const EVALUATION_EVIDENCE_LIMIT = 2000;
/**
 * 统计行的中性初值（§33 冷启动：n_eff = 0 时 quality_signal = 0、trust = 0.5）。
 *
 * 为什么由域层提供而不是资产库内置：这些值是业务口径，资产库只负责「首次建立统计行时使用
 * 调用方给的口径」，否则资产库就成了第二处公式本体。
 */
export declare const NEUTRAL_STATS: NeutralStatsValues;
/**
 * 字段与数组护栏（与磁盘列宽一致；situation 等长文本列在 SQLite 为 TEXT，上限取业务护栏值）。
 * `total` 按九个语义字段的字符数之和计（数组按元素文本计，不含分隔符与系统生成的检索文本）。
 */
export declare const FIELD_LIMITS: {
    readonly responsibility: 255;
    readonly decisionDomain: 255;
    readonly taskType: 128;
    readonly situation: 2000;
    readonly trigger: 2000;
    readonly principle: 2000;
    readonly recommendedAction: 2000;
    readonly arrayElement: 500;
    readonly arrayLength: 8;
    readonly total: 8000;
};
/**
 * 初始化状态表的会话数上界。
 *
 * 为什么需要上界：状态键含会话，长驻宿主进程里会话只增不减；上界触及时按最早会话逐出，
 * 被逐出的会话若仍在运行，下一次初始化会重新标记（幂等），只是需要多一次初始化调用。
 */
export declare const MAX_INITIALIZED_SESSIONS = 256;
/** 空白归一化：去首尾空白并把连续空白折叠为单个空格（含换行与制表）。 */
export declare function normalizeWhitespace(value: string): string;
/** 运行期类型守卫：取值是否属于经验主体类型域。 */
export declare function isExperienceType(value: unknown): value is ExperienceType;

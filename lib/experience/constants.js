// src/host/experience/constants.ts
//
// Experience 域的全部上限、取值域与文本归一化规则的唯一承接点。
//
// 为什么集中在一处：上限同时约束三件事——模型侧 Prompt 允许产出的长度、校验层接受的长度、
// 以及磁盘列宽。三处各自写死数字必然漂移，漂移的表现是「模型按 Prompt 生成却被拒绝」这种
// 无法自解释的失败，因此所有数字只在本文件出现一次，其它模块引用本体。
/**
 * 三类主体的运行期清单（唯一本体）。
 *
 * 为什么用「键为联合类型的表 + 取键」而不是字面量数组：表的键少一个（联合类型新增取值）
 * 或多一个（拼错）都会编译失败，从而把「类型层与运行期取值域双向穷尽」变成编译期事实；
 * 反过来用数组则无法发现联合类型新增取值。
 */
const EXPERIENCE_TYPE_TABLE = {
    agent: true,
    team: true,
    orchestrator: true,
};
/** 经验主体类型取值域（顺序稳定，用于错误消息与遍历）。 */
export const EXPERIENCE_TYPES = Object.keys(EXPERIENCE_TYPE_TABLE);
/** 单次提交的候选上限（模型一次产出过多候选说明没有做取舍，且会放大写入事务）。 */
export const MAX_CANDIDATES_PER_CALL = 8;
/** 判重阈值：同类型活跃经验的决策向量相似度达到该值即视为近似重复。 */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
/** 召回候选数的默认值（= MMR 之后的最终返回条数）。 */
export const DEFAULT_RECALL_TOP_K = 15;
/** 召回候选数上限（候选是给模型判断用的摘要，过多只会挤占上下文）。 */
export const MAX_RECALL_TOP_K = 50;
/**
 * 语义候选池大小（Stage 1 候选生成，§16）。
 *
 * 为什么与最终返回条数分开：检索阶段的任务是「别漏掉潜在相关的经验」，
 * 而信任重排与 MMR 只允许在**这个池内**调整名次（§15 / §17）；
 * 池子若跟随调用方的 topK 伸缩，低相关高信任的经验就能靠缩小池子挤进前列。
 */
export const CANDIDATE_POOL_SIZE = 30;
// ---------------------------------------------------------------------------
// 经验评价闭环公式参数（§9～§19）
// ---------------------------------------------------------------------------
// 为什么全部集中在此：这些参数会被单独调整（§25 要求改参数后能靠 rebuild 重放历史），
// 散落在各算法文件里就无法一眼看到「当前口径」是什么。
/**
 * 中性先验强度（§10.1）：首次评价不能立刻决定长期价值。
 * 语义：相当于先验里已经有 3 单位、均值为 0 的样本。
 */
export const PRIOR_STRENGTH = 3;
/** 证据强度饱和尺度（§11）：evidence_strength = 1 - exp(-n_eff / 8)。 */
export const EVIDENCE_STRENGTH_SCALE = 8;
/** 单次评价权重的因果下限（§9.1）：C=0 仍保留 25% 最小统计权重，不完全丢弃。 */
export const CAUSAL_WEIGHT_FLOOR = 0.25;
/** 单次评价权重的因果跨度（§9.1）：evaluation_weight = F × (0.25 + 0.75 × C)。 */
export const CAUSAL_WEIGHT_SPAN = 0.75;
/** 正向收益的信息系数基准（§9.2）：positive_effect = D × (0.5 + 0.5 × I)。 */
export const EFFECT_INFO_BASE = 0.5;
/** 正向收益的信息系数跨度（§9.2）。 */
export const EFFECT_INFO_SPAN = 0.5;
/** 稳定性对质量信号的贡献（§14）：quality = value × evidence × (0.5 + 0.5 × stability)。 */
export const STABILITY_SIGNAL_BASE = 0.5;
/** 稳定性对质量信号的贡献跨度（§14）。 */
export const STABILITY_SIGNAL_SPAN = 0.5;
/** 信任度的中性中心（§14）：0.5 = 没有足够证据，当前保持中性。 */
export const TRUST_CENTER = 0.5;
/** 信任度的振幅（§14）：trust = 0.5 + 0.45 × quality_signal ∈ [0.05, 0.95]。 */
export const TRUST_AMPLITUDE = 0.45;
/** 召回时信任修正的最大幅度（§17）：adjusted = sim01 × (1 + β × quality_signal)，β = 0.20。 */
export const TRUST_ADJUSTMENT_BETA = 0.2;
/**
 * 语义硬保护阈值（§20）：默认关闭。
 *
 * 为什么默认关闭而不是先拍一个阈值：真正的相似度分布要由 benchmark 观察后再定，
 * 未经验证的绝对值会把「低相关但确有价值」的经验永久挡在门外，且无从发现。
 */
export const SEMANTIC_FLOOR = null;
/** MMR 的相关性权重（§19）。 */
export const MMR_RELEVANCE_WEIGHT = 0.4;
/** MMR 的多样性权重（§19）：V1 继续保留偏向高多样性的行为。 */
export const MMR_DIVERSITY_WEIGHT = 0.6;
// ---------------------------------------------------------------------------
// 评分锚点（§4～§6）
// ---------------------------------------------------------------------------
/**
 * 五级语义锚点表（键即运行期判据本体；Record 使类型联合与取值域双向穷尽）。
 * `1` 与 `0` 是整数键，`Object.keys` 不会保持书写顺序，因此遍历顺序用下方显式数组，
 * 判据一律走本表查询（与 EXPERIENCE_TYPE_TABLE 同范式）。
 */
const SCORE_ANCHOR_TABLE = {
    0: true,
    0.25: true,
    0.5: true,
    0.75: true,
    1: true,
};
/** 决策效果锚点表（唯一跨零维度）。 */
const DECISION_EFFECT_ANCHOR_TABLE = {
    '-1': true,
    '-0.5': true,
    0: true,
    0.5: true,
    1: true,
};
/** 适用性 / 信息增益 / 因果置信度的合法取值（顺序稳定，用于错误消息与遍历）。 */
export const SCORE_ANCHORS = [0, 0.25, 0.5, 0.75, 1];
/** 决策效果的合法取值（顺序稳定，用于错误消息与遍历）。 */
export const DECISION_EFFECT_ANCHORS = [-1, -0.5, 0, 0.5, 1];
/**
 * 锚点比较容差。
 * 为什么需要：取值来自模型侧的 JSON 数字，跨语言/跨序列化往返后不应因 1e-17 级误差被拒；
 * 容差同时必须远小于最小锚点间距（0.25），否则会把非法值误判为合法锚点。
 */
export const SCORE_ANCHOR_TOLERANCE = 1e-9;
/** 运行期判据：数值是否命中五级锚点之一。 */
export function isScoreAnchor(value) {
    return typeof value === 'number' && matchesAnchor(value, Object.keys(SCORE_ANCHOR_TABLE));
}
/** 运行期判据：数值是否命中决策效果锚点之一。 */
export function isDecisionEffectAnchor(value) {
    return typeof value === 'number' && matchesAnchor(value, Object.keys(DECISION_EFFECT_ANCHOR_TABLE));
}
/** 容差命中判定（键为十进制字面量文本，逐个转数比较，避免浮点键查找失真）。 */
function matchesAnchor(value, keys) {
    if (!Number.isFinite(value))
        return false;
    return keys.some((key) => Math.abs(Number(key) - value) <= SCORE_ANCHOR_TOLERANCE);
}
/** 单次反馈可提交的评价条数上限（与候选上限同源：一次复盘不该产出无取舍的长列表）。 */
export const MAX_EVALUATIONS_PER_CALL = 8;
/** 评价证据说明的长度上限（与磁盘 TEXT 列的业务护栏一致）。 */
export const EVALUATION_EVIDENCE_LIMIT = 2000;
/**
 * 统计行的中性初值（§33 冷启动：n_eff = 0 时 quality_signal = 0、trust = 0.5）。
 *
 * 为什么由域层提供而不是资产库内置：这些值是业务口径，资产库只负责「首次建立统计行时使用
 * 调用方给的口径」，否则资产库就成了第二处公式本体。
 */
export const NEUTRAL_STATS = {
    effectiveSampleCount: 0,
    usedCount: 0,
    fitMean: 0,
    empiricalValue: 0,
    variance: 0,
    stability: 1,
    evidenceStrength: 0,
    harmCount: 0,
    harmRate: 0,
    harmSeverity: 0,
    qualitySignal: 0,
    trust: TRUST_CENTER,
};
/**
 * 字段与数组护栏（与磁盘列宽一致；situation 等长文本列在 SQLite 为 TEXT，上限取业务护栏值）。
 * `total` 按九个语义字段的字符数之和计（数组按元素文本计，不含分隔符与系统生成的检索文本）。
 */
export const FIELD_LIMITS = {
    responsibility: 255,
    decisionDomain: 255,
    taskType: 128,
    situation: 2000,
    trigger: 2000,
    principle: 2000,
    recommendedAction: 2000,
    arrayElement: 500,
    arrayLength: 8,
    total: 8000,
};
/**
 * 字段的「提示词预算」（模型侧 Prompt 的引导长度，不是校验闸门）。
 *
 * 与 FIELD_LIMITS 的分工：上限是「超过即拒绝」的硬护栏，取自磁盘列宽与业务裁决；预算回答的是
 * 另一个问题——一条经验写多长才仍然可检索、可读、不挤占召回上下文。两者同处本文件，因为
 * 「模型侧 Prompt 允许产出的长度」与「校验层接受的长度」是同一份事实的两面，分处两模块就会
 * 漂移成「模型按 Prompt 写出却被拒绝」这种无法自解释的失败。
 *
 * 取值依据：召回候选摘要会原样渲染 responsibility / decision_domain / exclusions / situation，
 * 两个检索投影又把其余字段喂给嵌入模型，因此预算按「一句话一条」的紧凑口径给
 * （决策者口径：中文语境下标签 ≤ 20 字、条件/信号 ≤ 30 字、原则与行动 ≤ 60 字、
 * 每个数组元素 ≤ 15 字）。硬上限保持原有磁盘护栏不动，因此预算只是引导，
 * 轻微超出不会让候选被拒。总预算 ≈ 九个字段各自预算之和
 * （标量 240 + 两个数组各 4×15），逐项守预算即不会撞总上限。
 *
 * 不变量：逐项 ≤ FIELD_LIMITS 同项，总预算 ≤ 总上限。
 */
export const FIELD_BUDGETS = {
    responsibility: 30,
    decisionDomain: 20,
    taskType: 10,
    situation: 30,
    trigger: 30,
    principle: 60,
    recommendedAction: 60,
    arrayElement: 15,
    arrayLength: 4,
    total: 400,
};
/**
 * 初始化状态表的会话数上界。
 *
 * 为什么需要上界：状态键含会话，长驻宿主进程里会话只增不减；上界触及时按最早会话逐出，
 * 被逐出的会话若仍在运行，下一次初始化会重新标记（幂等），只是需要多一次初始化调用。
 */
export const MAX_INITIALIZED_SESSIONS = 256;
/** 空白归一化：去首尾空白并把连续空白折叠为单个空格（含换行与制表）。 */
export function normalizeWhitespace(value) {
    return value.replace(/\s+/gu, " ").trim();
}
/** 运行期类型守卫：取值是否属于经验主体类型域。 */
export function isExperienceType(value) {
    return typeof value === "string" && EXPERIENCE_TYPE_TABLE[value] === true;
}
//# sourceMappingURL=constants.js.map
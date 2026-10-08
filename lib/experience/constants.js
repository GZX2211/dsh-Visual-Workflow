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
/** 召回候选数的默认值。 */
export const DEFAULT_RECALL_TOP_K = 10;
/** 召回候选数上限（候选是给模型判断用的摘要，过多只会挤占上下文）。 */
export const MAX_RECALL_TOP_K = 50;
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
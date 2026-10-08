import type { ExperienceType } from "../shared/asset-types.js";
/** 经验主体类型取值域（顺序稳定，用于错误消息与遍历）。 */
export declare const EXPERIENCE_TYPES: readonly ExperienceType[];
/** 单次提交的候选上限（模型一次产出过多候选说明没有做取舍，且会放大写入事务）。 */
export declare const MAX_CANDIDATES_PER_CALL = 8;
/** 判重阈值：同类型活跃经验的决策向量相似度达到该值即视为近似重复。 */
export declare const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
/** 召回候选数的默认值。 */
export declare const DEFAULT_RECALL_TOP_K = 10;
/** 召回候选数上限（候选是给模型判断用的摘要，过多只会挤占上下文）。 */
export declare const MAX_RECALL_TOP_K = 50;
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

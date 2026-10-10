import type { ExperienceType } from "../shared/asset-types.js";
import type { ExperienceCaller, ExperienceRuntimePort } from "./ports.js";
/** 解析结果：经验主体身份、来源运行与初始化状态键所需的事实。 */
export interface ExperienceSubject {
    experienceType: ExperienceType;
    /** 状态键与清理口径：一律取「运行所属会话」（子代理取父会话，父代理取自身会话）。 */
    sessionId: string;
    /** 主体身份：子代理取 childId，父代理取会话 id。 */
    subjectId: string;
    /** 来源运行 id；父代理未承担编排职责时的执行经验没有来源运行，用空串表达。 */
    sourceRunId: string;
    childId?: string;
}
/** 主体解析入参。 */
export interface ExperienceSubjectInput {
    caller: ExperienceCaller;
    type: ExperienceType;
    runtime: ExperienceRuntimePort;
}
/** 仅需身份与运行事实的入参（查询可选类型用，不需要声明类型）。 */
export interface ExperienceCallerInput {
    caller: ExperienceCaller;
    runtime: ExperienceRuntimePort;
}
/** 当前调用方可选的经验类型（空数组表示此刻没有任何可提交的经验职责）。 */
export declare function allowedExperienceTypes(input: ExperienceCallerInput): ExperienceType[];
/**
 * 写入侧主体解析（提交经验 / 初始化生成 Prompt / 写入评价）：要求类型属于当前职责。
 *
 * 为什么写入侧必须校验：经验只有对应「主体实际承担的职责」才有意义，否则经验库会被错误主体的
 * 经验污染，而召回侧按类型过滤时无法分辨。
 */
export declare function resolveExperienceSubject(input: ExperienceSubjectInput): ExperienceSubject;
/**
 * 读取侧主体解析（召回）：只要求类型合法与身份可解析，**不要求类型属于当前职责**。
 *
 * 为什么读取侧放开（用户裁决 2026-10-10）：写入侧的类型表达「这条经验属于谁」（客观归属），
 * 读取侧若要求表达「我此刻是谁」（主观身份），就会因职责随会话进程变化而自锁——例如先改图成为
 * 编排管理者之后，再想参考执行侧经验就被自己的身份门禁挡住。读操作不写任何事实，无污染风险；
 * sessionId / subjectId 仍然解析（使用事实与评价准入要用到它们）。
 */
export declare function resolveExperienceReaderSubject(input: ExperienceSubjectInput): ExperienceSubject;

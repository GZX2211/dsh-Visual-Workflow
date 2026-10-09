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
 * 解析当前调用方对应的经验主体。
 * 来源运行全部取自运行事实：模型无法填写，父代理在无运行时的 agent 经验也没有来源运行可伪造。
 */
export declare function resolveExperienceSubject(input: ExperienceSubjectInput): ExperienceSubject;

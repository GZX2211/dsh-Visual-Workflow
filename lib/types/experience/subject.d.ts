import type { ExperienceType } from "../shared/asset-types.js";
import type { ExperienceCaller, ExperienceRuntimePort } from "./ports.js";
/** 解析结果：经验主体身份、来源运行与初始化状态键所需的事实。 */
export interface ExperienceSubject {
    experienceType: ExperienceType;
    /** 状态键与清理口径：一律取「运行所属会话」（子代理取父会话，父代理取自身会话）。 */
    sessionId: string;
    /** 主体身份：子代理取 childId，父代理取会话 id。 */
    subjectId: string;
    /**
     * 来源运行 id。
     * 子代理无所属编排运行、父代理没有活跃编排实例时都表达为「无来源运行」（空串，兼容磁盘列 NOT NULL）。
     */
    sourceRunId: string;
    /**
     * 当前角色身份（系统采集，模型不可填写）。
     * 优先级由编排器推导：角色资产 id → 角色名 → 空串；空串表示无法归属到角色，
     * 长期无用判定会保守地忽略这类证据。
     */
    roleKey: string;
    /** 当前角色名（展示用；无角色时为空串）。 */
    roleLabel: string;
    childId?: string;
}
/** 主体解析入参。 */
export interface ExperienceSubjectInput {
    caller: ExperienceCaller;
    type: ExperienceType;
    runtime: ExperienceRuntimePort;
}
/**
 * 解析当前调用方对应的经验主体（写入侧与读取侧共用同一入口）。
 *
 * 判定顺序即失败优先级：类型非法 → 子代理身份缺失 → 子代理类型越界 → 来源运行解析。
 * 来源运行全部取自运行事实：模型无法填写。
 */
export declare function resolveExperienceSubject(input: ExperienceSubjectInput): ExperienceSubject;

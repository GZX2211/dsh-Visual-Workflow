import type { ExperienceRetirementSweepResult } from "./retirement-sweep.js";
/** 扫描定时器所需的最小诊断面（info 只在有归档时输出摘要）。 */
export interface ExperienceRetirementScheduleLogger {
    warn(message: string): void;
    info?(message: string): void;
}
export interface ExperienceRetirementScheduleOptions {
    sweep: () => Promise<ExperienceRetirementSweepResult>;
    logger?: ExperienceRetirementScheduleLogger;
    initialDelayMs?: number;
    intervalMs?: number;
}
/**
 * 启动退役扫描定时器，返回释放函数（幂等）。
 *
 * 失败语义：单轮失败只告警，下一轮仍按期执行；扫描函数自身的读取失败由这里兜住，
 * 避免定时器回调抛出未捕获异常导致宿主进程告警风暴。
 */
export declare function scheduleExperienceRetirementSweep(options: ExperienceRetirementScheduleOptions): () => void;

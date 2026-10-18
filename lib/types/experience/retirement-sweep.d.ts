import type { ExperienceAutoRetirementReason } from "../shared/asset-types.js";
import type { ExperienceStorePort } from "./ports.js";
/** 扫描只依赖读事实与条件归档两个端口能力（便于单测注入最小 fake）。 */
export interface ExperienceRetirementSweepDeps {
    store: Pick<ExperienceStorePort, "listRetirementFacts" | "retireForPolicy">;
    logger?: {
        warn(message: string): void;
    };
}
/** 一轮扫描结果：处理了多少条活跃经验、其中哪些真正被归档。 */
export interface ExperienceRetirementSweepResult {
    scanned: number;
    retired: Array<{
        experienceId: string;
        reason: ExperienceAutoRetirementReason;
    }>;
}
/**
 * 执行一轮退役扫描。
 *
 * `scanned` 是活跃经验条数而不是归档条数：它让调用方能区分「没有候选」与「有候选但都不该归档」。
 * 只有 `retireForPolicy` 返回 true（确实从活跃变为归档）才计入 `retired`：
 * 扫描与手动恢复/归档并发时，条件更新可能返回 false，那表示另一条路径已经处理过这条经验，
 * 不是失败，也不该重复上报。
 */
export declare function sweepExperienceRetirements(deps: ExperienceRetirementSweepDeps): Promise<ExperienceRetirementSweepResult>;

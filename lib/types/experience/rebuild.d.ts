import type { ExperienceStorePort } from "./ports.js";
/** 重建依赖（只读历史 + 覆盖写统计，均由持久化端口在一笔事务内完成）。 */
export interface ExperienceStatsRebuildDeps {
    store: ExperienceStorePort;
}
/**
 * 重放全部评价历史与使用事实，覆盖写入统计投影。
 *
 * 重放口径（聚合器与中性投影）在本文件绑定一次，避免调用方各自拼装出第二份公式入口。
 */
export declare function rebuildExperienceStats(deps: ExperienceStatsRebuildDeps): Promise<{
    experienceCount: number;
}>;

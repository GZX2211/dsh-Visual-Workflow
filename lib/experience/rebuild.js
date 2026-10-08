// src/host/experience/rebuild.ts
//
// 统计投影的全量重放编排（§24 / §25）。
//
// 为什么必须与增量更新走同一套公式：重建的用途是「参数变了、数据修复了、首次上线」时把历史
// 重新解释一遍（§25）。若重建用另一套实现，增量与重建就会产出不同的统计，而两者都「看起来
// 正确」——这种分歧无法从单次结果里发现，只能靠同一聚合入口来避免。
//
// 为什么不由宿主启动时自动重建：重建是全表读写的重操作，且结果与调用时机无关；把它变成
// 显式动作后，宿主启动路径不带长事务，运维也能在受控时刻执行。
import { NEUTRAL_STATS } from "./constants.js";
import { aggregateExperienceStats } from "./statistics.js";
/**
 * 重放全部评价历史与使用事实，覆盖写入统计投影。
 *
 * 重放口径（聚合器与中性投影）在本文件绑定一次，避免调用方各自拼装出第二份公式入口。
 */
export async function rebuildExperienceStats(deps) {
    const input = {
        aggregate: aggregateExperienceStats,
        neutralStats: NEUTRAL_STATS,
    };
    return deps.store.rebuildStats(input);
}
//# sourceMappingURL=rebuild.js.map
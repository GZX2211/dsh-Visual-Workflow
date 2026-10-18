import type { ExperienceAutoRetirementReason, ExperienceRetirementFacts } from "../shared/asset-types.js";
import { type ExperiencePortContext } from "./experiences.js";
/**
 * 按策略自动归档一条经验（只对活跃行生效）。
 *
 * 返回是否真的发生了归档：已归档的经验返回 false（幂等），不存在则抛可行动错误。
 * 扫描与反馈即时归档共用本方法，因此两条路径的磁盘语义完全一致。
 */
export declare function retireExperienceRowForPolicy(ctx: ExperiencePortContext, id: string, reason: ExperienceAutoRetirementReason): boolean;
/**
 * 读取全部活跃经验的退役判定事实。
 *
 * 使用事实与评价事实都通过 JOIN 限定在活跃经验上，避免把归档经验的整段历史搬进内存；
 * 返回顺序按经验创建时间（与界面列表一致），内部事实按写入时间升序（去重时「后者胜出」才可复现）。
 */
export declare function readRetirementFacts(ctx: ExperiencePortContext): ExperienceRetirementFacts[];

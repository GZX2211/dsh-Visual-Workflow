import type { ExperienceGenerationPromptEntry, ExperienceType } from "../shared/asset-types.js";
import type { AssetTxContext } from "./db.js";
/** 某主体类型当前生效的 Prompt（无活跃行返回 null：该类型的经验生成被显式关闭）。 */
export declare function getActivePromptRow(ctx: AssetTxContext, type: ExperienceType): ExperienceGenerationPromptEntry | null;
/** 全量 Prompt（含历史版本；同一类型内活跃行排在前，界面据此展示当前生效版本）。 */
export declare function listPromptRows(ctx: AssetTxContext): ExperienceGenerationPromptEntry[];

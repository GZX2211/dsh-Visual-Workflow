// src/host/assets/experience-prompts.ts
//
// 经验生成 Prompt 表的读端口：某个主体类型当前生效的唯一 Prompt，以及含历史版本的列表。
//
// 为什么这里不判「至多一个活跃」：该不变量由部分唯一索引在数据库层保证，任何写入者
// （含并发写入与外部脚本）都绕不开；此处再判一次只会多出一处会与索引分叉的口径。
import { experiencePromptRowToEntry } from "./experience-codec.js";
/** 某主体类型当前生效的 Prompt（无活跃行返回 null：该类型的经验生成被显式关闭）。 */
export function getActivePromptRow(ctx, type) {
    const row = ctx.get("SELECT * FROM experience_prompts WHERE experience_type = ? AND is_active = 1", [type]);
    return row ? experiencePromptRowToEntry(row) : null;
}
/** 全量 Prompt（含历史版本；同一类型内活跃行排在前，界面据此展示当前生效版本）。 */
export function listPromptRows(ctx) {
    const rows = ctx.all("SELECT * FROM experience_prompts ORDER BY experience_type ASC, is_active DESC, created_at DESC, id ASC");
    return rows.map(experiencePromptRowToEntry);
}
//# sourceMappingURL=experience-prompts.js.map
// src/host/experience/subject.ts
//
// 主体解析与类型边界（§6 / §7.3）。
//
// 唯一的一条主体边界：子代理只能传 agent（用户裁决 2026-10-11）。子代理恒为执行主体——它
// 提交或召回编排经验只会污染自己的上下文与来源归属；此外**不再有**任何运行事实门禁。
//
// 为什么取消「子代理必须在编排运行实例内」（用户裁决 2026-10-11，A 案）：本次语义是「子代理
// 恒为 Agent」，它的判据是「此刻正在执行具体任务」，与是否身处某个编排运行无关。若保留运行
// 实例门禁，官方 Agent Team 的 teammate（不属于本插件的编排运行）将永远无法沉淀经验与反馈；
// 来源运行缺失时按「无来源」表达即可，经验本身仍然有效。
//
// 为什么父代理侧没有门禁：类型由调用方按此刻执行的内容自选（正在执行具体任务 → agent；
// 正在作为父代理执行编排 → orchestrator）。引擎不得用「是否正在编排运行中 / 是否改过图」
// 这类运行事实反推调用方身份——那会把规划期与运行后复盘误判成执行主体，也会让召回自锁。
//
// 为什么只有一个解析入口：写入侧与读取侧的**唯一**差别原本就是上面取消的那条子代理门禁，
// 保留两个入口等于同一事实两个本体。读取侧不写任何持久化事实，类型只决定候选池。
//
// 来源运行全部取自运行事实（模型无法伪造）：子代理优先取所属运行的 runId 与父会话，无所属
// 运行时取父会话与空串；父代理取会话自身与其活跃 run（无运行实例时空串，兼容磁盘列 NOT NULL）。
//
// 模型可见错误一律按 docs/model-facing-surface-rules.md §3：`{CODE}: english message`，
// 稳定码写进 message 文本（error.code 对模型不可见）。
import { WfError } from "../orchestrator/errors.js";
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_WRONG_TYPE } from "../shared/protocol.js";
import { EXPERIENCE_TYPES, isExperienceType } from "./constants.js";
/** 类型非法（不在取值域内）：取值域是所有调用方共用的运行期事实。 */
function invalidTypeError(value) {
    return new WfError(`${ERR_EXPERIENCE_WRONG_TYPE}: ${JSON.stringify(value ?? null)} is not a valid experience type; choose the type by what you are doing right now: `
        + `${EXPERIENCE_TYPES.map((type) => `"${type}"`).join(" or ")} ("agent" when you are executing a concrete task yourself, "orchestrator" when you are orchestrating a workflow as its parent agent).`, ERR_EXPERIENCE_WRONG_TYPE);
}
/** 子代理越界：子代理恒为执行主体，agent 之外的合法类型也要显式拒绝（不静默按 agent 处理）。 */
function childTypeError(type) {
    return new WfError(`${ERR_EXPERIENCE_WRONG_TYPE}: child agent can only use type "agent" (received ${JSON.stringify(type)}); a child agent is always an execution subject, so call again with type "agent".`, ERR_EXPERIENCE_WRONG_TYPE);
}
/** 角色身份归一：运行事实缺失或形状漂移时按空身份处理，绝不伪造角色。 */
function roleIdentityOf(run) {
    return {
        roleKey: typeof run?.roleKey === "string" ? run.roleKey.trim() : "",
        roleLabel: typeof run?.roleLabel === "string" ? run.roleLabel.trim() : "",
    };
}
/**
 * 解析当前调用方对应的经验主体（写入侧与读取侧共用同一入口）。
 *
 * 判定顺序即失败优先级：类型非法 → 子代理身份缺失 → 子代理类型越界 → 来源运行解析。
 * 来源运行全部取自运行事实：模型无法填写。
 */
export function resolveExperienceSubject(input) {
    const { caller, type, runtime } = input;
    if (!isExperienceType(type))
        throw invalidTypeError(type);
    const childId = caller.childId;
    if (caller.isChild) {
        // childId 是「调用方身份能否解析」的事实，与能否选 agent 无关，因此独立于类型护栏拒绝。
        if (!childId) {
            throw new WfError(`${ERR_EXPERIENCE_BAD_ARGS}: a child-agent call is missing childId (the official child session agent.id), so the experience subject cannot be resolved; retry once the tool layer has supplied the caller identity.`, ERR_EXPERIENCE_BAD_ARGS);
        }
        if (type !== "agent")
            throw childTypeError(type);
        const childRun = runtime.runForChild(childId);
        // 无所属编排运行时没有可归属的来源运行，按空串表达——经验本身仍然有效（见文件头注释）。
        if (!childRun) {
            return {
                experienceType: "agent",
                sessionId: caller.sessionId,
                subjectId: childId,
                sourceRunId: "",
                roleKey: "",
                roleLabel: "",
                childId,
            };
        }
        return {
            experienceType: "agent",
            sessionId: childRun.sessionId,
            subjectId: childId,
            sourceRunId: childRun.runId,
            ...roleIdentityOf(childRun),
            childId,
        };
    }
    // 父代理：类型由调用方按此刻执行的内容自选（无门禁）；来源运行取活跃实例，无实例即为空串。
    const run = runtime.activeRunForSession(caller.sessionId);
    return {
        experienceType: type,
        sessionId: caller.sessionId,
        subjectId: caller.sessionId,
        sourceRunId: run?.runId ?? "",
        ...roleIdentityOf(run),
    };
}
//# sourceMappingURL=subject.js.map
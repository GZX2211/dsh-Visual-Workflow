// src/host/experience/subject.ts
//
// 主体解析与类型职责校验（§6 / §7.3）。
//
// 为什么职责校验必须在这里集中且严格：经验只有对应「主体实际承担的职责」才有意义。若编排
// 父代理能提交 agent 经验、或没有协作组时能提交 team 经验，经验库会被错误主体的经验污染，
// 而召回侧按类型过滤时无法分辨。校验失败的消息必须给出「当前实际职责 + 可选类型」，
// 模型才能改对参数；这些事实全部来自运行端口，模型无法伪造。
//
// 编排职责判据（D-05）：**有运行中的编排实例**，或**本会话曾成功提交过图结构补丁**。
// 只看前者会把规划期与运行后复盘误判成执行主体（那两段同样在履行编排职责），故补后者。
import { WfError } from "../orchestrator/errors.js";
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_WRONG_TYPE } from "../shared/protocol.js";
import { EXPERIENCE_TYPES, isExperienceType } from "./constants.js";
function dutyFactsOf(caller, runtime) {
    if (caller.isChild) {
        const childId = caller.childId;
        const childRun = childId ? runtime.runForChild(childId) : null;
        return { isChild: true, sessionId: caller.sessionId, childId, childRun, run: null, hasTeam: false, graphPatched: false };
    }
    return {
        isChild: false,
        sessionId: caller.sessionId,
        childRun: null,
        run: runtime.activeRunForSession(caller.sessionId),
        hasTeam: runtime.hasTeamInCurrentRun(caller.sessionId),
        graphPatched: runtime.hasGraphPatch(caller.sessionId),
    };
}
function allowedFromFacts(facts) {
    if (facts.isChild)
        return facts.childRun ? ["agent"] : [];
    // 父代理尚未履行任何编排职责时是一个纯执行主体，只能沉淀执行经验；
    // 判据是「有运行中的编排实例」或「改过图」——后者覆盖规划期与运行后复盘。
    if (!facts.run && !facts.graphPatched)
        return ["agent"];
    return facts.hasTeam ? ["orchestrator", "team"] : ["orchestrator"];
}
/** 当前主体实际承担的职责（用于错误消息，让模型看清自己处在哪种身份）。 */
function describeDuty(facts) {
    if (facts.isChild) {
        return facts.childRun
            ? `子代理（${facts.childId ?? "未知"}，运行 ${facts.childRun.runId}）`
            : `子代理（${facts.childId ?? "未知"}，不在任何编排运行实例内）`;
    }
    if (facts.run)
        return `编排管理者（会话 ${facts.sessionId}，运行 ${facts.run.runId}）`;
    if (facts.graphPatched) {
        return `编排管理者（会话 ${facts.sessionId}，本会话已改过工作流图，当前没有运行中的编排实例）`;
    }
    return `执行主体（会话 ${facts.sessionId}，尚未履行编排职责：当前没有运行中的编排实例，也没有改过工作流图）`;
}
/** 类型与职责不符的具体原因（先给原因再给可选类型，模型才知道改哪一项）。 */
function mismatchReason(facts, type) {
    if (facts.isChild) {
        return facts.childRun ? "子代理只能提交 agent 经验" : "当前子代理不在任何编排运行实例内，无法确定来源运行";
    }
    if (type === "team") {
        return facts.hasTeam ? "当前会话没有正在运行的编排工作流" : "本会话当前运行内还没有启动过协作组";
    }
    if (type === "orchestrator")
        return "当前会话既没有运行中的编排工作流，也没有改过工作流图";
    return "你正在作为编排管理者执行编排任务";
}
function wrongTypeError(facts, type, allowed) {
    const options = allowed.length > 0 ? allowed.join(" / ") : "无";
    return new WfError(`经验类型与当前职责不符（${mismatchReason(facts, type)}）：不能提交 ${type} 经验。`
        + `当前实际职责：${describeDuty(facts)}。可选类型：${options}。`
        + "请改用可选类型，或在相应职责出现后再提交该类型经验。", ERR_EXPERIENCE_WRONG_TYPE);
}
/** 当前调用方可选的经验类型（空数组表示此刻没有任何可提交的经验职责）。 */
export function allowedExperienceTypes(input) {
    return allowedFromFacts(dutyFactsOf(input.caller, input.runtime));
}
/**
 * 解析当前调用方对应的经验主体。
 * 来源运行全部取自运行事实：模型无法填写，父代理在无运行时的 agent 经验也没有来源运行可伪造。
 */
export function resolveExperienceSubject(input) {
    const { caller, type, runtime } = input;
    const facts = dutyFactsOf(caller, runtime);
    if (!isExperienceType(type)) {
        throw new WfError(`经验类型非法（实际为 ${String(type)}）：只能是 ${EXPERIENCE_TYPES.join(" / ")}；当前实际职责：${describeDuty(facts)}。`
            + "请改用当前职责对应的类型后重新提交。", ERR_EXPERIENCE_WRONG_TYPE);
    }
    if (facts.isChild && !facts.childId) {
        throw new WfError("子代理调用缺少 childId（官方子代理会话的 agent.id）：无法确定来源运行与初始化状态键；请由工具层补齐调用方身份后重试。", ERR_EXPERIENCE_BAD_ARGS);
    }
    const allowed = allowedFromFacts(facts);
    if (!allowed.includes(type))
        throw wrongTypeError(facts, type, allowed);
    if (facts.isChild) {
        const childRun = facts.childRun;
        const childId = facts.childId;
        // 与 allowed 判定同源，因此这里必然成立；仍显式收窄以满足「来源运行必须来自事实」
        if (!childRun || !childId)
            throw wrongTypeError(facts, type, allowed);
        return { experienceType: "agent", sessionId: childRun.sessionId, subjectId: childId, sourceRunId: childRun.runId, childId };
    }
    if (type === "agent") {
        // 父代理未承担编排职责时没有来源运行记录：空串表达「无运行来源」，与磁盘列 NOT NULL 兼容
        return { experienceType: "agent", sessionId: caller.sessionId, subjectId: caller.sessionId, sourceRunId: "" };
    }
    const run = facts.run;
    if (!run) {
        // 改过图但没有运行实例（规划期 / 运行后复盘）：编排经验同样没有来源运行，用空串表达
        // （与父代理执行经验同一口径，兼容磁盘列的 NOT NULL）
        return { experienceType: type, sessionId: caller.sessionId, subjectId: caller.sessionId, sourceRunId: "" };
    }
    return { experienceType: type, sessionId: caller.sessionId, subjectId: caller.sessionId, sourceRunId: run.runId };
}
//# sourceMappingURL=subject.js.map
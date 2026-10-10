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
 * 解析当前调用方对应的经验主体（内部实现，按 action 决定是否施加职责门禁）。
 * 来源运行全部取自运行事实：模型无法填写，父代理在无运行时的 agent 经验也没有来源运行可伪造。
 */
function resolveSubject(input, action) {
    const { caller, type, runtime } = input;
    const facts = dutyFactsOf(caller, runtime);
    if (!isExperienceType(type)) {
        const tail = action === "recall"
            ? "请改用合法类型后重新召回。"
            : "请改用当前职责对应的类型后重新提交。";
        throw new WfError(`经验类型非法（实际为 ${String(type)}）：只能是 ${EXPERIENCE_TYPES.join(" / ")}；当前实际职责：${describeDuty(facts)}。` + tail, ERR_EXPERIENCE_WRONG_TYPE);
    }
    if (facts.isChild && !facts.childId) {
        throw new WfError("子代理调用缺少 childId（官方子代理会话的 agent.id）：无法确定来源运行与初始化状态键；请由工具层补齐调用方身份后重试。", ERR_EXPERIENCE_BAD_ARGS);
    }
    if (action === "submit") {
        const allowed = allowedFromFacts(facts);
        if (!allowed.includes(type))
            throw wrongTypeError(facts, type, allowed);
    }
    if (facts.isChild) {
        // 子代理的身份事实是「执行主体」：它的经验池恒为 agent（见下方恒返回 experienceType='agent'）。
        // 读取侧若传入其它类型，必须**明确拒绝**而不是静默按 agent 处理——否则调用方以为在读编排经验，
        // 实际拿到的是执行经验，错误被藏起来。这同时保留原设计「子代理不接触编排/团队经验」的防线：
        // 子代理读取父代理的组织层经验只会污染它自己的上下文。
        if (action === "recall" && type !== "agent") {
            throw new WfError(`子代理只能召回 agent 经验（收到 ${type}）：子代理的身份是执行主体，`
                + "编排经验与团队经验属于父代理 / 协作组的职责，读取它们只会污染子代理上下文。", ERR_EXPERIENCE_WRONG_TYPE);
        }
        const childRun = facts.childRun;
        const childId = facts.childId;
        if (!childRun || !childId) {
            // 写入侧走到这里即职责不成立（与 allowed 判定同源）；读取侧只需身份可解析，
            // 来源运行缺失时按「无运行来源」处理（空串，兼容磁盘列 NOT NULL）。
            if (!childId)
                throw new WfError("子代理调用缺少 childId：无法确定经验主体。", ERR_EXPERIENCE_BAD_ARGS);
            if (action === "submit")
                throw wrongTypeError(facts, type, allowedFromFacts(facts));
            return { experienceType: "agent", sessionId: caller.sessionId, subjectId: childId, sourceRunId: "", childId };
        }
        return { experienceType: "agent", sessionId: childRun.sessionId, subjectId: childId, sourceRunId: childRun.runId, childId };
    }
    if (type === "agent") {
        // 父代理未承担编排职责时没有来源运行记录：空串表达「无运行来源」，与磁盘列 NOT NULL 兼容
        return { experienceType: "agent", sessionId: caller.sessionId, subjectId: caller.sessionId, sourceRunId: "" };
    }
    const run = facts.run;
    if (!run) {
        // 无运行实例（规划期 / 运行后复盘 / 读取侧）：编排经验同样没有来源运行，用空串表达
        return { experienceType: type, sessionId: caller.sessionId, subjectId: caller.sessionId, sourceRunId: "" };
    }
    return { experienceType: type, sessionId: caller.sessionId, subjectId: caller.sessionId, sourceRunId: run.runId };
}
/**
 * 写入侧主体解析（提交经验 / 初始化生成 Prompt / 写入评价）：要求类型属于当前职责。
 *
 * 为什么写入侧必须校验：经验只有对应「主体实际承担的职责」才有意义，否则经验库会被错误主体的
 * 经验污染，而召回侧按类型过滤时无法分辨。
 */
export function resolveExperienceSubject(input) {
    return resolveSubject(input, "submit");
}
/**
 * 读取侧主体解析（召回）：只要求类型合法与身份可解析，**不要求类型属于当前职责**。
 *
 * 为什么读取侧放开（用户裁决 2026-10-10）：写入侧的类型表达「这条经验属于谁」（客观归属），
 * 读取侧若要求表达「我此刻是谁」（主观身份），就会因职责随会话进程变化而自锁——例如先改图成为
 * 编排管理者之后，再想参考执行侧经验就被自己的身份门禁挡住。读操作不写任何事实，无污染风险；
 * sessionId / subjectId 仍然解析（使用事实与评价准入要用到它们）。
 */
export function resolveExperienceReaderSubject(input) {
    return resolveSubject(input, "recall");
}
//# sourceMappingURL=subject.js.map
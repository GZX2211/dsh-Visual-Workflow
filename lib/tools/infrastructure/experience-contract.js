// src/host/tools/infrastructure/experience-contract.ts
//
// 工具层经验契约（learn / recall / feedback 共用）：宿主能力缝 + 主体类型入参规则。
//
// 为什么独立于 caller.ts：调用方身份派生与经验能力缝是两件事，但两者都被两个以上
// Tool 以同一语义消费，因此都留在基础设施层——任何单个 Tool 目录都不得成为另一
// Tool 的依赖来源。
//
// 职责边界：只声明缝与纯校验/纯解析，不含业务执行语义；持久化、去重、检索口径与准入
// 判定全部属于 domain 层（由宿主组合根装配注入）。反馈的入参/出参类型直接引用经验域
// 公共入口的类型，不在此重声明第二套形状。
import { WfError } from '../../orchestrator/index.js';
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_WRONG_TYPE } from '../../shared/protocol.js';
/**
 * 主体类型说明表：键即运行时判据本体。
 * 用 Record<ExperienceType, ...> 而不是字符串数组，是为了让类型联合新增成员时在此处
 * 编译期报错——否则新类型会成为一个「永远无法通过入参校验」的合法类型。
 */
const EXPERIENCE_TYPE_NOTE = {
    agent: '执行主体（子代理，或此刻正在执行具体任务的父代理）完成实际任务后的经验',
    orchestrator: '编排父代理完成组织任务后的组织经验',
};
/**
 * 经验三工具共用的 subject type 参数说明（措辞单一来源）。
 * 为什么提升到基础设施层：learn / recall / feedback 各写一遍必然出现措辞漂移，
 * 而三者描述的是同一个取值域与同一条「子代理只能 agent」的工具层事实。
 */
export const EXPERIENCE_TYPE_PARAM_DESCRIPTION = 'Which experience pool this call reads or writes, decided by what you are doing right now: "agent" when you are executing a concrete task yourself, "orchestrator" when you are orchestrating a workflow as its parent agent. A child agent may only pass "agent".';
/** 解析并收窄模型侧 type 参数；未知取值抛 WF_EXPERIENCE_BAD_ARGS（消息给出合法取值）。 */
export function parseExperienceType(raw) {
    if (typeof raw === 'string' && Object.hasOwn(EXPERIENCE_TYPE_NOTE, raw))
        return raw;
    const expected = Object.keys(EXPERIENCE_TYPE_NOTE).map((type) => `"${type}"`).join(' / ');
    throw new WfError(`${ERR_EXPERIENCE_BAD_ARGS}: type must be one of ${expected} (received ${JSON.stringify(raw ?? null)}); choose it by what you are doing right now: "agent" when you are executing a concrete task yourself, "orchestrator" when you are orchestrating a workflow as its parent agent`, ERR_EXPERIENCE_BAD_ARGS);
}
/**
 * 主体类型归属校验。
 *
 * 为什么只有「子代理只能是 agent」这一条在工具层：调用方是不是子代理是工具层独有的事实
 * （来自官方会话 header），而父代理按此刻执行内容自选类型**没有门禁**——工具层不得再用运行
 * 事实反推父代理身份，也不复制域层的类型判定，避免同一规则两处维护后不一致。
 */
export function assertExperienceTypeOwnership(caller, type) {
    if (!caller.isChild || type === 'agent')
        return;
    throw new WfError(`${ERR_EXPERIENCE_WRONG_TYPE}: a child agent may only use type "agent" (received ${JSON.stringify(type)}); child agents are execution subjects, while "orchestrator" experiences belong to the parent agent that is orchestrating`, ERR_EXPERIENCE_WRONG_TYPE);
}
//# sourceMappingURL=experience-contract.js.map
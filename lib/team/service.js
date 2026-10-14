// src/host/team/service.ts
//
// 官方 Agent 协作组服务解析（运行时守卫）；能力缺失返回 null，由调用方决定降级语义。
//
// 为什么需要守卫而不是直接调用：官方 协作组包是独立挂载的实验性插件，部署可能未启用；
// 未启用时 协作组节点必须能回退到插件的既有协作路径，而不是整体失败。
/**
 * 解析官方 协作组服务（`ctx.agentTeams`）。
 *
 * 判定条件：三个能力齐全（创建成员 / 读取成员 / 投递消息）——缺任一都不足以完成
 * 「启动团队 + 复用派发」的完整语义，按不可用处理更安全（调用方回退旧路径）。
 *
 * @param ctx - 宿主上下文。
 * @returns 收窄后的服务结构；不可用时 null。
 */
export function agentTeamsServiceLike(ctx) {
    const service = ctx.get('agentTeams');
    if (service === null || typeof service !== 'object')
        return null;
    const candidate = service;
    if (typeof candidate.spawnTeammate !== 'function'
        || typeof candidate.listMembers !== 'function'
        || typeof candidate.sendMessage !== 'function') {
        return null;
    }
    return service;
}
/**
 * 在成员清单中按名字查已有成员（纯函数）。
 *
 * 用途：判定本次是否需要创建——官方成员名永久不可复用，已存在的同名成员只能复用
 * （重新派发任务），再创建会直接失败。
 *
 * @param members - `listMembers` 结果（含 Lead 伪行，按名字匹配不会命中 Lead 的 "lead"）。
 * @param name - 目标成员名。
 * @returns 命中的成员行；不存在返回 undefined。
 */
export function findMemberByName(members, name) {
    if (!Array.isArray(members))
        return undefined;
    return members.find((member) => String(member?.name ?? '') === name);
}
//# sourceMappingURL=service.js.map
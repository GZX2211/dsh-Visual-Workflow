// src/host/web-server.ts
//
// 官方 webServer 服务的 Host 级最小结构契约（官方 register 契约的收窄形状）。
//
// 为什么在 host 根而不是某个模块内：Host 半区有两个独立的 HTTP 边界都要挂路由——
// GUI API 边界（api）与模式二服务进程的 OpenAI 兼容层（service）。它们必须消费
// 同一份形状：任一模块自建第二份最小结构，官方 register 契约就多出一个漂移点，
// 升级官方包时会出现「一处跟着改、另一处静默失效」。本文件是零运行时依赖的纯结构
// 契约 + 一处解析守卫，不承担任何路由语义（路由前缀、方法校验、响应序列化归各边界）。
/**
 * 解析 webServer 服务（不可用时返回 null）。
 * 调用方决定降级语义——两个边界的既有口径一致：缺失时告警并返回 no-op disposer，
 * 不得静默失效。
 */
export function webServerOf(ctx) {
    const service = ctx.get('webServer');
    if (service === null || typeof service !== 'object')
        return null;
    return typeof service.register === 'function' ? service : null;
}
//# sourceMappingURL=web-server.js.map
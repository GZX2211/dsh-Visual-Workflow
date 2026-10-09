// src/host/api/boundary.ts
//
// API 边界基座：宿主能力缝（ApiHost）、端点白名单分发基类
// VisualWorkflowApiBase，以及端点组汇聚工具。
//
// 官方 webServer 的最小结构契约由 host 根横切契约提供（../web-server.js）：
// 两个 HTTP 边界必须消费同一份形状，本模块不自建第二份。
//
// 为什么端点组用组合而不是多层继承：端点组之间没有职责依赖（定时任务端点不需要
// 依赖运行端点），用继承串联只会制造伪依赖并让模块内「谁能调用谁」不可见。各组
// 只依赖本基座，最终类按显式清单汇聚原型方法（见 routes.ts）。
import * as EP from '../shared/protocol.js';
import { httpError } from './http.js';
const assetStoreFits = true;
void assetStoreFits;
/**
 * 取资产库能力缝。未装配时明确 501——静默降级为「空资产库」会让用户看到
 * 「库里什么都没有」这种与事实不符的界面；资产端点与经验端点共用同一份判据。
 */
export function requireAssets(host) {
    const assets = host.assets;
    if (!assets)
        throw httpError(501, '资产库尚未装配（asset store unavailable）');
    return assets;
}
/**
 * 取经验域能力缝。未装配时明确 501——静默返回空经验列表会让用户看到
 * 「库里没有经验」这种与事实不符的界面，也可能让保存静默失败。
 */
export function requireExperience(host) {
    const experience = host.experience;
    if (!experience)
        throw httpError(501, '经验域尚未装配（experience domain unavailable）');
    return experience;
}
/**
 * GUI API 分发基座：按端点名分发（白名单禁止命中原型链方法）。
 * 所有方法为 async (args) => value；参数缺失抛 HttpError(400)。
 */
export class VisualWorkflowApiBase {
    ctx;
    host;
    constructor(ctx, host) {
        this.ctx = ctx;
        this.host = host;
    }
    /** 端点白名单（共享协议常量表派生，与共享契约零漂移）。 */
    static ENDPOINTS = new Set(Object.values(EP).filter((value) => typeof value === 'string'));
    /** 按端点名分发；未知端点 404。 */
    async handle(endpoint, args) {
        const method = VisualWorkflowApiBase.ENDPOINTS.has(endpoint)
            ? this[endpoint]
            : undefined;
        if (typeof method !== 'function')
            throw httpError(404, `unknown endpoint: ${endpoint}`);
        return method.call(this, (args ?? {}));
    }
}
/**
 * 把端点组的原型方法汇聚到最终类（组合替代继承串联）。
 * 只搬运组自身声明的方法（跳过 constructor）；基座方法仍由继承提供。
 * @param target 最终 API 类（继承基座）。
 * @param groups 端点组类清单（顺序无关，端点名必须全局唯一——冲突时后者覆盖）。
 */
export function mixInEndpointGroups(target, groups) {
    for (const group of groups) {
        for (const key of Object.getOwnPropertyNames(group.prototype)) {
            if (key === 'constructor')
                continue;
            const descriptor = Object.getOwnPropertyDescriptor(group.prototype, key);
            if (descriptor)
                Object.defineProperty(target.prototype, key, descriptor);
        }
    }
}
//# sourceMappingURL=boundary.js.map
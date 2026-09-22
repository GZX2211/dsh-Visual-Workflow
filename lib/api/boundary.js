// src/host/api/boundary.ts
//
// API 边界基座：宿主能力缝（ApiHost）、webServer 最小结构、端点白名单分发基类
// VisualWorkflowApiBase，以及端点组汇聚工具。
//
// 为什么端点组用组合而不是多层继承：端点组之间没有职责依赖（定时任务端点不需要
// 依赖运行端点），用继承串联只会制造伪依赖并让模块内「谁能调用谁」不可见。各组
// 只依赖本基座，最终类按显式清单汇聚原型方法（见 routes.ts）。
import * as EP from '../shared/protocol.js';
import { httpError } from './http.js';
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
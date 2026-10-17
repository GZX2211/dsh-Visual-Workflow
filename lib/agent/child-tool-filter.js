// src/host/agent/child-tool-filter.ts
//
// 子代理工具白名单装配（allow 侧）与创建窗口夹持。
//
// 与 runner 的既有路径的关系：
//   - 普通节点子代理由宿主在 `agent/created` 创建窗口内自行安装 restrict（0.2.1+ 的
//     startActivation 请求已不接受 toolFilter；≤0.2.0 旧宿主仍经 startContinuable 传
//     toolFilter，与本装配双保险）；
//   - Team 成员由官方 Team 服务建立，该服务的创建请求**不接受** toolFilter，
//     因此白名单必须由宿主在 `agent/created` 创建窗口内自行安装（官方语义等价：
//     restrict 是作用域级声明式掩码，安装即对该子代理生效）。
//
// 名单来源与约束：
//   - 名单由 resolveAgentTools 解析（已剔除永不进子代理的工具、官方保留传输名与
//     官方 Team 工具名——后两者进入 restrict 名单会被官方「未知全局工具」校验拒绝）；
//   - 空名单不安装 restrict（与官方路径一致：空表示不限制继承面）；
//   - restrict 抛错按「尽力而为」处理：不阻断子代理创建，工具可见性退回继承面，
//     并保留 childVisibilityContribution 的 deny 双保险。
import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * 创建子代理工具白名单装配。
 * WeakMap/ALS 之外只持有 childId → 名单的留存表；条目为工具名数组，随宿主持有的
 * 本装配对象一起回收（宿主 dispose 后无引用）。
 */
export function createChildToolFilterSetup() {
    const pending = new AsyncLocalStorage();
    /** childId → 已留存的工具白名单（重发布重装用）。 */
    const remembered = new Map();
    const apply = (rawChildCtx, allow) => {
        if (!allow || allow.length === 0)
            return () => { };
        try {
            if (rawChildCtx === null || typeof rawChildCtx !== 'object')
                return () => { };
            const childCtx = rawChildCtx;
            if (typeof childCtx.get !== 'function')
                return () => { };
            const tools = childCtx.get('tools');
            if (!tools || typeof tools.restrict !== 'function')
                return () => { };
            return tools.restrict({ allow: [...allow] });
        }
        catch {
            // 官方校验拒绝（未注册名等）或服务缺失：不阻断创建，可见性退回继承面
            return () => { };
        }
    };
    const contribution = (rawChildCtx) => apply(rawChildCtx, pending.getStore());
    const withPending = (allow, operation) => pending.run(allow, operation);
    const remember = (childId, allow) => {
        const id = String(childId ?? '');
        if (!id)
            return;
        if (!allow || allow.length === 0) {
            remembered.delete(id);
            return;
        }
        remembered.set(id, [...allow]);
    };
    const restore = (childId, childCtx) => {
        const allow = remembered.get(String(childId ?? ''));
        if (!allow)
            return () => { };
        return apply(childCtx, allow);
    };
    return { contribution, withPending, remember, restore };
}
//# sourceMappingURL=child-tool-filter.js.map
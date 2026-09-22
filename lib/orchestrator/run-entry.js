// src/host/orchestrator/run-entry.ts
//
// 单次运行的内存条目（RunEntry）与阻塞等待器，以及运行对外接口契约：
//   - RunEntry：单次运行的内存条目（快照 + 护栏计数 + in-flight 表）；
//   - Waiter / createWaiter：wait:true 阻塞等待器的创建；
//   - OrchestratorDeps：编排器依赖装配（数据层/子代理引擎/父代理宿主/提示词与
//     模型装配/配置/日志/时钟与 id 生成注入/外部能力缝）；
//   - 工具与启动/收尾的入出参接口（RunNodeArgs/RunNodeResult/StartRunOptions 等）。
/** 创建挂起等待器（resolve/reject 闭合到 promise）。 */
export function createWaiter() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
//# sourceMappingURL=run-entry.js.map
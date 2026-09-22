// src/host/orchestrator/runtime.ts
//
// 编排运行时收口类（历史单文件拆分后的最终类）：
//   - OrchestratorRuntime 汇聚继承链（RuntimeBase ← RuntimeLaunch ← RuntimeExecute ←
//     RuntimeComm ← RuntimeObserve ← RuntimeLifecycle），全部方法体逐字移动、
//     零逻辑修改（可见性放宽见各继承层文件头注释）；
//   - 本文件只放最终类，**不再承担模块入口职责**：公共入口见 index.ts。
import { RuntimeLifecycle } from './runtime-lifecycle.js';
/** 编排运行时：模式一「父代理编排」执行引擎的全部内存状态与状态机（拆分后最终类）。 */
export class OrchestratorRuntime extends RuntimeLifecycle {
}
//# sourceMappingURL=runtime.js.map
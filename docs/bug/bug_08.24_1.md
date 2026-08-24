# 阶段性 bug 排查 — 2026.08.24 — 13:00

## 严重 BUG（可能导致核心功能失效）

| # | 问题描述 | 所在文件 | 修复建议 |
|---|----------|----------|----------|
| **B1** | **上下文连线（ctx）无法传递上游代理节点的产出**：`buildNodeBlocks` 只处理 `file` 节点，完全忽略了 `agent`/`parent` 节点的输出。运行中上游子代理的最终结果无法通过 ctx 注入下游，导致上下文传递彻底失效。 | `orchestrator/runtime.ts` (`buildNodeBlocks`) | 修改 `buildNodeBlocks`，增加从运行快照（`RunSnapshot`）读取上游节点产出（`output`）的能力。对于已 `ok` 或 `react-capped` 的上游节点，将其输出文本截断后加入 `upstreamContext`。需传递 `snapshot` 或 `getNodeOutput` 函数。 |
| **B2** | **协作组（Group）节点无法执行**：`wf_run_node` 仅支持 `agent` 和 `pause` 类型，对 `group` 抛出“只接受角色(agent)节点”错误，导致协作组完全不可用。 | `orchestrator/runtime.ts` (`wfRunNode`) | 增加对 `kind === 'group'` 的处理：并行启动组内所有成员（`memberIds`），等待全部完成，然后将组节点状态置为 `ok`，流程从组卡片 `flow-out` 继续。需设计“并行启动 + 聚合等待”逻辑。 |
| **B3** | **运行内存泄漏**：所有运行（包括已终止的 `completed`/`failed`/`stopped`）都保存在 `orchestrator.runs` Map 中，从不清理。长期运行将导致内存膨胀，且 `flowLockInfo` 扫描范围变大。 | `orchestrator/runtime.ts` | 在 `terminateRun` 成功后将 `entry` 从 `runs` Map 中删除；只保留 `running` 和 `paused` 状态在内存中。历史记录通过 `FlowStore` 查询。 |
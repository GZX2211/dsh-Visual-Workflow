// Host + Client 共享契约（纯类型，零运行时 import）。
//
// 本文件定义运行快照（RunSnapshot）、服务状态（ServiceState）、模板（Role/File/
// Database/Group）、工具组合（ToolCombo）、导入导出 v2 bundle（BundleV2）、
// userId→sessionId 映射（UserIdMap）与断点回填用的节点输出记录（NodeOutputRecord）。
//
// 约束（架构文档 §2.3 / SKILL.md §6.3）：
//   - **零运行时 import**：client 半区经 type-only import 零风险引用本层结构，不得
//     引入任何运行时值（避免 double tsconfig 的 Context augmentation 相互污染）。
//     跨文件的类型复用（如 ServiceState.nodes: GraphNode[]）使用 `import type`
//     （纯类型引用，编译期被完全擦除，不产生任何运行时依赖）。
//   - 结构逐字对齐架构文档 AD-001 §6.1~§6.4。
//   - 每个字段以中文 JSDoc 说明业务语义，并引用需求条款号（PRD §4.x.y）。
// ---------------------------------------------------------------------------
// 元参数结构一致性断言（编译期强制，零运行时代价）
// ---------------------------------------------------------------------------
// graph-model.ts 因 shared 层「完全零 import」纯度门而保留 OrgMeta 结构镜像；本区块用
// **键集合断言**把镜像与本体（./org-meta.ts）锁在一起：任一侧新增/删除字段而另一侧未同步，
// 少键（本体比镜像多）或类型不符都会让 `pnpm typecheck` 直接失败，杜绝静默漂移。
// 为什么不用「双向可赋值」断言：映射类型把可选字段的 undefined 也视作可赋值方向，
// 漏一个可选字段时断言仍会通过（已实测），键集合断言才是可靠的哨兵。
const ORG_META_KEYS = {
    nodeMin: true, nodeMax: true, groupMax: true, membersMin: true, membersMax: true,
    parallelBranchMax: true, planFreedom: true, promptSource: true, roleGranularity: true,
    roleReuse: true, milestoneMax: true, interveneTrigger: true, patchOpsMax: true,
    askPerNodeMax: true, crossGroupPolicy: true, failurePolicy: true, forbiddenShapes: true,
    namingConvention: true, eval: true, restructure: true,
};
const ORG_META_MIRROR_IN_SYNC = true;
void ORG_META_MIRROR_IN_SYNC;
export {};
//# sourceMappingURL=types.js.map
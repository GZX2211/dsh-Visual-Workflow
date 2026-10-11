// src/host/shared/org-meta.ts
//
// Host + Client 共享元参数类型（纯类型层，零 import）。
//
// 为什么独立成文件：shared 层禁止任何运行时 import
// （仅允许 `import type`，编译期擦除），而「形状文件」不得定义运行时值。
// 独立文件（零 import、纯类型）后：
//   - graph-model.ts 可直接 import type { OrgMeta }
//   - types.ts 作为 type-only barrel 再导出，保持既有对外契约路径。
//
// 语义来源：元参数七组字段 + 决策台账 D-04/D-13/D-21。
// 本文件**只放类型**：归一化/合并/超限判定等运行时纯函数归 graph 模块。
export {};
//# sourceMappingURL=org-meta.js.map
// Host + Client 共享元参数类型（纯类型层，零 import）。
//
// 为什么独立成文件（架构文档 §2.3 纯度门）：shared 层禁止任何运行时 import，
// 且约定「graph-model.ts / protocol.ts 完全零 import，types.ts 只允许 type-only 引用」。
// 若把 OrgMeta 直接写在 graph-model.ts 里并 import types.ts 的字段类型，就会打破该门禁；
// 独立文件（零 import）后：
//   - graph-model.ts 可直接 `import type { OrgMeta } from './org-meta.js'`（纯类型、编译期擦除）；
//   - types.ts 通过 `export type` 再导出（RunSnapshot.meta / ServiceState.meta 字段类型用），
//     保持既有对外契约路径（`from './types.js'` 的 import 依旧可用）。
//
// 语义来源：docs/自主编排-实施方案.md §6.4（元参数七组字段）+ 决策台账 D-04/D-13/D-21。
// 本文件**只放类型**：归一化/合并/超限判定等运行时纯函数在 src/host/graph/org-meta*.ts。
export {};
//# sourceMappingURL=org-meta.js.map
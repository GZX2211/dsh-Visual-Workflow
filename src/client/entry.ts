// DSH Visual Workflow —— Client 半区插件入口（P01 占位骨架）。
//
// 说明：本文件当前仅提供 inject/apply 空占位，保证 T-001 双 program typecheck
// 通过；真实挂载（conversation.view slot 注册 + 样式注入 + i18n 初始化）将在
// T-041 实现。类型贡献（ClientContext / SlotMap 合并）通过 type-only import 拉入，
// 遵循 SKILL.md §5.1 与 §6.3（纯类型 import 会被擦除，不影响运行时依赖）。

// 全局样式占位（T-003）：让 tsdown 的 CSS 注入路径（style[data-plugin]）可被真实命中。
// 为什么必须 import 一个真实 CSS 文件：官方 tsdown.client.ts 的全局 CSS 虚拟 loader
// 仅在源码 import `*.css` 时触发；否则产物内不会出现 style 注入代码，无法满足
// T-003 DoD「client 产物含 style[data-plugin]」的冒烟断言。真实样式由 T-050 补充。
import './entry.css'

// 必需 service 声明（client fiber 依赖官方 slot service）。
export const inject: string[] = ['slots']

// 插件入口。空实现：T-041 将填充 conversation.view slot 注册、样式注入与 i18n 初始化。
export function apply(): void {}

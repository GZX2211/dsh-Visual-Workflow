// DSH Visual Workflow —— Client 半区插件入口（P01 占位骨架）。
//
// 说明：本文件当前仅提供 inject/apply 空占位，保证 T-001 双 program typecheck
// 通过；真实挂载（conversation.view slot 注册 + 样式注入 + i18n 初始化）将在
// T-041 实现。类型贡献（ClientContext / SlotMap 合并）通过 type-only import 拉入，
// 遵循 SKILL.md §5.1 与 §6.3（纯类型 import 会被擦除，不影响运行时依赖）。

// 必需 service 声明（client fiber 依赖官方 slot service）。
export const inject: string[] = ['slots']

// 插件入口。空实现：T-041 将填充 conversation.view slot 注册、样式注入与 i18n 初始化。
export function apply(): void {}

// src/host/index.ts
//
// DSH Visual Workflow —— Host 半区插件入口（历史单一文件拆分后的收口文件）：
//   - apply 挂载 visualWorkflowHost service（装配细节见 visual-workflow-host.ts）；
//   - 入口 re-export 拆分前的全部公共 API（插件契约见 config.ts），外部引用路径
//     不变（service-runner / 测试均从本入口导入）。

import type { Context } from '@deepseek-ai/cordis'
import { VisualWorkflowHost } from './visual-workflow-host.js'
import type { Config } from './config.js'

// ── 插件入口 ────────────────────────────────────────────────────────────

/** 插件 apply 入口：实例化并注册 visualWorkflowHost service（随 fiber 自动注销）。 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(VisualWorkflowHost, config)
}

// ---------------------------------------------------------------------------
// re-export：原入口公共 API（拆分后外部引用路径不变）
// ---------------------------------------------------------------------------

export { name, inject, Config } from './config.js'
export { VisualWorkflowHost, VisualWorkflowHostServiceName } from './visual-workflow-host.js'

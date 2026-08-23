// DSH Visual Workflow —— Host 半区插件入口（P01 占位骨架）。
//
// 说明：本文件当前仅提供 name/inject/apply 空占位，保证 T-001 双 program
// typecheck 与构建链路可跑通；真实装配（提供 visualWorkflowHost service、
// agents/storage/orchestrator 等注入）将在后续任务实现：
//   - T-002：token 挂载（insert 行 id=visual-workflow）最终落在 cordis.patch.yml；
//   - T-015：apply() 内完整装配 visualWorkflowHost / agents 注入 / watchdog /
//     subagent-end 观察 / agent-error 清理 / dispose 清理。

// 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。
export const name = 'dsh-visual-workflow'

// 必需 service 声明（W-05：所有 @deepseek-ai/* 服务经 ctx.get() 运行时解析，
// 此处暂缺的 inject 清单将在 T-015 按实际用到的官方 service 补齐）。
export const inject: string[] = []

// 插件入口。空实现：P02/T-002 与 T-015 将填充真实装配逻辑。
export function apply(): void {}

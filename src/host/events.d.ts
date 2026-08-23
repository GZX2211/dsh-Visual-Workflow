// src/host/events.d.ts
//
// Host 半区对 cordis Events 的本地声明（T-015；T-021 按官方取证收窄 payload）。
//
// 为什么在本地声明事件名（W-05 零官方包运行时依赖）：DSH 官方包在运行时通过它们
// 自己的模块增强声明 'subagent/end'、'agent/error' 等事件；本插件不在编译期依赖
// 任何 @deepseek-ai/* 包，因此在本插件自己的 host program 里声明同名事件以通过
// ctx.on() 的类型检查。
//
// payload 取证（T-021，架构文档 §8 索引 #21/#22）：
//   - 'subagent/end'：官方 packages/subagent/subagent/src/types.ts SubagentRunEndInfo
//     { runId, provider, id, local, stopReason, lastAssistantMessage? }（L56-73）。
//     各字段声明为 unknown 的可选形状：处理器（orchestrator.handleSubagentEnd）
//     再做运行时守卫，与官方版本漂移时静默降级而非崩溃。
//   - 'agent/error'：官方 packages/core/agent/src/runtime-types.ts L290
//     { agent: Agent; turn: number; step: number; error: unknown }；本插件只需
//     agent.id 定位会话（父代理出错快速终止），其余字段 unknown 透传。
//
// 为什么必须先 import 真实模块再 declare module（实现陷阱，已验证）：裸的
// `declare module '@deepseek-ai/cordis'` 会覆盖 exports-map 解析出的真实模块类型
// （Context/Service 全部消失）；先 import 真实模块强制正常解析，随后的 declare
// module 才是标准合并语义。本文件仅进 host program，不与官方包 augmentation
// 合并冲突（两个 program 分离，见 tsconfig.host.json）。

import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 子代理生命周期结束事件（官方 subagent seam 观察语义，架构文档 §8 #21）。 */
    'subagent/end'(payload: {
      runId?: unknown
      provider?: unknown
      id?: unknown
      local?: unknown
      stopReason?: unknown
      lastAssistantMessage?: unknown
    }): void
    /** 代理回合错误事件（父代理出错快速终止路径，架构文档 §4.3 护栏 / §8 #22）。 */
    'agent/error'(payload: {
      agent?: { id?: unknown }
      turn?: unknown
      step?: unknown
      error?: unknown
    }): void
  }
}

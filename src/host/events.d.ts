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
    /**
     * 代理状态事件（运行活性基准刷新，自主编排方案 §5.1）：
     * 官方 packages/core/agent/src/runtime-types.ts L247-250
     *   payload: { agent: Agent; status: 'running' | 'idle' }（status 词表见 L240-246）。
     * 语义：父代理（会话根 Agent）从 idle 转 running 即「它在干活」——规划/思考/读写
     * 文件期间同样触发，据此刷新编排运行的空闲基准 lastActiveAt，避免长规划被空闲
     * 看护（runIdleTimeoutMs）误判为 idle 并自动 stopped。
     * status 声明为 unknown：官方词表漂移时由宿主做运行时守卫（只认 'running'）。
     */
    'agent/status'(payload: {
      agent?: { id?: unknown }
      status?: unknown
    }): void
    /**
     * 代理创建事件（子代理创建窗口内**异步串行**触发；用于提前安装每子代理作用域贡献）。
     * 【0.1.7-rc.1 取证】官方 `agent/session-start` 已移除，改为本事件：
     *   - 类型：dsh-agent/lib/types/runtime-types.d.ts L227-231
     *     `'agent/created'(payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal })`
     *     （SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'，L105）；
     *   - 派发点：dsh-agent/lib/index.js L579 `ctx.serial(entry.carrier, "agent/created", …)`
     *     位于 registry.announce 内 —— factory setup 完成后、creation resolve 之前，
     *     监听器按序 await 且**抛错会让创建失败**（故处理器不得抛错）；
     *     官方注释另明确「listeners must not await agent.whenIdle()」（L214-226）。
     *   - 全官方包 grep `agent/session-start` 零命中，无兼容别名。
     * payload 全字段声明为可选 unknown：处理器（visual-workflow-host.onAgentCreated）
     * 再做运行时守卫，与官方版本漂移时静默降级而非崩溃。
     */
    'agent/created'(payload: {
      agent?: { id?: unknown; ctx?: unknown }
      source?: unknown
      signal?: unknown
    }): void | Promise<void>
    /** 代理销毁事件（用于回收已安装的子代理作用域装配）。 */
    'agent/disposed'(payload: {
      agent?: { id?: unknown }
    }): void
    /**
     * 步骤提议瀑布（软截停护栏计步/消息替换；官方 runtime-types L231，§8 #5）。
     * 监听器可返回 { kind: 'enter', messages } 替换本步消息或经 next() 透传。
     */
    'agent/pre-step'(payload: unknown, next: () => Promise<unknown>): Promise<unknown> | unknown
    /** 回合将关闭（软截停护栏回合重置；官方 runtime-types L278，§8 #22）。 */
    'agent/turn-stopping'(payload: unknown): void
    /**
     * 系统提示词组装瀑布（思考强度注入 provider/model 变量；官方 model-selection
     * L40-53，§8 #4）。签名 (assembly, context, next) 与官方一致。
     */
    'system-prompt/assemble'(assembly: unknown, context: unknown, next: () => Promise<unknown>): Promise<unknown>
    /** 模型请求路由瀑布（思考强度注入 reasoningEffort；官方 model-selection L54-70，§8 #4）。 */
    'agent/request'(payload: unknown, next: () => Promise<unknown>): Promise<unknown>
  }
}

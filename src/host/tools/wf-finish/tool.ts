// src/host/tools/wf-finish/tool.ts
//
// wf_finish 工具注册（编排收尾：终态化 + 落记录 + 释放运行锁）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 身份派生（callerOf）+ 归属校验」，
//     终态判定/幂等/暂停恢复/落盘全部收敛在编排运行时（host.orchestrator.wfFinish）；
//   - 工具可见性：仅父代理可见（子代理侧经白名单剔除 + tools.restrict 双保险隐藏，
//     本层再以 callerOf 归属校验兜底 WF_NOT_ROOT）。
//
// 提示词规范：description 使用官方标准英文，第一句写明「何时调用」，
// 随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（幂等收尾）；目标 ≤ 120 tokens。

import { WF_FINISH } from '../../shared/protocol.js'
import { callerOf, type WfToolsHost } from '../infrastructure/caller.js'
import { defineTool, type ToolDefinitionLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'

/**
 * 注册 wf_finish（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfFinish(
  ctx: { get(name: string): unknown },
  host: WfToolsHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_finish')
  }

  const definition = defineTool({
    name: WF_FINISH,
    description:
      'Finish the active Visual Workflow orchestration. Call once when the whole flow is complete or cannot continue: marks the run completed/failed, persists the record, and releases the run lock; ' +
      'a paused or stopped run is resumed first so the closure is recorded. Repeated calls on a finished run return idempotently. ' +
      'Only the parent agent may call this; child agents are rejected (WF_NOT_ROOT).',
    parameters: {
      status: { type: 'string', enum: ['completed', 'failed'] as const, description: 'completed (default) or failed.' },
      summary: { type: 'string', description: 'Short summary: finished nodes, key conclusions, open issues (a few hundred characters).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'Whether the finish was accepted.' },
          runId: { type: 'string', required: true, description: 'The finished run id.' },
          status: { type: 'string', required: true, enum: ['completed', 'failed', 'stopped', 'paused', 'interrupted'] as const, description: 'Terminal run status.' },
          idempotent: { type: 'boolean', description: 'True when the run was already terminal (idempotent repeat).' },
        },
      },
      render: textRender,
    },
    execute: (args, exec) => host.orchestrator.wfFinish(callerOf(exec), args ?? {}),
  })

  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为（工具可能已被外部注销）
    }
  }
}

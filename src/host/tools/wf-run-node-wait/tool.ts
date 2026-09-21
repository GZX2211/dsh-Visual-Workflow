// src/host/tools/wf-run-node-wait/tool.ts
//
// wf_run_node_wait 工具注册（模式二后台服务：阻塞等待节点完成，返回 ok/fail + 最终输出）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 身份派生（callerOf）+ 归属校验」，
//     阻塞等待/快照/护栏/暂停门全部收敛在编排运行时；
//   - 与 wf_run_node 的差异仅两点：expectedMode 为 mode2、运行时参数追加 wait: true；
//     两者共用同一运行时入口（host.orchestrator.wfRunNode），不互相调用；
//   - 工具可见性：仅父代理可见（子代理侧经白名单剔除 + tools.restrict 双保险隐藏，
//     本层再以 callerOf 归属校验兜底 WF_NOT_ROOT）。
//
// 提示词规范：description 与参数说明使用官方标准英文，第一句写明「何时调用」，
// 随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（阻塞等待）；目标 ≤ 120 tokens。

import { WF_RUN_NODE_WAIT } from '../../shared/protocol.js'
import { callerOf, type WfToolsHost } from '../infrastructure/caller.js'
import { defineTool, type ToolDefinitionLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'

/**
 * 注册 wf_run_node_wait（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfRunNodeWait(
  ctx: { get(name: string): unknown },
  host: WfToolsHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_run_node_wait')
  }

  const definition = defineTool({
    name: WF_RUN_NODE_WAIT,
    description:
      'Start one agent node of a service run and block until it finishes. Use only in mode2: pass the node id from the flow definition file. ' +
      'Returns ok/fail with the child final output when the node child completes, or paused for a pause-node id. ' +
      'If the run is paused or stopped, this call first resumes it from the checkpoint and then starts the node. ' +
      'Child agents are rejected; fails with WF_* codes on invalid arguments, missing nodes, or mode mismatch.',
    parameters: {
      nodeId: { type: 'string', required: true, description: 'Node id from the flow definition file (nodes[].id) to start. A proxy node is a real flow step: pass the proxy id and the runtime resolves it to its source node for execution — never skip a proxy or pass its source node id instead.' },
      thinking: { type: 'string', description: 'Optional reasoning-effort override for this node run; value domain follows the official adapter.' },
      iterationLimit: { type: 'number', description: 'Optional ReAct iteration-limit override (soft cap: the child stops calling tools and concludes).' },
      retryLimit: { type: 'number', description: 'Optional per-node retry-limit override (hard guard, over the node default).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeId: { type: 'string', required: true, description: 'The resolved node id that was started.' },
          status: { type: 'string', required: true, enum: ['paused', 'ok', 'fail'] as const, description: 'ok/fail: blocked wait result; paused: pause gate.' },
          childId: { type: 'string', description: 'The node child session id (wait path).' },
          output: { type: 'string', description: 'Final child output summary (ok/fail wait path).' },
        },
      },
      render: textRender,
    },
    execute: (args, exec) => host.orchestrator.wfRunNode(callerOf(exec), { ...(args ?? {}), wait: true }, exec.signal, { expectedMode: 'mode2' }),
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

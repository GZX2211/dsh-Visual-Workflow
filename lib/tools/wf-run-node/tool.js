// src/host/tools/wf-run-node/tool.ts
//
// wf_run_node 工具注册（模式一编排执行：仅异步非阻塞启动，不提供 wait 参数）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 身份派生（callerOf）+ 归属校验」，
//     执行语义（运行锁/快照/护栏/暂停门）全部收敛在编排运行时；
//   - 工具可见性：仅父代理可见（子代理侧经白名单剔除 + tools.restrict 双保险隐藏，
//     本层再以 callerOf 归属校验兜底 WF_NOT_ROOT）。
//
// 提示词规范：description 与参数说明使用官方标准英文，第一句写明「何时调用」，
// 随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（异步启动）；目标 ≤ 120 tokens。
import { WF_RUN_NODE } from '../../shared/protocol.js';
import { callerOf } from '../infrastructure/caller.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { textRender } from '../infrastructure/text-render.js';
/**
 * 注册 wf_run_node（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfRunNode(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_run_node');
    }
    const definition = defineTool({
        name: WF_RUN_NODE,
        description: 'Start one agent node of an orchestration run asynchronously. Use only in mode1: pass the node id from the flow definition file. ' +
            'Returns started with the child id immediately; do not wait for the node child. ' +
            'If the run is paused or stopped, this call first resumes it from the checkpoint (no need to press Run on the canvas) and then starts the node. ' +
            'A pause-node id pauses the run and persists a checkpoint instead (returns paused). ' +
            'Child agents are rejected; fails with WF_* codes on invalid arguments, missing nodes, mode mismatch, or a session that never started a run.',
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
                    status: { type: 'string', required: true, enum: ['started', 'paused'], description: 'started: async start; paused: pause gate.' },
                    childId: { type: 'string', description: 'The node child session id (started path).' },
                },
            },
            render: textRender,
        },
        execute: (args, exec) => host.orchestrator.wfRunNode(callerOf(exec), args ?? {}, exec.signal, { expectedMode: 'mode1' }),
    });
    const dispose = tools.register(definition);
    return () => {
        try {
            dispose();
        }
        catch {
            // 注销尽力而为（工具可能已被外部注销）
        }
    };
}
//# sourceMappingURL=tool.js.map
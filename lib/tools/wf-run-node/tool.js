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
import { registerTool, requireToolsService } from '../infrastructure/register-tool.js';
import { textRender } from '../infrastructure/text-render.js';
/**
 * 注册 wf_run_node（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfRunNode(ctx, host) {
    const tools = requireToolsService(ctx, WF_RUN_NODE);
    const definition = defineTool({
        name: WF_RUN_NODE,
        description: 'Start one agent node of a mode1 orchestration run asynchronously and return the child id immediately; do not wait for the child. ' +
            'A node that belongs to a Team card starts as an official Team member (the official teammate path); other nodes start as ordinary child agents. ' +
            'A paused, stopped, or interrupted run is resumed before the node starts; a pause-node id pauses the run instead and returns paused.',
        parameters: {
            nodeId: { type: 'string', required: true, description: 'Node id from the flow definition file (nodes[].id): a role node, including a node that belongs to a Team card (a Team card itself is only a wrapper and is rejected). A proxy node is a real flow step: pass the proxy id and never skip a proxy or pass its source node id instead.' },
            thinking: { type: 'string', description: 'Optional reasoning-effort override for this node run.' },
            iterationLimit: { type: 'number', description: 'Optional ReAct iteration-limit override (soft cap: the child concludes).' },
            retryLimit: { type: 'number', description: 'Optional per-node retry-limit override (hard guard).' },
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
    return registerTool(tools, definition);
}
//# sourceMappingURL=tool.js.map
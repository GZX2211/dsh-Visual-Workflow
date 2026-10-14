// src/host/orchestrator/task-blocks.ts
//
// 节点任务块与节点契约（纯函数）：首条用户消息的组装、输入/输出契约解析。
// 事实来源统一走 graph-facts.buildNodeContextFacts（与父代理执行单元共用同一上下文口径）。
import { buildNodeTaskBlock } from '../prompts/index.js';
import { isGroupMember } from '../graph/index.js';
import { buildNodeContextFacts, collabBlockOf } from './graph-facts.js';
/**
 * 解析节点任务块的输入契约（data.inputSchema）。
 * 语义：告诉子代理「你应当收到什么输入」，避免它重复索要上游已给出的信息。
 * 纯函数；未配置返回空串（不组装该段）。
 */
export function inputContractOf(node) {
    return String(node.data?.inputSchema ?? '').trim();
}
/**
 * 解析节点的**输出契约**（data.outputSchema）。
 *
 * 语义（用户裁决 2026-10）：不再有「有无下游 / 有无 ctx 出线」的注入判据——统一注入、
 * 但可注入为空。空串即该节点不配置契约（任务块不出现契约段）；配置文本逐字生效，
 * 不与默认文本叠加（默认文本在新建节点时已落盘，界面显示与实际注入是同一个值）。
 */
export function outputContractOf(node) {
    return String(node.data?.outputSchema ?? '').trim();
}
/** 节点任务块组装：角色任务上下文 + 输入/输出契约 + 软约束 + 执行与交付约定。 */
export function buildNodeBlocks(input) {
    const { flow, node } = input;
    const data = node.data;
    const { upstreamContext, filePaths, dbToolHint } = buildNodeContextFacts({
        flow,
        node,
        snapshot: input.snapshot,
        documentTextLimit: input.documentTextLimit,
    });
    const outputContract = outputContractOf(node);
    const text = buildNodeTaskBlock({
        facts: {
            nodeLabel: data.label || node.id,
            upstreamContext,
            filePaths,
            dbToolHint,
            isGroupMember: isGroupMember(flow, node.id),
            collabChannel: input.collabChannel ?? 'legacy',
            inputContract: inputContractOf(node),
            outputContract,
            systemLanguage: input.systemLanguage,
        },
    });
    // 协作组成员：把成员清单块（含成员标识 + 角色名 + 自定义说明）追加到首条用户消息。
    // 协作信息不作为系统提示词段注入，只进用户消息。
    const collabBlock = collabBlockOf(flow, node.id, input.collabChannel ?? 'legacy');
    return [{ type: 'text', text: collabBlock ? `${text}\n\n${collabBlock}` : text }];
}
//# sourceMappingURL=task-blocks.js.map
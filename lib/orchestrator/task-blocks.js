// src/host/orchestrator/task-blocks.ts
//
// 节点任务块与交接契约（纯函数）：首条用户消息的组装、输入结构说明、输出契约解析。
// 事实来源统一走 graph-facts.buildNodeContextFacts（与父代理执行单元共用同一上下文口径）。
import { buildNodeTaskBlock, DEFAULT_OUTPUT_CONTRACT } from '../prompts/index.js';
import { buildFlowDag, detectCycleNodes, isFlowLine, isGroupMember, mainNodeIdOf, nodeById } from '../graph/index.js';
import { buildNodeContextFacts, collabBlockOf } from './graph-facts.js';
import { absoluteInputPath, executionOf } from './execution-inputs.js';
import { boundNodeInputs } from "./input-handoff.js";
/** Hint only for a consumer supported by automatic handoff; graph and run facts remain unchanged. */
function hasAutoOutputConsumer(flow, node, snapshot) {
    if (snapshot?.handoffPolicy !== "auto" || node.kind !== "agent" || isGroupMember(flow, node.id))
        return false;
    const idOf = (id) => mainNodeIdOf(flow, id) ?? id;
    const lines = flow.lines.filter(isFlowLine).map((line) => ({ ...line, source: idOf(line.source), target: idOf(line.target) }));
    const candidates = lines.filter((line) => line.source === node.id).filter((line) => {
        const target = nodeById(flow, line.target);
        if (target?.kind !== "agent" || isGroupMember(flow, target.id) || executionOf(target).inputSource === "ctx")
            return false;
        if (flow.lines.some((edge) => idOf(edge.target) === target.id && edge.targetHandle === "ctx-in"))
            return false;
        if (Object.values(boundNodeInputs(snapshot, target.id)).some((values) => values.length))
            return false;
        const incoming = lines.filter((edge) => edge.target === target.id);
        return incoming.every((edge) => edge.source === node.id && !edge.condition);
    });
    if (!candidates.length)
        return false;
    const cycles = detectCycleNodes(buildFlowDag(flow.nodes, lines));
    return !cycles.has(node.id) && candidates.some((line) => !cycles.has(line.target));
}
/**
 * 解析节点任务块的输入结构说明（data.inputSchema）。
 * 语义：告诉子代理「你应当收到什么输入」，避免它重复索要上游已给出的信息。
 * 纯函数；未配置返回空串（不组装该段）。
 */
export function inputContractOf(node) {
    return String(node.data?.inputSchema ?? '').trim();
}
/**
 * 解析节点的**交接契约**（data.outputSchema，或系统默认结构）。
 *
 * 为什么需要兜底（用户裁决 2026.09）：子代理的最终回复会被下游 ctx 连线节点逐字读到
 * （buildNodeContextFacts 读快照 nodes[].output）；若上游节点没有声明输出结构，
 * 管道虽然接通、两端却没有协议，下游只能面对一段自由文本。因此：
 *   - 该节点**存在 ctx-out 出线**（确有下游要读它）且未配置 outputSchema → 注入默认结构；
 *   - auto 运行的简单 Flow 消费者沿用同一默认契约；显式绑定/ctx/复杂图不补充；
 *   - 无消费方的终端节点 → 不注入（不给它添无关约束）；
 *   - 已配置 outputSchema → 以配置为准，默认结构作为「至少包含」的补充。
 * 纯函数；不做任何结构校验（用户裁决 A3：柔性文本契约）。
 */
export function outputContractOf(flow, node, snapshot) {
    const configured = String(node.data?.outputSchema ?? '').trim();
    const hasConsumer = (flow.lines ?? []).some((line) => line.source === node.id && line.sourceHandle === 'ctx-out');
    if (configured) {
        return {
            text: hasConsumer ? `${configured}（至少包含：${DEFAULT_OUTPUT_CONTRACT}）` : configured,
            defaulted: false,
        };
    }
    return hasConsumer || hasAutoOutputConsumer(flow, node, snapshot) ? { text: DEFAULT_OUTPUT_CONTRACT, defaulted: true } : { text: '', defaulted: false };
}
/** 节点任务块组装：角色任务上下文 + 输入输出结构 + 软约束 + 执行与交付约定。 */
export function buildNodeBlocks(input) {
    const { flow, node } = input;
    const data = node.data;
    const { upstreamContext, filePaths, dbToolHint } = buildNodeContextFacts({
        flow,
        node,
        snapshot: input.snapshot,
        documentTextLimit: input.documentTextLimit,
    });
    const outputContract = outputContractOf(flow, node, input.snapshot);
    const execution = executionOf(node);
    for (const path of execution.requiredFiles ?? []) {
        const absolute = absoluteInputPath(path, input.snapshot.workingDirectory);
        if (!filePaths.includes(absolute))
            filePaths.push(absolute);
    }
    const text = buildNodeTaskBlock({
        facts: {
            nodeLabel: data.label || node.id,
            upstreamContext,
            runtimeInputs: input.effectiveInputs,
            hasAttachmentContext: input.hasAttachmentContext,
            handoffPolicy: input.snapshot.handoffPolicy,
            filePaths,
            workingDirectory: input.snapshot.workingDirectory,
            inputSource: execution.inputSource,
            outputFiles: (execution.outputFiles ?? []).map((path) => absoluteInputPath(path, input.snapshot.workingDirectory)),
            dbToolHint,
            isGroupMember: isGroupMember(flow, node.id),
            collabChannel: input.collabChannel ?? 'legacy',
            inputContract: inputContractOf(node),
            outputContract: outputContract.text,
            outputContractDefaulted: outputContract.defaulted,
            systemLanguage: input.systemLanguage,
        },
    });
    // 协作组成员：把成员清单块（含成员标识 + 角色名 + 自定义说明）追加到首条用户消息。
    // 协作信息不作为系统提示词段注入，只进用户消息。
    const collabBlock = collabBlockOf(flow, node.id, input.collabChannel ?? 'legacy');
    return [{ type: "text", text: collabBlock ? `${text}\n\n${collabBlock}` : text }];
}
//# sourceMappingURL=task-blocks.js.map
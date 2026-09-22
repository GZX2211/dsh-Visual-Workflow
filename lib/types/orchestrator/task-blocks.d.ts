import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
/**
 * 解析节点任务块的输入结构说明（data.inputSchema）。
 * 语义：告诉子代理「你应当收到什么输入」，避免它重复索要上游已给出的信息。
 * 纯函数；未配置返回空串（不组装该段）。
 */
export declare function inputContractOf(node: RoleNode): string;
/**
 * 解析节点的**交接契约**（data.outputSchema，或系统默认结构）。
 *
 * 为什么需要兜底（用户裁决 2026.09）：子代理的最终回复会被下游 ctx 连线节点逐字读到
 * （buildNodeContextFacts 读快照 nodes[].output）；若上游节点没有声明输出结构，
 * 管道虽然接通、两端却没有协议，下游只能面对一段自由文本。因此：
 *   - 该节点**存在 ctx-out 出线**（确有下游要读它）且未配置 outputSchema → 注入默认结构；
 *   - 无 ctx-out 出线的终端节点 → 不注入（不给它添无关约束）；
 *   - 已配置 outputSchema → 以配置为准，默认结构作为「至少包含」的补充。
 * 纯函数；不做任何结构校验（用户裁决 A3：柔性文本契约）。
 */
export declare function outputContractOf(flow: WorkflowDocument, node: RoleNode): {
    text: string;
    defaulted: boolean;
};
/** 节点任务块组装：角色任务上下文 + 输入输出结构 + 软约束 + 执行与交付约定。 */
export declare function buildNodeBlocks(input: {
    flow: WorkflowDocument;
    node: RoleNode;
    /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
    snapshot: RunSnapshot;
    documentTextLimit: number;
    /** 系统语言名（从 DSH 用户设置读取；注入「回复/注释/思考必须使用该语言」规则）。 */
    systemLanguage: string;
}): Array<{
    type: 'text';
    text: string;
}>;

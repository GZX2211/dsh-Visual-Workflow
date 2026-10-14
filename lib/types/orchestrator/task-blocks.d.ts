import { type CollabChannel } from '../prompts/index.js';
import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
/**
 * 解析节点任务块的输入契约（data.inputSchema）。
 * 语义：告诉子代理「你应当收到什么输入」，避免它重复索要上游已给出的信息。
 * 纯函数；未配置返回空串（不组装该段）。
 */
export declare function inputContractOf(node: RoleNode): string;
/**
 * 解析节点的**输出契约**（data.outputSchema）。
 *
 * 语义（用户裁决 2026-10）：不再有「有无下游 / 有无 ctx 出线」的注入判据——统一注入、
 * 但可注入为空。空串即该节点不配置契约（任务块不出现契约段）；配置文本逐字生效，
 * 不与默认文本叠加（默认文本在新建节点时已落盘，界面显示与实际注入是同一个值）。
 */
export declare function outputContractOf(node: RoleNode): string;
/** 节点任务块组装：角色任务上下文 + 输入/输出契约 + 软约束 + 执行与交付约定。 */
export declare function buildNodeBlocks(input: {
    flow: WorkflowDocument;
    node: RoleNode;
    /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
    snapshot: RunSnapshot;
    documentTextLimit: number;
    /** 系统语言名（从 DSH 用户设置读取；注入「回复/注释/思考必须使用该语言」规则）。 */
    systemLanguage: string;
    /**
     * 协作通道（仅组内成员有意义）：official = 官方 Agent Team 邮箱；legacy = 插件自建协作工具。
     * 缺省 legacy，保持未启用官方团队时的文案与行为。
     */
    collabChannel?: CollabChannel;
}): Array<{
    type: 'text';
    text: string;
}>;

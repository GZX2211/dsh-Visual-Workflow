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
 * 不与默认文本叠加。默认文本在新建节点时已落盘（中文规范值）；英文运行注入时，若内容
 * 与中文规范默认值逐字相等，则替换为英文默认文本（见 prompts/defaults.ts），自定义文本原样透传。
 */
export declare function outputContractOf(node: RoleNode): string;
/**
 * 节点任务块组装：角色任务上下文 + 输入/输出契约 + 可通信对象 + 软约束 + 执行与交付约定。
 *
 * 可通信对象清单**统一注入、不再区分通道**（用户裁决 2026-10）：成员与非成员走同一段，
 * 成员额外列出组内其他成员；团队自定义说明（Team 卡片 data.collabPrompt）作为「组内说明」
 * 并入同一段。此前按 official / legacy 分叉的协作块注入已删除。
 */
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

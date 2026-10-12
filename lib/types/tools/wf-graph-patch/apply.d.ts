import type { GraphNode, WorkflowDocument } from '../../shared/graph-model.js';
import type { GraphPatchOp, GraphPatchResult, MarkPatchOp, MarkPatchResult, PatchOpFailure } from './types.js';
/** 深拷贝文档骨架（保持元数据字段；节点/连线走 JSON 深拷贝避免共享引用）。 */
export declare function cloneDoc(doc: WorkflowDocument): WorkflowDocument;
/**
 * 协作组一致性：成员节点的 groupId 与组的 memberIds 双向对齐。
 * 入组：写 node.data.groupId；出组：置 null。组不存在或成员不存在 → 稳定错误。
 */
export declare function ensureGroupConsistency(nodes: GraphNode[], groupId: string, memberIds: string[]): GraphNode[];
/**
 * 角色节点默认重试上限（父代理不可配置；与画布新建角色节点保持一致）。
 */
export declare const DEFAULT_ROLE_RETRY_LIMIT = 3;
/**
 * 父代理**不可配置**的角色节点字段（画布所有；用户裁决）。
 *
 * 为什么：这些字段属于运行治理、提示词注入与「节点来源」范畴——retryLimit / reactLimit
 * 影响重试与 ReAct 截停，promptFilePath 会把角色提示词指向宿主文件，
 * injectSystemPrompt / injectToolSections 决定官方系统提示词段与工具散文段的注入；
 * sourceAssetId 是「该节点由哪个角色资产拖入而来」的事实，资产入库时据此登记源资产新版本，
 * 由父代理随意写入会让资产版本链指向错误的来源。
 * 因此一律不进入它的配置面：
 *   - create_node：剥离传入值，按系统默认写入；
 *   - update_node_data：剥离传入值，保留节点现值（用户手动改过的值不被覆盖）。
 * 注意：关闭注入开关只影响散文段与 assembly.contexts（工具调用能力由 tools[] 决定），
 * 且环境事实段（工作目录）不受该开关管辖。
 */
export declare const PARENT_UNCONFIGURABLE_ROLE_FIELDS: readonly ["retryLimit", "reactLimit", "promptFilePath", "injectSystemPrompt", "injectToolSections", "sourceAssetId"];
/**
 * 创建路径的系统默认值（父代理传入的对应字段一律忽略）。
 * 官方人设/系统散文段对节点子代理没有价值，只会与角色提示词重复，故注入开关固定关闭；
 * 重试与 ReAct 上限取系统默认。
 */
export declare function applyRoleNodeCreateDefaults(raw: unknown): Record<string, unknown>;
/**
 * 角色节点 data 补全（图结构补丁的**唯一规范化入口**）。
 *
 * 为什么必须有（2026.09 实机取证）：ops 是自由对象，`create_node` 只把 raw 原样落盘，
 * 父代理最自然的写法 `{ kind:'agent', data:{ label, systemPrompt } }` 会产出
 * `presetId: undefined` 的节点——而运行期 `resolveAgentTools` 对空 presetId 的判定是
 * **零工具集**（连 read/write 都调不到），`provider/model` 为空也会退化成宿主默认。
 * 检查器与 validateFlow 都不校验节点 data 形状，于是这类「空壳节点」会一路落盘到运行期
 * 才暴露。补齐默认值与画布新建角色（graph/model.ts 的 newRoleNode）完全一致，
 * 保证「父代理建出来的节点」与「用户拖出来的节点」形状无差异。
 *
 * 语义：`null` 与 `undefined` 一律视为未提供（补默认）；显式 `''` / 数字 / 布尔原样保留。
 */
export declare function normalizeRoleNodeData(raw: unknown): Record<string, unknown>;
/**
 * 应用图结构操作（按序，纯函数）。
 * 失败一律抛 WfError（稳定 code），调用方据此返回带修复建议的补丁错误。
 */
export declare function applyGraphOps(input: {
    doc: WorkflowDocument;
    ops: GraphPatchOp[];
}): GraphPatchResult;
/**
 * 容错应用：逐条复用严格应用器，失败的 op 记入 errors 并跳过，其余操作继续。
 *
 * 为什么容错（而不是遇到第一条就停）：ops 之间存在有序依赖，父代理最常见的失败模式是
 * 一批里多条字段写错；一次只报一条会让它把同一批补丁反复重试，而失败清单一次列全后
 * 可以一轮改完。
 * 为什么逐条调用严格应用器：严格应用器在**内部副本**上推进，抛错时本层已成功的结果
 * 分毫未动——失败 op 既不污染后续 op 的判定基础，也不需要回滚逻辑。
 * 为什么只捕获 WfError：非 WfError 属于工具自身的缺陷，不能被伪装成「某条 op 写错了」。
 * 语义前提：调用方在 errors 非空时**整批不落盘**，因此返回的结果仅供错误报告与后续 op
 * 的判定基础使用。
 */
export declare function applyGraphOpsTolerant(input: {
    doc: WorkflowDocument;
    ops: GraphPatchOp[];
}): {
    result: GraphPatchResult;
    errors: PatchOpFailure[];
};
/**
 * 运行状态标记（C 组）纯函数：校验节点存在 + 闸门预算，给出标记结果。
 * 状态机分工（P3）：**「必须是当前闸门轮 / 当前闸门节点」由 runMarkGroup 判定**
 * （需要入口 entry 与解析后的画布），本函数只负责与单据无关的校验——
 * status 取值（入参层）、节点是否在快照内、以及 status=ok 时的闸门预算（D-21：不含首次编排）。
 */
export declare function applyMarkOp(input: {
    op: MarkPatchOp;
    runId: string;
    nodeIds: string[];
    /** 已用闸门次数（P3 预算判定用；本轮由宿主缝给出 0）。 */
    milestoneUsed?: number;
    /** 元参数闸门上限（0 = 不限制）。 */
    milestoneMax?: number;
}): MarkPatchResult;

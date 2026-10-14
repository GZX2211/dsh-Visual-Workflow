import type { StudioState, EditorData, CanvasNode } from './studio-types.js';
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { ServiceState } from '../../host/shared/types.js';
import type { WorkflowAssetDetail } from '../../host/shared/asset-types.js';
/** 当前工作流文档（内存列表优先；草稿回退）。 */
export declare function currentFlowOf(state: StudioState): WorkflowDocument | null;
/** 当前工作流模板文档（模板态画布）。 */
export declare function currentFlowTemplateOf(state: StudioState): WorkflowTemplate | null;
/** 当前工作流资产文档（资产态画布；当前 id 必须与已装载的 assetDoc 同源）。 */
export declare function currentFlowAssetOf(state: StudioState): WorkflowAssetDetail | null;
/**
 * 模板态与资产态共用「创建实例」前置（实例只能由模版/资产生成）：
 * 二者画布内容语义一致（编辑中的草稿 → 保存为实例），运行入口也走同一分支。
 */
export declare function isInstanceSourceKind(kind: StudioState['currentKind']): boolean;
/** 当前服务文档。 */
export declare function currentServiceOf(state: StudioState): ServiceState | null;
/**
 * P4：当前文档里「父代理最近一次补丁」（origin='agent'）改动的节点 id。
 * 用途：画布给这些节点加「AI 调整」角标，让用户理解画布为何变了。
 * 语义边界：用户一旦在画布上保存，宿主侧的 stripClientMeta 会清除 lastPatch
 * （客户端快照里本来就没有该字段），所以角标只反映「尚未被用户确认的代理改动」。
 * 纯函数；非法/缺失一律返回空数组（旧数据零影响）。
 */
export declare function agentPatchedNodeIdsOf(state: StudioState): string[];
/** 当前运行状态（running 判定）。 */
export declare function isRunningOf(state: StudioState): boolean;
/**
 * 当前**实例**是否处于「运行中」（模式一；运行中实例的保存二次确认与画布锁定共用）。
 * 判定来源双保险：① 当前跟踪的 run 快照（flowId 必须等于当前实例，避免跟踪到别的实例）；
 * ② 全量活跃 run 摘要轮询（跨会话/外部触发也能判定）。
 * 模式二按用户裁决保持现状（服务常驻运行，无「运行中画布」语义），恒为 false。
 * 暂停（paused）不算运行中：暂停时保存既不弹确认、也不锁画布。
 */
export declare function instanceRunningOf(state: StudioState): boolean;
/**
 * 活跃 run 摘要的投影类型：实例列表状态徽标（全量活跃 run → 按实例定位）。
 * 投影与索引都保留 runId/sessionId——徽标之外的运行对账（Studio）也消费同一份索引。
 */
export interface ActiveRunBadge {
    status: string;
    runId: string;
    sessionId: string;
}
/**
 * 活跃 run 摘要 → 以「实例（flowId+sessionId）」为键的索引，供实例列表按实例 O(1) 取状态徽标
 * （此前每实例一次全量 `activeRuns.find` 线性查找，n 个实例即 n 次全表扫描）。
 * 纯函数：输入即全部事实，不读全局；同一 key 重复出现时以最后一条为准（列表顺序即权威）。
 * 只丢弃缺 flowId 的脏条目（无法归属实例）——其余字段缺失按空串降级，不改变既有展示口径。
 */
export declare function activeRunIndexOf(state: StudioState): Map<string, ActiveRunBadge>;
/** 实例 → 运行徽标（activeRunIndex 键）；无活跃 run 返回 null。 */
export declare function activeRunBadgeOf(index: ReadonlyMap<string, ActiveRunBadge>, flowId: string, sessionId: string): ActiveRunBadge | null;
/** 实例列表的运行状态徽标数据源（左栏/底栏共用；`currentSnapshot` 为该实例的更即时快照）。 */
export interface InstanceRunBadge {
    /** 活跃 run 摘要（来自全量轮询）；null = 无活跃 run。 */
    active: ActiveRunBadge | null;
    /** 当前跟踪 run 快照的 status（仅当快照属于该实例）；无法判定当前实例时为 null。 */
    currentSnapshot: string | null;
}
/**
 * 按实例投影运行状态徽标（渲染层不再做全量线性查找）：**一次**扫描活跃 run 建索引
 * （O(n+m)），逐实例只做一次 Map 查询。顺序与入参一致，不改变已有语义：
 * 快照优先于活跃摘要由消费方（实例列表）按既有口径决定。
 */
export declare function instanceRunBadgesOf(flows: ReadonlyArray<{
    id: string;
    sessionId: string;
}>, current: {
    runId: string | null;
    snapshot: {
        flowId: string;
        status: string;
    } | null;
}, index: ReadonlyMap<string, ActiveRunBadge>): Map<string, InstanceRunBadge>;
/**
 * Team 成员显示名（唯一本体）：成员节点缺失或 label 缺失/为 null 时回退成员 id。
 * 画布 Team 卡片（GraphCanvas）与右侧属性栏（editorDataOf）共用，避免两处各写一份回退规则。
 * 只接受已解析出的成员节点，节点的查找方式（Map / find）由调用方决定。
 */
export declare function memberLabelOf(member: CanvasNode | undefined, memberId: string): string;
/** 编辑器数据（右侧面板渲染源）。 */
export declare function editorDataOf(state: StudioState): EditorData | null;
/** 折叠/切换循环长度（共 3 态：左展开→切换底栏→收起底栏→左展开）。 */
export declare const PANEL_CYCLE_LEN = 3;
/** 循环位置枚举：0=左栏展开 1=底栏展开 2=收起底栏/左栏(全隐)。 */
export declare const PANEL_MODE_LEFT = 0;
export declare const PANEL_MODE_BOTTOM = 1;
export declare const PANEL_MODE_NONE = 2;
/** 折叠/切换下一步循环位置（左展→切换底栏→收起底栏→左展）。 */
export declare function nextPanelMode(mode: number): number;
/** 左栏是否展开（循环位置 0）。 */
export declare function leftPanelOpenOf(state: StudioState): boolean;
/** 底栏是否展开（循环位置 1）。 */
export declare function bottomPanelOpenOf(state: StudioState): boolean;
/** 是否处于「全隐」态（循环位置 2：收起底栏/左栏，仅画布）。 */
export declare function panelsFullyCollapsedOf(state: StudioState): boolean;
/**
 * 右侧属性栏是否显示：默认隐藏（折叠），仅当选中「具备属性」的对象时才展开。
 * 判定 = 编辑对象存在且其属性栏类型不是「阶段」（阶段节点/侧栏阶段卡片不具备属性，不弹）；
 * 其余（实例/工作流/服务/模板/角色/文件/数据库/Team/连线/画布角色节点含父代理节点/虚拟节点）都弹。
 * 注意：父代理模板也具备属性（属性栏显示模板内容），此处一并弹出。
 */
export declare function inspectorOpenOf(state: StudioState): boolean;

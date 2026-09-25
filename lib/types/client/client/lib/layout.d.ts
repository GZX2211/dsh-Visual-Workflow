import type { LayoutNodeInput, LayoutOptions, LayoutResult } from './layout-types.js';
import type { Line } from '../../host/shared/graph-model.js';
/**
 * 主干类节点 kind（参与流程主干；与 host NODE_HANDLES 的流程通道能力对应）。
 * proxy 是主节点的分身，同样属于主干（用户口径：主干 = 除 file/database 之外的全部节点）。
 */
export declare const SPINE_KINDS: ReadonlySet<string>;
/** 数据类节点 kind（上下文/数据库来源；按 (n-1) 列分布在主干两旁）。 */
export declare const DATA_KINDS: ReadonlySet<string>;
/** 仅流程线参与主干分层（ctx-out→ctx-in / db-out→db-in 不参与）。 */
export declare function isFlowLine(line: Line): boolean;
/**
 * 数据节点的关联线：文件（ctx-out）或数据库（db-out）指向角色节点的注入线。
 * 与 isFlowLine 严格互补——同一批连线只会被其中一侧消费，不会既进主干又当数据关联。
 */
export declare function isDataLine(line: Line): boolean;
/**
 * 布局输入装配：把节点投影为「尺寸 + 关系」元数据。
 * 尺寸由调用方提供（通常是 card-geometry.nodeSizeOf），布局不反向依赖渲染细节。
 */
export declare function toLayoutInputs(nodes: Array<{
    id: string;
    kind: string;
    data?: Record<string, unknown>;
}>, sizeOf: (node: {
    id: string;
    kind: string;
    data?: Record<string, unknown>;
}) => {
    w: number;
    h: number;
}): LayoutNodeInput[];
/**
 * 主轴上下堆叠：给定各卡片高与基准轴心，返回以轴心为中心、间隔不小于 gap 的对称落点。
 * 规则（用户裁决）：主轴那条水平线始终穿过主干卡片的中心——单卡居中于轴，
 * 多卡以轴为中心上下均分（间距 = max(gap, 均分值)），数据节点贴轴上下堆叠。
 */
export declare function axisOffsets(heights: number[], axisY: number, gap: number): number[];
/**
 * 分层布局主函数（纯函数：同输入同输出，不读时钟/随机源）。
 *
 * 步骤：① 主干/数据分类与折叠 → ② 主干分层（flow 边，环被剔除）→ ③ 主干层内排序 →
 * ④ 数据节点 (n-1) 列推导 → ⑤ 主轴共线 + 列内均分 + 数据节点贴轴堆叠 + 列右对齐 → ⑥ 孤立列兜底。
 */
export declare function layoutGraph(nodes: LayoutNodeInput[], lines: Line[], options?: LayoutOptions): LayoutResult;

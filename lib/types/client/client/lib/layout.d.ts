import type { LayoutNodeInput, LayoutOptions, LayoutResult } from './layout-types.js';
import type { Line } from '../../host/shared/graph-model.js';
/** 仅流程线参与分层（ctx-out→ctx-in / db-out→db-in 不参与）。 */
export declare function isFlowLine(line: Line): boolean;
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
 * 分层布局主函数（纯函数：同输入同输出，不读时钟/随机源）。
 */
export declare function layoutGraph(nodes: LayoutNodeInput[], lines: Line[], options?: LayoutOptions): LayoutResult;

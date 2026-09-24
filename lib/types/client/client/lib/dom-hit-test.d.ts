/** 命中检测：鼠标坐标下的节点 id（最近 data-wf-node-id 祖先）。
 *  环境不提供 elementFromPoint 时返回 null（降级不抛错，与 groupSurfaceUnderPoint 一致）。 */
export declare function connectionTargetAt(clientX: number, clientY: number): string | null;
/**
 * 协作组表面命中（入组判定，用户批注 §4.2.5.2 收紧：仅组卡片表面可入组）：
 *  - 跳过不在协作组内的元素（画布空白/连线 SVG/其他节点等装饰层）；
 *  - 跳过被拖拽本体节点（拖拽时节点被挪到鼠标下方，若不排除会遮蔽组表面命中）；
 *  - 命中 `.wf-graph__handle`（连接点）→ 返回 null：连接点**不具入组功能**。
 * 返回命中的协作组 id；否则 null。纯函数接收元素数组，便于 jsdom 单测。
 */
export declare function groupSurfaceFromElements(elements: Element[], excludeNodeId?: string | null): string | null;
/** 鼠标坐标下的协作组表面（入组落点；封装 elementsFromPoint，供拖拽 onMove/onUp 共用）。 */
export declare function groupSurfaceUnderPoint(clientX: number, clientY: number, excludeNodeId?: string | null): string | null;

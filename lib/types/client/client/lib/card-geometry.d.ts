/**
 * 卡片尺寸解析的最小节点形状：只读本模块真正消费的 kind/data。
 * 同时容忍调用方传入的完整节点（id/position 等冗余字段），避免各调用点为类型擦除做断言。
 */
export interface SizedNodeLike {
    id?: string;
    kind?: string;
    position?: {
        x: number;
        y: number;
    };
    data?: Record<string, unknown>;
}
export declare const GRAPH_NODE_WIDTH = 208;
export declare const GRAPH_NODE_HEIGHT = 116;
export declare const GRAPH_NODE_SIZE: {
    w: number;
    h: number;
};
/** 阶段节点（启动/结束/暂停）紧凑卡片：流程门无需大卡，避免占用画布空间。 */
export declare const GRAPH_STAGE_WIDTH = 168;
export declare const GRAPH_STAGE_HEIGHT = 88;
export declare const GRAPH_STAGE_SIZE: {
    w: number;
    h: number;
};
export declare const GRAPH_GROUP_WIDTH = 300;
export declare const GRAPH_GROUP_HEIGHT = 220;
/** 组内成员行高/列表起始（与 GroupCard 布局一致，连线锚点用；成员为迷你角色卡，略高于纯文本行）。 */
export declare const GROUP_MEMBER_ROW_H = 38;
export declare const GROUP_MEMBER_LIST_TOP = 78;
/** 组卡片内成员横向留白（渲染尺寸与布局坐标共用同一常量）。 */
export declare const GROUP_MEMBER_PADDING = 10;
/** 节点实际尺寸（协作组卡片可拉伸，尺寸存 data.size；阶段节点用紧凑卡）。 */
export declare function nodeSizeOf(node: SizedNodeLike): {
    w: number;
    h: number;
};
/**
 * 协作组卡片最小尺寸（容纳成员列表所需高度；宽度保持用户拉伸值）。
 * 布局与自动布局判定共用同一口径，避免「布局算出的高度」与「渲染高度」漂移。
 * 纯函数：只读 data.memberIds / data.size，不读时钟/随机源。
 */
export declare function groupCardSizeOf(node: SizedNodeLike): {
    w: number;
    h: number;
};

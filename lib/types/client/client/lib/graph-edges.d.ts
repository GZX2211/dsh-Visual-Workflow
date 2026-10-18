import type { Line } from '../../host/shared/graph-model.js';
import type { CanvasEdge } from './canvas-model.js';
/** 条件连线标签的文案来源（由渲染层从词典注入；lib 不持有用户可见文案）。 */
export interface LineLabelCopy {
    /** 通过条件文案（如「通过」）。 */
    pass: string;
    /** 不通过条件文案。 */
    fail: string;
    /** 内容条件的兜底文案（条件 label 为空时使用）。 */
    content: string;
}
/** 条件连线标签：方括号包裹，内容条件截断到 12 字。 */
export declare function conditionLabel(condition: Line['condition'] | null | undefined, labels: LineLabelCopy): string;
/**
 * 连线颜色 class（条件 pass|fail|content / 通道 db / ctx / 默认 flow 空串）。
 * 优先级（用户裁决 2026-02）：**条件优先**——用户显式设了条件就显示条件颜色，
 * 否则按通道着色。画布渲染与投影共用本函数（唯一本体）。
 */
export declare function lineColorClass(line: Line): string;
/**
 * 角色卡右「上下文出」已从 UI 退役（用户批注）：连线数据保留（旧图零迁移），
 * 但不再渲染、不可交互；运行期本就不再生效。task 等其他来源的 ctx-out 不受影响。
 */
export declare function isRetiredRoleContextOutEdge(line: {
    sourceHandle?: string;
}, sourceKind: string | undefined): boolean;
/**
 * 存储连线 → 画布连线（唯一映射本体）：只保留语义字段，条件对象浅拷贝
 * （视图编辑不得回写文档内对象）。
 */
export declare function lineToCanvasEdge(line: Line): CanvasEdge;

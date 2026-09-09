/** 输出块（工具 render 返回形态：text 块数组）。 */
export interface RenderTextBlock {
    type: 'text';
    text: string;
}
/** 递归按键名排序的稳定 JSON 序列化（键序稳定；数组保持原序）。 */
export declare function stableStringify(value: unknown): string;
/**
 * 统一工具输出渲染：字符串原样、结构化值稳定序列化（键序稳定）。
 * 所有 wf_* 工具与数据工具共用，保证结果文本形态一致。
 */
export declare function textRender(_args: Record<string, unknown>, value: unknown): RenderTextBlock[];

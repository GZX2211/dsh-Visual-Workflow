export declare const CARD_DESC_MAX = 80;
/** 内置常用工具中文描述映射（未命中回退原文，英文加 [EN] 前缀；导出供单测做中/英键对称门禁）。 */
export declare const TOOL_ZH: Record<string, string>;
/** 内置常用工具英文描述映射（与 TOOL_ZH 同键；未命中回退 schema 原文，不加 [EN] 前缀）。 */
export declare const TOOL_EN: Record<string, string>;
/**
 * 组合管理卡片描述（纯函数，导出供单测）：
 *   - 中文界面：命中 TOOL_ZH → 短中文；未命中 → schema 原文（英文加 [EN] 前缀标记
 *     「这条不是中文」，已是中文则原样）；空描述 → 中文占位。
 *   - 非中文界面：命中 TOOL_EN → 短英文；未命中 → schema 原文（不加 [EN] 前缀——
 *     该前缀只在中文界面里表达「未翻译」）；空描述 → 英文占位。
 *   - **一律按 CARD_DESC_MAX 截断**（超长描述不得撑破卡片）。
 * @param chinese - 是否用中文呈现（由 API 边界的 isChinesePresentation 判定）。
 */
export declare function toolCardDescription(name: string, fallback: string, chinese: boolean): string;

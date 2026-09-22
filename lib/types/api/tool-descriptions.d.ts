export declare const CARD_DESC_MAX = 80;
/**
 * 组合管理卡片描述（纯函数，导出供单测）：
 *   - 命中 TOOL_ZH → 短中文；
 *   - 未命中 → schema 原文（英文加 [EN] 前缀；已是中文则原样）；
 *   - **一律按 CARD_DESC_MAX 截断**（超长描述不得撑破卡片）。
 */
export declare function zhDescription(name: string, fallback: string): string;

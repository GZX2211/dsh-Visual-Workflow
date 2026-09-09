/** 默认语言名（插件默认中文界面；官方未显式选择时按浏览器语言回退，本处保守取中文）。 */
export declare const DEFAULT_SYSTEM_LANGUAGE = "\u4E2D\u6587";
/** settings 服务最小结构（读取 locale 命名空间解析值；零官方类型依赖）。 */
export interface SettingsServiceLike {
    /** 读取某命名空间的解析值（未注册返回 undefined）。 */
    get?(ns: string): unknown;
}
/**
 * 从 settings 服务读取系统语言名。
 * 映射：'zh' 前缀 → '中文'；'en' 前缀 → 'English'；其余/缺失 → DEFAULT_SYSTEM_LANGUAGE。
 * 纯函数：输入 settings 对象不变则输出不变；不读时钟/随机源。
 */
export declare function systemLanguageOf(settings: SettingsServiceLike | null | undefined): string;
/**
 * 从语言名反推是否中文（供提示词措辞选择）。
 * 纯函数。
 */
export declare function isChineseSystemLanguage(language: string): boolean;

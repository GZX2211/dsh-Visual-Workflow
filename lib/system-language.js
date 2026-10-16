// src/host/system-language.ts
//
// Host fallback for headless callers. UI runs carry the active Client locale because
// automatic browser/native selection need not persist locale.preference on the Host.
/** 默认语言名（插件默认中文界面；官方未显式选择时按浏览器语言回退，本处保守取中文）。 */
export const DEFAULT_SYSTEM_LANGUAGE = '中文';
/** locale 设置所属的 profile entry id（官方 LOCALE_SETTINGS_NAMESPACE 同名）。 */
const LOCALE_SETTINGS_NS = 'locale';
/**
 * 从 settings 服务读取系统语言名。
 * 映射：'zh' 前缀 → '中文'；'en' 前缀 → 'English'；其余/缺失 → DEFAULT_SYSTEM_LANGUAGE。
 * 纯函数：输入 settings 对象不变则输出不变；不读时钟/随机源。
 */
export function systemLanguageOf(settings) {
    try {
        const descriptors = settings?.describe?.();
        if (!Array.isArray(descriptors))
            return DEFAULT_SYSTEM_LANGUAGE;
        const locale = descriptors.find((row) => row?.ns === LOCALE_SETTINGS_NS);
        return systemLanguageFromLocale(locale?.value?.preference) ?? DEFAULT_SYSTEM_LANGUAGE;
    }
    catch {
        // settings 服务异常：回退默认语言
    }
    return DEFAULT_SYSTEM_LANGUAGE;
}
/**
 * 从语言名反推是否中文（供提示词措辞选择）。
 * 纯函数。
 */
export function isChineseSystemLanguage(language) {
    return String(language ?? '').startsWith('中');
}
/** Recognize English locale IDs and the resolved model-facing language name. */
export function isEnglishSystemLanguage(language) {
    return /^(en(?:-|$)|english$)/i.test(String(language ?? '').trim());
}
/** Resolve supported client locale IDs; unknown values leave Host fallback in control. */
export function systemLanguageFromLocale(locale) {
    if (typeof locale !== 'string')
        return undefined;
    const value = locale.trim().toLowerCase();
    if (/^zh(?:-|$)/.test(value))
        return '中文';
    if (/^en(?:-|$)/.test(value))
        return 'English';
    return undefined;
}
//# sourceMappingURL=system-language.js.map
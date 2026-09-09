// src/host/system-language.ts
//
// 从 DSH 用户设置读取语言偏好（locale.preference），映射为面向模型的系统语言名。
//
// 需求背景（用户批注）：插件界面与提示词必须跟随官方配置的语言切换。官方在
// dsh-client-locale 中把语言偏好持久化在用户设置 `locale` 命名空间下（字段
// `preference`，取值 BCP 47 风格，如 'zh' / 'en'）；host 侧经 `settings` 服务
// `get('locale')` 读取其解析值 `{ preference?: string }`。
//
// 本模块只做「读设置 → 映射语言名」的纯函数：settings 服务缺失、未注册 locale
// 命名空间或未显式选择语言时回退默认语言（中文，与插件默认中文界面一致）。
// 返回值供提示词构建器注入「所有回复必须使用 <语言>」规则（W-04 提示词正文中文，
// 但语言名本身是面向模型的取值）。
/** 默认语言名（插件默认中文界面；官方未显式选择时按浏览器语言回退，本处保守取中文）。 */
export const DEFAULT_SYSTEM_LANGUAGE = '中文';
/**
 * 从 settings 服务读取系统语言名。
 * 映射：'zh' 前缀 → '中文'；'en' 前缀 → 'English'；其余/缺失 → DEFAULT_SYSTEM_LANGUAGE。
 * 纯函数：输入 settings 对象不变则输出不变；不读时钟/随机源。
 */
export function systemLanguageOf(settings) {
    try {
        const locale = settings?.get?.('locale');
        const preference = String(locale?.preference ?? '').trim().toLowerCase();
        if (preference.startsWith('zh'))
            return '中文';
        if (preference.startsWith('en'))
            return 'English';
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
//# sourceMappingURL=system-language.js.map
/** 扩展名不在白名单时的用户错误文案（纯校验与保存端点的 IO 校验共用同一口径）。 */
export declare const CONDITION_SCRIPT_EXTENSION_MESSAGE = "\u6761\u4EF6\u811A\u672C\u4EC5\u652F\u6301 .mjs/.cjs/.js \u6587\u4EF6";
/** 条件脚本路径是否为当前平台的绝对路径（空串/纯空白按非绝对处理）。 */
export declare function isAbsoluteConditionScriptPath(value: string): boolean;
/** 条件脚本扩展名是否受支持（.mjs/.cjs/.js，大小写不敏感）。 */
export declare function hasSupportedScriptExtension(value: string): boolean;
/**
 * 判定脚本 stdout 最后一行：仅识别 true/false（大小写与首尾空白不敏感）。
 * 只依赖入参文本，不读取退出码/环境/文件；退出码等判定由执行器拼装。
 */
export declare function parseConditionOutput(lastLine: string): {
    pass: boolean;
    detail: string;
};

// src/host/scheduler/condition-config.ts
//
// 第三层条件触发的纯规则：脚本路径是否可用、stdout 最后一行的布尔判定。
// 零 IO、零运行时依赖注入——退出码、超时与 spawn 错误属于执行器（condition-script.ts）
// 的职责，不进入本文件，否则「纯规则」会被子进程概念污染。
// 绝对路径按**运行平台**语义判定（path.isAbsolute）：脚本在本机执行，路径只在本机有意义。
import { extname, isAbsolute } from 'node:path';
/** 支持的脚本扩展名（小写；大小写不敏感匹配）。 */
const SUPPORTED_SCRIPT_EXTENSIONS = new Set(['.mjs', '.cjs', '.js']);
/** 条件脚本路径是否为当前平台的绝对路径（空串/纯空白按非绝对处理）。 */
export function isAbsoluteConditionScriptPath(value) {
    const path = String(value ?? '').trim();
    if (!path)
        return false;
    return isAbsolute(path);
}
/** 条件脚本扩展名是否受支持（.mjs/.cjs/.js，大小写不敏感）。 */
export function hasSupportedScriptExtension(value) {
    return SUPPORTED_SCRIPT_EXTENSIONS.has(extname(String(value ?? '').trim()).toLowerCase());
}
/**
 * 判定脚本 stdout 最后一行：仅识别 true/false（大小写与首尾空白不敏感）。
 * 只依赖入参文本，不读取退出码/环境/文件；退出码等判定由执行器拼装。
 */
export function parseConditionOutput(lastLine) {
    const normalized = String(lastLine ?? '').trim();
    const lowered = normalized.toLowerCase();
    if (lowered === 'true')
        return { pass: true, detail: '' };
    if (lowered === 'false')
        return { pass: false, detail: '条件脚本返回 false' };
    return { pass: false, detail: `条件脚本输出不是 true/false：${normalized}` };
}
//# sourceMappingURL=condition-config.js.map
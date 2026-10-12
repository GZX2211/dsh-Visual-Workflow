// src/host/storage/document-shape.ts
//
// 持久化文档的最小形状守卫（纯函数 + 稳定错误类型：零 IO、无副作用）。
//
// 为什么不把形状判定并进 readJson：readJson 是通用原语，只回答「是不是合法 JSON」；
// 「这是不是一份 workflow / service / run 文档」是各资源自己的判据。缺了这层判据，
// JSON.parse 的结果会被直接 `as T` 当成领域文档使用——一个内容为 `123`、`[]` 或 `{}`
// 的文件会以「不属于该会话」或「字段恰好是 undefined」的假象在很远的地方出问题。
//
// 守卫只做**最小**形状判定：是不是对象 + 有没有身份字段。为什么不再往下校验字段：
// 更严的判据会把「字段缺失但仍可能有用」的旧数据从列表里隐藏掉——那属于数据可读性变更，
// 而句柄字段的语义判定归各资源（它们知道缺字段该怎么降级）。未知字段一律不报错，
// 与「官方形状漂移要收窄并降级，不因未知字段抛错」同口径。
/**
 * 文档形状不合法：文件可解析，但不是该资源的文档。
 *
 * 与 CorruptJsonError（JSON 解析失败）是两类原因，不能互相冒充：这里缺的是「这是谁」的
 * 身份字段。带路径是为了让排障直接定位文件，而不是从「不存在」的空结果反推损坏源。
 */
export class InvalidDocumentError extends Error {
    /** 目标文件路径。 */
    filePath;
    constructor(filePath, reason) {
        super(`文档形状不合法：${filePath}（${reason}）`);
        this.name = 'InvalidDocumentError';
        this.filePath = filePath;
    }
}
/** 对象且非数组：JSON 文档的最小前提（标量与数组都不是「一份文档」）。 */
export function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 非空字符串 id：所有持久化文档共有的身份字段（各资源的文件都以它为名）。 */
function hasIdentity(value) {
    return typeof value.id === 'string' && value.id.trim() !== '';
}
/** 工作流实例文档（workflows/<flowId>.json）。 */
export function isWorkflowDocument(value) {
    return isJsonObject(value) && hasIdentity(value);
}
/** 服务实例文档（services/<serviceId>.json）。 */
export function isServiceState(value) {
    return isJsonObject(value) && hasIdentity(value);
}
/** 模板文档（roles|groups|data 目录；file 与 database 同目录混存，子类判别归调用方）。 */
export function isTemplate(value) {
    return isJsonObject(value) && hasIdentity(value);
}
/** 工作流模板文档（flow-templates/<templateId>.json）。 */
export function isWorkflowTemplate(value) {
    return isJsonObject(value) && hasIdentity(value);
}
/** run 快照文档（runs/<runId>.json）。 */
export function isRunSnapshot(value) {
    return isJsonObject(value) && hasIdentity(value);
}
/**
 * 工具组合文档（combos.json 单文件）。
 * 为什么这里必须校验容器字段：读取方会直接 spread 这个字段，非数组会被展开成
 * 下标/字符项的垃圾数据（形状漂移在此不是「降级可用」而是「写出错误结果」）。
 */
export function isToolComboDocument(value) {
    return isJsonObject(value) && Array.isArray(value.combos);
}
/**
 * userId → sessionId 映射文档（services/<serviceId>.sessions.json）。
 * 逐值校验字符串：读取方会把整表 spread 成返回值，非字符串值会以「看起来像真映射」的
 * 形态流进会话解析并静默走错会话。
 */
export function isSessionIdMap(value) {
    if (!isJsonObject(value))
        return false;
    return Object.values(value).every((entry) => typeof entry === 'string');
}
//# sourceMappingURL=document-shape.js.map
// src/host/storage/storage-paths.ts
//
// 数据目录布局与资源路径计算（纯函数：零 IO、无时钟、无随机源、不改写入参）。
//
// 为什么独立成文件：目录布局是持久化层的稳定契约（外部备份、排障、迁移都依赖它），
// 其变化原因（数据目录规划调整）与资源 CRUD 的变化原因（业务字段、锁与并发语义）
// 完全不同，属于两个独立的变化原因。
//
// 目录规划（需求文档 §6，root = <dataDir>）：
//   workflows/<flowId>.json              模式一工作流实例（文件内 sessionId 字段标记归属）
//   services/<serviceId>.json            模式二服务实例（工作流定义 + 端口/鉴权/状态）
//   services/<serviceId>.sessions.json   userId → sessionId 映射（§4.7 sessions-map）
//   roles/<roleId>.json                  角色模板（全局共享）
//   data/<dataId>.json                   数据模板（文件/数据库，全局共享，按字段判别）
//   data/files/                          受管文件副本（非文本文件受管拷贝）
//   groups/<groupId>.json                协作组模板（全局共享）
//   flow-templates/<templateId>.json     工作流模板（全局共享；图2 交互改造新增）
//   combos.json                          工具组合列表（全局共享）
//   runs/<runId>.json                    运行历史（RunSnapshot，含 flowId/断点/节点产出）
//   orchestrations/<runId>.json          运行时流程定义（父代理只读的事实源）
//
// 为什么每个实例单独成文件（架构文档 §4.1 / 需求 §6）：单文件即单资源，
// 原子写粒度=资源粒度——并发编辑同一资源经锁串行化，不同资源互不阻塞；
// 删除即删文件，无「数组中残留空洞」。
//
// 安全约束：任何来自外部的 id 都必须经 safeFilePart 消毒后才能拼进文件名
// （防路径穿越与非法文件名字符）。
import { join } from 'node:path';
/** 顶层数据目录（init 时创建；外部工具与测试以此为布局契约）。 */
export const DIRS = [
    'workflows',
    'services',
    'roles',
    'data',
    'groups',
    'runs',
    'orchestrations',
    'flow-templates',
];
/** 嵌套子目录（相对 root 的路径；随顶层目录一并幂等创建）。 */
export const NESTED_DIRS = ['data/files'];
/**
 * 文件名消毒：id 中非法字符替换为下划线（防路径穿越/坏文件名）。
 * `.` 与 `..` 单独出现时同样替换，避免生成指向目录自身的路径。
 */
export function safeFilePart(value) {
    const sanitized = String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!sanitized || sanitized === '.' || sanitized === '..')
        return '_';
    return sanitized;
}
/** 工作流实例文件路径。 */
export function workflowPath(root, flowId) {
    return join(root, 'workflows', `${safeFilePart(flowId)}.json`);
}
/** 服务实例文件路径。 */
export function servicePath(root, serviceId) {
    return join(root, 'services', `${safeFilePart(serviceId)}.json`);
}
/** 服务会话映射文件路径（services/<id>.sessions.json）。 */
export function sessionsPath(root, serviceId) {
    return join(root, 'services', `${safeFilePart(serviceId)}.sessions.json`);
}
/** 模板种类 → 目录（data/ 内 file 与 database 同目录，以字段判别）。 */
export function templateDir(kind) {
    return kind === 'role' ? 'roles' : kind === 'group' ? 'groups' : 'data';
}
/** 模板文件路径。 */
export function templatePath(root, kind, id) {
    return join(root, templateDir(kind), `${safeFilePart(id)}.json`);
}
/** 工作流模板文件路径（flow-templates/，全局共享）。 */
export function flowTemplatePath(root, templateId) {
    return join(root, 'flow-templates', `${safeFilePart(templateId)}.json`);
}
/** run 快照文件路径。 */
export function runsPath(root, runId) {
    return join(root, 'runs', `${safeFilePart(runId)}.json`);
}
/** 运行时流程定义文件路径（orchestrations/）。 */
export function orchestrationPath(root, runId) {
    return join(root, 'orchestrations', `${safeFilePart(runId)}.json`);
}
/** 工具组合文件路径（combos.json 单文件）。 */
export function combosPath(root) {
    return join(root, 'combos.json');
}
//# sourceMappingURL=storage-paths.js.map
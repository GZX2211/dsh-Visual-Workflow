// src/host/orchestrator/flow-diff.ts
//
// 流程「编排语义」差异判定（纯函数）：
//   运行中画布保存时，比较「上一次同步进运行事实源（orchestrations/<runId>.json）
//   的画布」与「本次保存的画布」，判断是否发生了编排语义变更。只有语义变更才向
//   父代理注入【编排变更】通知；纯几何改动（节点坐标、协作组卡片尺寸、左右连接点
//   交换）不改变节点与连线语义，一律视为「未变更」，避免拖动即注入打扰父代理。
//
// 纯函数约束（架构文档 §13）：不读时钟/随机源、无全局状态、同一入参输出恒定。
/**
 * 节点 data 内的纯几何字段（比较时剔除）：
 *   - size：协作组卡片尺寸（拉伸布局）；
 *   - swapPorts：左右连接点交换（仅影响布线视觉，不影响节点/连线语义）。
 */
const GEOMETRY_DATA_KEYS = ['size', 'swapPorts'];
/**
 * 稳定序列化（对象键排序）：磁盘 JSON 解析出的键序可能与内存对象不同，
 * 直接 JSON.stringify 会产生假差异，故统一按键名排序后再拼接。
 */
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
/** 节点非几何配置指纹（忽略顶层 position 与 data 内几何字段；含 id 以区分节点身份）。 */
export function nodeConfigKeyOf(node) {
    const { position: _position, ...rest } = node;
    const data = rest.data;
    if (!data || typeof data !== 'object')
        return stableStringify(rest);
    const trimmed = {};
    for (const [key, value] of Object.entries(data)) {
        if (GEOMETRY_DATA_KEYS.includes(key))
            continue;
        trimmed[key] = value;
    }
    return stableStringify({ ...rest, data: trimmed });
}
/**
 * 连线语义键（不含连线 id）：两端节点 + 连接点 + 条件。
 * 删除后重连同一条线（id 变化但语义相同）不应算作编排变更。
 */
export function lineKeyOf(line) {
    const condition = line.condition ? `${line.condition.type}:${line.condition.label ?? ''}` : '';
    return `${line.source}|${line.sourceHandle}|${line.target}|${line.targetHandle}|${condition}`;
}
/** 语义键计数表（同键多连线时按计数比较，避免漏判重复连线增减）。 */
function countKeys(keys) {
    const map = new Map();
    for (const key of keys)
        map.set(key, (map.get(key) ?? 0) + 1);
    return map;
}
/** 计数表差异（next 比 prev 多出的键，按出现次数展开）。 */
function extraKeys(prev, next) {
    const out = [];
    for (const [key, count] of next) {
        const before = prev.get(key) ?? 0;
        for (let index = before; index < count; index += 1)
            out.push(key);
    }
    return out;
}
/**
 * 比较前后两份画布，输出编排语义变更摘要。
 * 比较维度：节点增删 + 节点非几何配置变化 + 连线增删（按语义键）。
 * 不比较：节点坐标、组卡片尺寸、连接点交换、连线 id、文档名称/描述等元信息。
 */
export function summarizeFlowChange(prev, next) {
    const prevNodes = new Map((prev.nodes ?? []).map((node) => [node.id, node]));
    const nextNodes = new Map((next.nodes ?? []).map((node) => [node.id, node]));
    const addedNodeIds = [];
    const changedNodeIds = [];
    for (const [id, node] of nextNodes) {
        const before = prevNodes.get(id);
        if (!before)
            addedNodeIds.push(id);
        else if (nodeConfigKeyOf(before) !== nodeConfigKeyOf(node))
            changedNodeIds.push(id);
    }
    const removedNodeIds = [...prevNodes.keys()].filter((id) => !nextNodes.has(id));
    const prevLines = countKeys((prev.lines ?? []).map(lineKeyOf));
    const nextLines = countKeys((next.lines ?? []).map(lineKeyOf));
    const addedLineKeys = extraKeys(prevLines, nextLines);
    const removedLineKeys = extraKeys(nextLines, prevLines);
    return {
        changed: addedNodeIds.length > 0 || removedNodeIds.length > 0 || changedNodeIds.length > 0
            || addedLineKeys.length > 0 || removedLineKeys.length > 0,
        addedNodeIds,
        removedNodeIds,
        changedNodeIds,
        addedLineKeys,
        removedLineKeys,
    };
}
//# sourceMappingURL=flow-diff.js.map
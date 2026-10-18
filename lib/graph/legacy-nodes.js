// src/host/graph/legacy-nodes.ts
//
// 旧图读取兼容：历史数据中的 kind='file' 文件节点在读取时归一化为任务节点。
//
// 为什么放在 graph：节点形状迁移属于图契约的兼容语义，而不是某个调用方的展示细节。
// 纯函数、不改写入参；受管文件字段随旧形态退役，只保留 label / content。
/** 单个旧文件节点 → 任务节点（content 保留；受管文件字段丢弃）。 */
function legacyFileToTask(node) {
    const raw = node;
    const data = raw.data !== null && typeof raw.data === 'object' && !Array.isArray(raw.data)
        ? raw.data
        : {};
    const position = raw.position !== null && typeof raw.position === 'object'
        ? raw.position
        : { x: 0, y: 0 };
    return {
        id: String(raw.id ?? ''),
        kind: 'task',
        position,
        data: {
            label: String(data.label ?? ''),
            content: String(data.content ?? ''),
        },
    };
}
/**
 * 归一化旧图节点（只读兼容）：kind='file' → task，其余节点原样返回。
 * 非对象项跳过——损坏项不得伪装成节点；不修改入参。
 */
export function normalizeLegacyNodes(nodes) {
    if (!Array.isArray(nodes))
        return [];
    const out = [];
    for (const item of nodes) {
        if (item === null || typeof item !== 'object' || Array.isArray(item))
            continue;
        const node = item;
        out.push(String(node.kind ?? '') === 'file' ? legacyFileToTask(node) : node);
    }
    return out;
}
//# sourceMappingURL=legacy-nodes.js.map
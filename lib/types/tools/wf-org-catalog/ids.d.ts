/** 解析结果：可召回引用，或形状非法（附可行动原因）。 */
export type AssetRef = {
    ok: true;
    kind: 'workflow';
    id: string;
} | {
    ok: true;
    kind: 'role';
    id: string;
} | {
    ok: true;
    kind: 'inlineRole';
    id: string;
    containerId: string;
    nodeId: string;
} | {
    ok: false;
    reason: string;
};
/** 支持的 id 形状说明（错误提示复用，避免措辞漂移）。 */
export declare function idShapesHint(): string;
/**
 * 解析单个 id（纯函数）。
 * 内联角色只从**工作流资产**召回：复合键左侧必须是 `flow-*`——运行期实例的骨架与
 * 内联角色不由本工具暴露（父代理只允许改当前正在运行的实例，其编排事实由运行期
 * 编排指令提供）。
 */
export declare function parseAssetId(raw: unknown): AssetRef;
/**
 * 归一化 ids 参数（纯函数）。
 * 语义（用户裁决）：缺省 / 空数组 / 空白字符串 = 只看索引；数组内空白项跳过并按首次
 * 出现去重（保持模型给出的顺序）。
 * @returns 归一化后的 id 列表；`null` 表示参数形状非法（调用方抛 WF_BAD_ARGS）。
 */
export declare function normalizeAssetIds(raw: unknown): string[] | null;
/** ids 数量校验：超限返回错误文案（调用方据此抛 WF_BAD_ARGS），未超限返回 null。 */
export declare function detailIdsLimitProblem(count: number): string | null;

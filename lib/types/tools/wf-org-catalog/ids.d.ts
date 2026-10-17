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
    ok: true;
    kind: 'instance';
    id: string;
} | {
    ok: true;
    kind: 'instanceRole';
    id: string;
    nodeId: string;
} | {
    ok: false;
    reason: string;
};
/**
 * 支持的 id 形状说明（错误提示复用，避免措辞漂移）。
 * 实例两项只在此处与工具描述出现，不进资产索引：索引是规划期入口，
 * 而实例入口只在运行期有意义（由运行期指令告知父代理）。
 */
export declare function idShapesHint(): string;
/**
 * 解析单个 id（纯函数）。
 * 内联角色有两个来源：**工作流资产**（复合键左侧 `flow-*`）与**当前运行实例**
 * （左侧保留字 `instance`）。运行实例只有这一个入口——本工具不提供按 id 枚举任意实例的
 * 形状，历史 run、其他会话的实例在判据层就不存在，故规划期无法借本工具参考不稳定实例。
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

import type { GraphNode } from '../../shared/graph-model.js';
import type { PatchOp, PatchOpFailure } from './types.js';
/**
 * 模型清单条目（provider/model 配对 + 该模型公布的思考强度档位）。
 * efforts 缺省 = 适配器未公布档位（此时档位判定放弃，见下方 reasoning 规则）。
 */
export interface ModelCatalogEntry {
    provider: string;
    model: string;
    efforts?: string[];
}
/**
 * 本批 ops 显式写入的模型选择字段。
 * 同时携带**应用后的有效 provider/model**：reasoning 要按它定档位，配对一致性也要按它判。
 */
export interface WrittenModelSelection {
    /** 该 op 在本批 ops 中的下标（0 起）。 */
    index: number;
    /** op 名（错误文本按调用方口径展示）。 */
    op: string;
    /** 目标节点 id（create_node 未显式给 id 时写占位文案）。 */
    nodeId: string;
    /** 本批显式写入的 provider（未写入或空值 = undefined，不参与判定）。 */
    provider?: string;
    /** 本批显式写入的 model（同上）。 */
    model?: string;
    /** 本批显式写入的 reasoning（同上）。 */
    reasoning?: string;
    /** 应用后的有效 provider（未写入时继承节点现值）。 */
    effectiveProvider: string;
    /** 应用后的有效 model（未写入时继承节点现值）。 */
    effectiveModel: string;
}
/**
 * 模型清单行 → 稳定条目（结构守卫：非法行跳过）。
 * 返回 null = 清单不可用（缝缺失 / 枚举失败 / 全空），调用方据此放弃判定。
 */
export declare function knownModelsOf(rows: unknown[]): ModelCatalogEntry[] | null;
/**
 * 读取本批 ops 显式写入的角色节点模型选择字段。
 *
 * 只收集**至少写入一项**的 op：节点上的历史值不进入判定，否则一次只改标签的补丁
 * 也会被历史脏配对拦住。
 * update_node_data 的有效值取应用后的文档（同一批里先建后改也能解析到）。
 */
export declare function writtenModelSelectionsOf(ops: PatchOp[], applied: {
    nodes: GraphNode[];
}): WrittenModelSelection[];
/**
 * 纯匹配：本批写入的 provider/model/reasoning 是否都能在模型清单中定位。
 *
 * 判定规则（每条失败都写明「哪个节点、哪个字段、收到的值、正确取值去哪拿」）：
 *   ① 写入的 provider 非空 → 必须是清单里的 provider（未知即拒绝，并附「写反了」修复建议）；
 *   ② 写入的 model 非空 → 必须落在**本批写入后的有效 provider** 之下；有效 provider 为空或
 *      未知时按全清单判定（配对的另一半缺失时不能凭空判死）；
 *   ③ 写入的 reasoning 非空 → 仅当有效配对命中清单且该模型公布了档位时，必须是其中之一
 *      （未公布档位 / 留空 = 模型默认，保持兼容，不判定）。
 * 只写 provider 而节点现值 model 与之不匹配的情况一并拒绝：补丁后的配对必须可用，
 * 否则节点会在运行期 LLM 调用处才失败。
 */
export declare function modelSelectionFailures(known: ModelCatalogEntry[], written: WrittenModelSelection[]): PatchOpFailure[];

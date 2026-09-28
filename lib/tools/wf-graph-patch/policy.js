// src/host/tools/wf-graph-patch/policy.ts
//
// 角色节点模型选择（provider / model / reasoning）取值的**存在性策略**（纯函数）。
//
// 为什么必须有（2026.09 实机取证）：ops 是自由对象，取值写错不会被任何一层拦住——
// 图检查器只看结构与编排质量，写错的配对一路落盘，直到运行期 LLM 调用处才失败；
// 而画布的下拉只列出模型清单里的值，清单外的值在面板上退化成显示 (default)，用户看到的是
// 「工具明明传了、界面却不回显」。实机案例：清单里是 provider=commandcode /
// model=inclusionai/ling-3.0-flash-sante:free，父代理把 model 的「组织/」前缀当成 provider，
// 写成 provider=inclusionai / model=ling-3.0-flash-sante:free，静默落盘并被画布显示成 (default)。
//
// 判定口径与 presetId 存在性校验完全一致：
//   - 只判定**本批 ops 显式写入**的非空值（节点上的历史脏值不阻断只改标签的补丁）；
//   - 模型清单是 best-effort 生态缝：枚举不到即放弃判定，不误杀合法引用；
//   - 思考强度只在所选模型**公布了档位**时判定（未公布/留空 = 默认，保持兼容）。
// 与 tool.ts 的分工：本文件只做纯匹配（不触盘、不读时钟/随机源），清单枚举与错误聚合在 tool.ts。
/** 角色节点种类（只有角色节点有 provider/model/reasoning）。 */
const ROLE_KINDS = new Set(['agent', 'parent']);
/** 非空文本（null/undefined/空白 = 未提供，不参与存在性判定）。 */
function nonEmptyText(raw) {
    if (raw === undefined || raw === null)
        return undefined;
    const text = String(raw).trim();
    return text === '' ? undefined : text;
}
/**
 * 模型清单行 → 稳定条目（结构守卫：非法行跳过）。
 * 返回 null = 清单不可用（缝缺失 / 枚举失败 / 全空），调用方据此放弃判定。
 */
export function knownModelsOf(rows) {
    const out = [];
    for (const row of rows ?? []) {
        if (row === null || typeof row !== 'object' || Array.isArray(row))
            continue;
        const entry = row;
        const provider = String(entry.provider ?? '').trim();
        const model = String(entry.model ?? '').trim();
        if (!provider || !model)
            continue;
        // 档位两种来源都收：宿主投影后的 { id } 对象与适配器原样给出的字符串
        const efforts = Array.isArray(entry.efforts)
            ? entry.efforts
                .map((item) => (typeof item === 'string' ? item : String(item?.id ?? '')))
                .map((id) => id.trim())
                .filter(Boolean)
            : [];
        // 空档位数组与未公布同义：模型确实没有可选项时不得据此拒绝任何写入值
        out.push({ provider, model, ...(efforts.length > 0 ? { efforts } : {}) });
    }
    return out.length > 0 ? out : null;
}
/**
 * 读取本批 ops 显式写入的角色节点模型选择字段。
 *
 * 只收集**至少写入一项**的 op：节点上的历史值不进入判定，否则一次只改标签的补丁
 * 也会被历史脏配对拦住。
 * update_node_data 的有效值取应用后的文档（同一批里先建后改也能解析到）。
 */
export function writtenModelSelectionsOf(ops, applied) {
    const out = [];
    ops.forEach((op, index) => {
        if (op.op === 'create_node') {
            const node = op.node;
            if (!ROLE_KINDS.has(String(node?.kind ?? '')))
                return;
            const data = (node.data && typeof node.data === 'object' ? node.data : {});
            const provider = nonEmptyText(data.provider);
            const model = nonEmptyText(data.model);
            const reasoning = nonEmptyText(data.reasoning);
            if (provider === undefined && model === undefined && reasoning === undefined)
                return;
            out.push({
                index,
                op: 'create_node',
                nodeId: String(node.id ?? '').trim() || '(待生成 id)',
                ...(provider === undefined ? {} : { provider }),
                ...(model === undefined ? {} : { model }),
                ...(reasoning === undefined ? {} : { reasoning }),
                // create 通路没有历史值：补全后落盘的就是本批写入值（缺省即空 = 宿主默认）
                effectiveProvider: provider ?? '',
                effectiveModel: model ?? '',
            });
            return;
        }
        if (op.op === 'update_node_data') {
            const nodeId = String(op.nodeId ?? '').trim();
            const target = applied.nodes.find((node) => node.id === nodeId);
            if (!target || !ROLE_KINDS.has(target.kind))
                return;
            const patch = (op.data && typeof op.data === 'object' ? op.data : {});
            const effective = (target.data ?? {});
            const provider = nonEmptyText(patch.provider);
            const model = nonEmptyText(patch.model);
            const reasoning = nonEmptyText(patch.reasoning);
            if (provider === undefined && model === undefined && reasoning === undefined)
                return;
            out.push({
                index,
                op: 'update_node_data',
                nodeId,
                ...(provider === undefined ? {} : { provider }),
                ...(model === undefined ? {} : { model }),
                ...(reasoning === undefined ? {} : { reasoning }),
                effectiveProvider: nonEmptyText(effective.provider) ?? '',
                effectiveModel: nonEmptyText(effective.model) ?? '',
            });
        }
    });
    return out;
}
/** 清单摘要（截断；避免错误文本被清单撑爆）。 */
function sampleOf(values) {
    const head = values.slice(0, 10).join('、');
    return values.length > 10 ? `${head}…（共 ${values.length} 项）` : head;
}
/** provider/model 配对的可读摘要。 */
function pairSampleOf(entries) {
    return sampleOf(entries.map((entry) => `${entry.provider}/${entry.model}`));
}
/** 「provider 与 model 写反了」的修复建议（本批两个值拼起来正好是某个合法 model 时给出）。 */
function reversedPairHintOf(known, provider, model) {
    if (!model)
        return '';
    const hit = known.find((entry) => entry.model === `${provider}/${model}`);
    return hit
        ? `（provider 与 model 可能写反了：model 里的「组织/」前缀属于 model 本身，应写 provider="${hit.provider}"、model="${hit.model}"）`
        : '';
}
/** 该 model 实际所属的 provider（跨 provider 唯一命中时用于给出切换提示）。 */
function ownerProviderOf(known, model) {
    const owners = [...new Set(known.filter((entry) => entry.model === model).map((entry) => entry.provider))];
    return owners.length === 1 ? owners[0] : '';
}
/** 组装一条参数层失败项（取值错误归 WF_BAD_ARGS：要改的是入参，不是图）。 */
function failureOf(item, message) {
    return { index: item.index, op: item.op, code: 'WF_BAD_ARGS', message };
}
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
export function modelSelectionFailures(known, written) {
    const providers = new Set(known.map((entry) => entry.provider));
    const allModels = new Set(known.map((entry) => entry.model));
    const out = [];
    for (const item of written) {
        const provider = item.provider ?? item.effectiveProvider;
        const model = item.model ?? item.effectiveModel;
        const providerKnown = provider !== '' && providers.has(provider);
        if (item.provider !== undefined && !providers.has(item.provider)) {
            out.push(failureOf(item, `节点「${item.nodeId}」的 provider「${item.provider}」不在模型清单中`
                + reversedPairHintOf(known, item.provider, item.model ?? item.effectiveModel)
                + `。provider 与 model 必须成对取自模型清单的两列，可用配对：${pairSampleOf(known)}`));
        }
        if (model !== '' && (item.model !== undefined || item.provider !== undefined)) {
            if (providerKnown) {
                if (!known.some((entry) => entry.provider === provider && entry.model === model)) {
                    const owner = ownerProviderOf(known, model);
                    out.push(failureOf(item, `节点「${item.nodeId}」的 model「${model}」不在 provider「${provider}」的模型清单中`
                        + (owner ? `（该 model 属于 provider「${owner}」，切换时请连 provider 一起写）` : '')
                        + `。provider「${provider}」可用模型：${sampleOf(known.filter((entry) => entry.provider === provider).map((entry) => entry.model))}`));
                }
            }
            else if (!allModels.has(model)) {
                out.push(failureOf(item, `节点「${item.nodeId}」的 model「${model}」不在模型清单中`
                    + (item.provider === undefined ? '（未写入 provider，按节点现值与全清单判定）' : '（provider 未知时 model 按全清单判定）')
                    + `。可用配对：${pairSampleOf(known)}`));
            }
        }
        if (item.reasoning !== undefined) {
            const hit = known.find((entry) => entry.provider === provider && entry.model === model);
            const efforts = hit?.efforts ?? [];
            if (efforts.length > 0 && !efforts.includes(item.reasoning)) {
                out.push(failureOf(item, `节点「${item.nodeId}」的 reasoning「${item.reasoning}」不在模型「${model}」公布的思考强度档位中（可用：${efforts.join('/')}；留空 = 模型默认行为）`));
            }
        }
    }
    return out;
}
//# sourceMappingURL=policy.js.map
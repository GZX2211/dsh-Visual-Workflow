// src/host/assets/role-assets.ts
//
// 角色资产的写读端口：版本登记、内容去重（B）、类型晋升（standalone/inline/shared）、
// 引用统计（含解除引用）、回滚与归档。
//
// 本文件的所有函数都必须在调用方开启的事务内执行（ctx 由 withTx 提供）：
// 「查重 → 决定新增版本 / 复用版本 / 新建资产」是一次读改写，跨事务即丢更新。
//
// 状态所有权：role_asset_history 的**内容列**一经写入不可变；role_asset_type 与
// reference_* 是可变统计缓存，只由本文件的刷新函数（appendRoleReference /
// releaseRoleReference / markRoleVersionShared / demoteRoleAssetType）改写。
//
// 归档语义：删除 role_asset_active 行即归档（历史与引用统计全部保留，供审计与重新启用）；
// 归档资产的详情/版本列表以**最新版本行**为准，回滚任一版本即重建 Active 行（重新启用）。
import { assetNotFound, assetVersionNotFound, AssetError } from './errors.js';
import { ERR_ASSET_DUPLICATE } from '../shared/protocol.js';
import { versionRowId } from './ids.js';
import { requireAssetId, requireText, requireVersionId, toInteger } from './role-check.js';
import { parseReferenceIds, roleActiveRow, roleFieldsFromTemplate, roleRetrievalContext, roleRowToAssetRow, roleRowValues, sameRoleFields, toRoleAssetType, } from './row-codec.js';
/** 历史行全部列（显式列出：行形状是对外契约的一部分，禁止用 SELECT * 漂移）。 */
const ROLE_HISTORY_COLUMNS = [
    'id',
    'version_id',
    'asset_id',
    'kind',
    'name',
    'system_prompt',
    'provider',
    'model',
    'reasoning',
    'preset_id',
    'retry_limit',
    'react_limit',
    'input_schema',
    'output_schema',
    'system_prompt_source',
    'inject_system_prompt',
    'inject_tool_sections',
    'prompt_file_path',
    'retrieval_context',
    'role_asset_type',
    'reference_status',
    'reference_workflow_ids',
    'source',
    'source_template_id',
    'source_fingerprint',
    'created_at',
    'updated_at',
].join(', ');
/** 角色版本行读取（无匹配返回 null）。 */
export function readRoleVersionRow(ctx, assetId, versionId) {
    const row = ctx.get(`SELECT ${ROLE_HISTORY_COLUMNS} FROM role_asset_history WHERE asset_id = ? AND version_id = ?`, [
        assetId,
        versionId,
    ]);
    return row ? roleRowToAssetRow(row) : null;
}
/** 是否处于未退役状态（Active 行存在）。 */
export function isRoleAssetLive(ctx, assetId) {
    const row = ctx.get('SELECT 1 AS present FROM role_asset_active WHERE asset_id = ?', [assetId]);
    return row !== null;
}
/** 角色资产 Active 行（未归档资产必有；归档后为 null）。 */
export function readRoleActive(ctx, assetId) {
    const row = ctx.get('SELECT * FROM role_asset_active WHERE asset_id = ?', [assetId]);
    return row ? roleActiveRow(row) : null;
}
/**
 * 最新版本行（max version_id）。
 *
 * 归档资产没有 Active 指针，详情投影、保存在此基础上续版、版本列表都以它为准；
 * 行不存在即资产完全不存在（既未活跃也无历史）。
 */
export function latestRoleVersionRow(ctx, assetId) {
    const row = ctx.get(`SELECT ${ROLE_HISTORY_COLUMNS} FROM role_asset_history
      WHERE asset_id = ? ORDER BY version_id DESC LIMIT 1`, [assetId]);
    return row ? roleRowToAssetRow(row) : null;
}
/** 该角色资产当前类型（Active 版本行的类型）；归档或行缺失返回 null。 */
export function roleAssetCurrentType(ctx, assetId) {
    const active = readRoleActive(ctx, assetId);
    if (!active)
        return null;
    const row = readRoleVersionRow(ctx, assetId, active.versionId);
    return row ? row.roleAssetType : null;
}
/** 下一个版本号 = 该资产下 max(version_id) + 1。 */
export function nextRoleVersionId(ctx, assetId) {
    const row = ctx.get('SELECT MAX(version_id) AS max_version FROM role_asset_history WHERE asset_id = ?', [assetId]);
    return toInteger(row?.max_version, 0) + 1;
}
/**
 * 内容去重（算法 B）：`kind + system_prompt` 全等，匹配范围为**未退役资产的全部版本行**，
 * 命中时取版本号最大的那一行（用户看到的是该资产的最新内容）。
 * 已退役资产不参与匹配：用户已明确将其移出复用面，再次晋升应产出新资产。
 */
export function findRoleVersionByContent(ctx, fields) {
    const row = ctx.get(`SELECT ${ROLE_HISTORY_COLUMNS} FROM role_asset_history
       WHERE kind = ? AND system_prompt = ?
         AND asset_id IN (SELECT asset_id FROM role_asset_active)
       ORDER BY version_id DESC LIMIT 1`, [fields.kind, fields.systemPrompt]);
    if (!row)
        return null;
    const parsed = roleRowToAssetRow(row);
    return { assetId: parsed.assetId, versionId: parsed.versionId, row: parsed };
}
/** 新建角色资产（版本 1）：写入历史行与 Active 行。 */
export function createRoleAsset(ctx, input) {
    const now = ctx.now();
    const versionId = input.versionId ?? 1;
    const sourceTemplateId = input.sourceTemplateId ?? null;
    const sourceFingerprint = input.sourceFingerprint ?? null;
    const rowId = versionRowId(input.assetId, versionId);
    insertRoleVersionRow(ctx.tx, roleRowValues(input.assetId, versionId, input.fields, {
        rowId,
        roleAssetType: input.roleAssetType,
        source: input.source,
        sourceTemplateId,
        sourceFingerprint,
        createdAt: now,
        updatedAt: now,
    }));
    writeRoleActiveRow(ctx.tx, {
        assetId: input.assetId,
        versionId,
        name: input.fields.name,
        retrievalContext: roleRetrievalContext(input.assetId, input.fields),
        sourceTemplateId,
        sourceFingerprint,
        updatedAt: now,
    });
    return { assetId: input.assetId, versionId, rowId, unchanged: false, roleAssetType: input.roleAssetType };
}
/**
 * 在既有资产下登记新版本并移动 Active 指针。
 * `inheritSource`: 来源绑定与指纹的继承值（晋升路径取来源模版，保存路径取被保存的 Active 行）。
 * `previousRow`: 被保存的 Active 版本行（调用方已读取时传入，避免重复回表；
 * 缺省时自行读取，语义相同）。
 * `activate`: 是否同步把 Active 指针移向新版本。归档资产的保存为 false——历史资产的
 * 「保存」只做版本迭代，不改变归档状态（重新启用只能经显式回滚）。
 */
export function addRoleVersion(ctx, input) {
    const now = ctx.now();
    const versionId = input.versionId ?? nextRoleVersionId(ctx.tx, input.assetId);
    // created_at 沿用被保存版本的创建时间：版本行的创建时间是「资产何时诞生」，不是「本版本何时登记」
    const previous = resolvePreviousVersion(ctx.tx, input);
    const rowId = versionRowId(input.assetId, versionId);
    insertRoleVersionRow(ctx.tx, roleRowValues(input.assetId, versionId, input.fields, {
        rowId,
        roleAssetType: input.roleAssetType,
        source: input.source,
        sourceTemplateId: input.inheritSource.sourceTemplateId,
        sourceFingerprint: input.inheritSource.sourceFingerprint,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
    }));
    if (input.activate !== false) {
        writeRoleActiveRow(ctx.tx, {
            assetId: input.assetId,
            versionId,
            name: input.fields.name,
            retrievalContext: roleRetrievalContext(input.assetId, input.fields),
            sourceTemplateId: input.inheritSource.sourceTemplateId,
            sourceFingerprint: input.inheritSource.sourceFingerprint,
            updatedAt: now,
        });
    }
    return { assetId: input.assetId, versionId, rowId, unchanged: false, roleAssetType: input.roleAssetType };
}
/** 追加引用（引用统计专用）：把工作流版本行 id 去重追加，并同步 reference_status。 */
export function appendRoleReference(ctx, rowId, workflowRowId) {
    const row = ctx.tx.get('SELECT reference_workflow_ids FROM role_asset_history WHERE id = ?', [rowId]);
    if (!row)
        return;
    const ids = parseReferenceIds(row.reference_workflow_ids);
    if (ids.includes(workflowRowId))
        return;
    ids.push(workflowRowId);
    ctx.tx.run('UPDATE role_asset_history SET reference_workflow_ids = ?, reference_status = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(ids),
        'used',
        ctx.now(),
        rowId,
    ]);
}
/** 引用列表长度（用于「被两个以上工作流版本引用即升 shared」判定）。 */
export function referenceCount(ctx, rowId) {
    const row = ctx.get('SELECT reference_workflow_ids FROM role_asset_history WHERE id = ?', [rowId]);
    return row ? parseReferenceIds(row.reference_workflow_ids).length : 0;
}
/**
 * 解除引用（引用统计的唯一删减点）：把 `workflowAssetId` 挂在本版本行上的引用全部移除。
 *
 * 为什么整段移除而不是按版本行精确匹配：一次工作流保存会把该资产的旧版本行引用一并作废
 * （新版本已不再引用该角色版本），逐行匹配没有额外信息量。`<assetId>@<versionId>` 的
 * 分隔符保证前缀匹配不会误伤同前缀的其它资产 id。
 *
 * @returns 发生变更时返回该行所属角色资产 id，未变更返回 null。
 */
export function releaseRoleReference(ctx, rowId, workflowAssetId) {
    const row = ctx.tx.get('SELECT asset_id, reference_workflow_ids FROM role_asset_history WHERE id = ?', [rowId]);
    if (!row)
        return null;
    const ids = parseReferenceIds(row.reference_workflow_ids);
    const prefix = `${workflowAssetId}@`;
    const kept = ids.filter((id) => !id.startsWith(prefix));
    if (kept.length === ids.length)
        return null;
    ctx.tx.run('UPDATE role_asset_history SET reference_workflow_ids = ?, reference_status = ?, updated_at = ? WHERE id = ?', [JSON.stringify(kept), kept.length > 0 ? 'used' : 'unused', ctx.now(), rowId]);
    const assetId = String(row.asset_id ?? '');
    return assetId === '' ? null : assetId;
}
/** 该角色资产是否仍被任何工作流资产版本引用（归档判定的唯一依据）。 */
export function roleAssetReferencedByAnyWorkflow(ctx, assetId) {
    const rows = ctx.all('SELECT reference_workflow_ids FROM role_asset_history WHERE asset_id = ?', [assetId]);
    return rows.some((row) => parseReferenceIds(row.reference_workflow_ids).length > 0);
}
/**
 * 角色资产类型降级为 standalone（归档的伴随动作）。
 *
 * 为什么可以整表改写类型：role_asset_type 被 DDL 与模块规则同时声明为**可变统计缓存**
 * （内容列才不可变）。资产离开活跃复用面后，「是否内联 / 是否被多工作流共享」这两个事实
 * 都已不成立，保留旧类型只会让左侧「历史资产」显示错误标签。
 */
export function demoteRoleAssetType(ctx, assetId) {
    ctx.tx.run("UPDATE role_asset_history SET role_asset_type = 'standalone', updated_at = ? WHERE asset_id = ? AND role_asset_type <> 'standalone'", [ctx.now(), assetId]);
}
/** 版本行的当前类型（可能与该资产 Active 版本不同：类型只随被引用/被合并的那一行变化）。 */
export function roleVersionType(ctx, rowId) {
    const row = ctx.get('SELECT role_asset_type FROM role_asset_history WHERE id = ?', [rowId]);
    return row ? toRoleAssetType(row.role_asset_type) : null;
}
/**
 * 把版本行升为 shared，并刷新其 updated_at。
 * 为什么只改这一行：其他历史版本的类型描述「它当时是否共享」，回滚到旧版本不应携带
 * 新版本的共享事实；而 Active 行若正指向该行，则随之一致（同一行）。
 */
export function markRoleVersionShared(ctx, rowId) {
    ctx.tx.run("UPDATE role_asset_history SET role_asset_type = 'shared', updated_at = ? WHERE id = ?", [
        ctx.now(),
        rowId,
    ]);
}
// ---------------------------------------------------------------------------
// 公共读接口
// ---------------------------------------------------------------------------
/**
 * 角色资产列表（活跃资产 = 有 Active 行的资产；Active 版本投影）。
 * 列表读语义：单行损坏（JSON 非法/缺列）跳过该条并 warn，保证列表仍可用。
 */
export function listRoleAssets(ctx) {
    const rows = ctx.all(`SELECT a.asset_id AS asset_id, a.version_id AS version_id, a.name AS name,
            a.source_template_id AS source_template_id, a.source_fingerprint AS source_fingerprint,
            a.updated_at AS updated_at, h.kind AS kind, h.role_asset_type AS role_asset_type,
            h.system_prompt AS system_prompt
       FROM role_asset_active a
       JOIN role_asset_history h ON h.asset_id = a.asset_id AND h.version_id = a.version_id
      ORDER BY a.updated_at DESC, a.asset_id ASC`);
    return summarizeRoleRows(rows);
}
/**
 * 历史（已归档）角色资产列表：有历史行、但没有 Active 行的资产，按**最新版本行**投影。
 *
 * 为什么必须与活跃列表分开而不是加一个标志位：活跃列表是父代理召回面（`wf_org_catalog`
 * 与本地向量索引都消费它），归档资产绝不能混进召回面；分开返回使「召回什么」在类型上可见。
 */
export function listRetiredRoleAssets(ctx) {
    const rows = ctx.all(`SELECT h.asset_id AS asset_id, h.version_id AS version_id, h.name AS name,
            h.source_template_id AS source_template_id, h.source_fingerprint AS source_fingerprint,
            h.updated_at AS updated_at, h.kind AS kind, h.role_asset_type AS role_asset_type,
            h.system_prompt AS system_prompt
       FROM role_asset_history h
      WHERE h.asset_id NOT IN (SELECT asset_id FROM role_asset_active)
        AND h.version_id = (SELECT MAX(x.version_id) FROM role_asset_history x WHERE x.asset_id = h.asset_id)
      ORDER BY h.updated_at DESC, h.asset_id ASC`);
    return summarizeRoleRows(rows);
}
/** 索引行 → 摘要（损坏行跳过并 warn；两个列表读共用同一份列映射）。 */
function summarizeRoleRows(rows) {
    const summaries = [];
    for (const row of rows) {
        try {
            const sourceTemplateId = textOrUndefined(row.source_template_id);
            const sourceFingerprint = textOrUndefined(row.source_fingerprint);
            const summary = roleSummaryOf(row.system_prompt);
            summaries.push({
                assetId: requireAssetId(row.asset_id),
                versionId: toInteger(row.version_id, 1),
                name: String(row.name ?? ''),
                kind: row.kind === 'parent' ? 'parent' : 'agent',
                roleAssetType: toRoleAssetType(row.role_asset_type),
                // 摘要在列表查询里 JOIN 当前版本行得到：父代理/客户端据此判断适用性，
                // 不额外读盘（N+1）也不编造职责描述；完整提示词始终可按 role-* 召回。
                ...(summary ? { summary } : {}),
                // currentTemplateFingerprint 由 API 边界读模版后填充（本模块不读模版），故不在此赋值
                ...(sourceTemplateId ? { sourceTemplateId } : {}),
                ...(sourceFingerprint ? { sourceFingerprint } : {}),
                updatedAt: toInteger(row.updated_at, 0),
            });
        }
        catch (error) {
            warnSkipped('角色资产', row.asset_id, error);
        }
    }
    return summaries;
}
/**
 * 引用了该角色资产**任一版本**的工作流资产（按资产聚合去重）。
 *
 * 口径为什么是资产级：`reference_workflow_ids` 记的是工作流版本行 id，且新版本行的引用从零
 * 开始计数，因此「单看 Active 版本行的数组长度」既不是引用方数量也不是引用次数——
 * 它会给出「shared 资产被 0 个工作流引用」这种与类型定义直接矛盾的读数。
 *
 * 名称取工作流资产的**最新版本行**（资产没有独立名称列）：归档工作流资产仍会被计入，
 * 因为它的历史版本仍钉住该角色版本（与归档确认框的说明一致）。
 */
export function listRoleAssetReferences(ctx, assetId) {
    const rows = ctx.all('SELECT reference_workflow_ids FROM role_asset_history WHERE asset_id = ?', [assetId]);
    const versionCounts = new Map();
    for (const row of rows) {
        for (const id of parseReferenceIds(row.reference_workflow_ids)) {
            // 只认 `<workflowAssetId>@<versionId>` 形状：形状漂移的旧数据宁可少算也不误报引用方
            const index = id.lastIndexOf('@');
            if (index <= 0)
                continue;
            const workflowAssetId = id.slice(0, index);
            versionCounts.set(workflowAssetId, (versionCounts.get(workflowAssetId) ?? 0) + 1);
        }
    }
    return [...versionCounts.entries()]
        .map(([workflowAssetId, versionCount]) => ({
        assetId: workflowAssetId,
        name: latestWorkflowAssetName(ctx, workflowAssetId) ?? workflowAssetId,
        versionCount,
    }))
        .sort((left, right) => compareText(left.name, right.name) || compareText(left.assetId, right.assetId));
}
/** 工作流资产最新版本行的名称（资产无独立名称列；行缺失返回 null）。 */
function latestWorkflowAssetName(ctx, assetId) {
    const row = ctx.get('SELECT name FROM workflow_asset_history WHERE asset_id = ? ORDER BY version_id DESC LIMIT 1', [
        assetId,
    ]);
    if (!row)
        return null;
    const name = String(row.name ?? '');
    return name === '' ? null : name;
}
/** 文本比较（码位序，确定性与运行环境无关；localeCompare 依赖 ICU 数据不适合做契约排序）。 */
function compareText(left, right) {
    if (left === right)
        return 0;
    return left < right ? -1 : 1;
}
/** 角色摘要字数上限（与目录索引展示口径一致）。 */
const ROLE_SUMMARY_LIMIT = 60;
/**
 * 角色职责摘要（空白压缩 + 超限标注）。
 * 与 `wf_org_catalog` 的 clip 同口径：两处唯一的差异来源就是这里的截断标记，
 * 因此本模块产出摘要后目录侧原样透传，不再二次截断（否则标记会叠加）。
 */
function roleSummaryOf(systemPrompt) {
    const text = String(systemPrompt ?? '').replace(/\s+/g, ' ').trim();
    return text.length > ROLE_SUMMARY_LIMIT ? `${text.slice(0, ROLE_SUMMARY_LIMIT)}…（已截断）` : text;
}
/**
 * 角色资产详情：活跃资产取 Active 版本；归档资产取**最新版本行**（并标 `retired`）。
 * resource 完全不存在（无 Active 且无历史行）返回 null，行损坏抛可诊断错误。
 */
export function getRoleAssetDetail(ctx, assetId) {
    const references = listRoleAssetReferences(ctx, assetId);
    const active = readRoleActive(ctx, assetId);
    if (active) {
        const row = readRoleVersionRow(ctx, assetId, active.versionId);
        if (!row) {
            // Active 行指向了不存在的版本：数据已损坏，伪装成「不存在」会掩盖问题
            throw new Error(`角色资产 ${assetId} 的 Active 版本 v${active.versionId} 在历史中缺失：资产行已损坏`);
        }
        return { ...roleAssetRowToDetail(row), referencingWorkflowAssets: references };
    }
    const latest = latestRoleVersionRow(ctx, assetId);
    if (!latest)
        return null;
    return { ...roleAssetRowToDetail(latest), retired: true, referencingWorkflowAssets: references };
}
/**
 * 按角色版本行 id（`<assetId>@<versionId>`）取**该版本**的角色资产详情。
 *
 * 与 getRoleAssetDetail 的区别：后者读 Active 版本，回滚或升版后会指到别的版本——目录把
 * 工作流资产里钉住的角色版本标注为可召回的 `role-*` 资产时，必须按钉住版本返回，否则标注的
 * 版本号与内容会撒谎。版本行 id 形状非法 / 行不存在 / 资产已退役（Active 行缺失）返回 null。
 */
export function getRoleAssetVersionDetail(ctx, roleRowId) {
    const index = roleRowId.lastIndexOf('@');
    if (index < 0)
        return null;
    const versionId = Number(roleRowId.slice(index + 1));
    if (!Number.isInteger(versionId) || versionId < 1)
        return null;
    const assetId = roleRowId.slice(0, index);
    const row = readRoleVersionRow(ctx, assetId, versionId);
    if (!row)
        return null;
    if (!isRoleAssetLive(ctx, assetId))
        return null;
    return roleAssetRowToDetail(row);
}
/**
 * 角色资产版本列表（按版本号倒序，最新在前）。
 * 归档资产同样可列（无 Active 指针时全部标 `active: false`）——历史资产的「重新启用」
 * 与「保存迭代」都以本列表为入口，因资产归档而报「不存在」会让界面无从操作。
 */
export function readRoleVersionEntries(ctx, assetId) {
    const active = readRoleActive(ctx, assetId);
    const rows = ctx.all('SELECT version_id, name, created_at, source FROM role_asset_history WHERE asset_id = ? ORDER BY version_id DESC', [assetId]);
    if (rows.length === 0)
        throw assetNotFound(assetId);
    return rows.map((row) => ({
        versionId: toInteger(row.version_id, 0),
        rowId: versionRowId(assetId, toInteger(row.version_id, 0)),
        name: String(row.name ?? ''),
        createdAt: toInteger(row.created_at, 0),
        source: row.source === 'agent' ? 'agent' : 'human',
        active: active !== null && toInteger(row.version_id, 0) === active.versionId,
    }));
}
/**
 * 回滚：把 Active 指针移向目标版本（含 name / retrieval_context / 来源指纹的同步），
 * 不新增版本、不改历史行——历史内容不可变是回滚语义的前提。
 *
 * 归档资产（无 Active 行）的回滚即「重新启用」：按目标版本重建 Active 行。
 * 这也是归档资产恢复活跃的唯一入口（保存只做版本迭代，不改变归档状态）。
 */
export function rollbackRoleAssetTo(ctx, assetId, versionId) {
    const target = readRoleVersionRow(ctx.tx, assetId, versionId);
    if (!target)
        throw assetVersionNotFound(assetId, versionId);
    writeRoleActiveRow(ctx.tx, {
        assetId,
        versionId,
        name: target.name,
        retrievalContext: roleRetrievalContext(assetId, target),
        sourceTemplateId: target.sourceTemplateId,
        sourceFingerprint: target.sourceFingerprint,
        updatedAt: ctx.now(),
    });
    return roleAssetRowToDetail(target);
}
/** 归档：删除 Active 行（历史、引用统计与类型列全部保留，供审计与重新启用判定）。 */
export function retireRoleAssetRow(tx, assetId) {
    const active = readRoleActive(tx, assetId);
    if (!active)
        throw assetNotFound(assetId);
    tx.run('DELETE FROM role_asset_active WHERE asset_id = ?', [assetId]);
}
// ---------------------------------------------------------------------------
// 写路径（算法 C / D）
// ---------------------------------------------------------------------------
/**
 * 角色晋升（算法 C）：
 *   1. 已有 Active 且绑定同一来源模版 → 走该资产的新版本路径（内容全等即 unchanged）；
 *   2. 否则内容去重：standalone 冲突直接拦截；inline/shared 冲突则合并（类型升 shared，不建新资产）；
 *   3. 均未命中 → 新建 standalone 资产（版本 1）。
 */
export function promoteRoleVersion(ctx, request) {
    const fields = roleContentFieldsOf(request.role);
    const templateId = request.sourceTemplateId;
    if (templateId) {
        const bound = ctx.tx.get(`SELECT a.asset_id AS asset_id, a.version_id AS version_id
         FROM role_asset_active a WHERE a.source_template_id = ? ORDER BY a.updated_at DESC LIMIT 1`, [templateId]);
        if (bound) {
            const assetId = requireAssetId(bound.asset_id);
            const versionId = requireVersionId(bound.version_id);
            const activeRow = readRoleVersionRow(ctx.tx, assetId, versionId);
            if (activeRow && sameRoleFields(roleContentOf(activeRow), fields)) {
                return {
                    assetId,
                    versionId,
                    rowId: versionRowId(assetId, versionId),
                    unchanged: true,
                    roleAssetType: activeRow.roleAssetType,
                    sharedRoleAssetIds: [],
                };
            }
            const registration = addRoleVersion(ctx, {
                assetId,
                fields,
                roleAssetType: activeRow ? activeRow.roleAssetType : 'standalone',
                source: request.source,
                // 同一模版的二次晋升：来源绑定与指纹随新版本刷新（入库按钮据此重新锁定）
                inheritSource: { sourceTemplateId: templateId, sourceFingerprint: request.fingerprint },
            });
            return { ...registration, sharedRoleAssetIds: [] };
        }
    }
    const duplicate = findRoleVersionByContent(ctx.tx, fields);
    if (duplicate) {
        // 类型以该资产**当前** Active 版本为准（命中行可能不是 Active 行）
        const duplicateType = currentRoleAssetType(ctx.tx, duplicate.assetId, duplicate.row);
        if (duplicateType === 'standalone') {
            throw new AssetError(`内容与已有角色资产 ${duplicate.assetId}（v${duplicate.versionId}）全等：standalone 资产重复登记已被拦截，` +
                '请改用该资产或修改系统提示词后重试', ERR_ASSET_DUPLICATE);
        }
        // inline/shared 冲突不新建资产：合并到既有资产并升级类型
        markRoleVersionShared(ctx, duplicate.row.id);
        return {
            assetId: duplicate.assetId,
            versionId: duplicate.versionId,
            rowId: duplicate.row.id,
            unchanged: true,
            roleAssetType: 'shared',
            sharedRoleAssetIds: [duplicate.assetId],
        };
    }
    const created = createRoleAsset(ctx, {
        assetId: request.newAssetId,
        fields,
        roleAssetType: 'standalone',
        source: request.source,
        sourceTemplateId: templateId,
        sourceFingerprint: request.fingerprint,
    });
    return { ...created, sharedRoleAssetIds: [] };
}
/**
 * 资产态保存（算法 D）：登记新版本，来源绑定与指纹**继承**自被保存的版本
 * （保存不改写来源模版事实，只有晋升会刷新它）。
 *
 * 归档资产同样可保存（历史资产的版本迭代）：基线与继承源取最新版本行，且不重建 Active 行
 * ——归档状态只由显式回滚改变。
 */
export function saveRoleAssetVersion(ctx, input) {
    const assetId = requireAssetId(input.assetId);
    const active = readRoleActive(ctx.tx, assetId);
    const baseline = roleBaselineRow(ctx.tx, assetId);
    // 既无 Active 行也无历史行：资产并不存在（归档资产至少留有一个版本行）
    if (!baseline)
        throw assetNotFound(assetId);
    const fields = roleContentFieldsOf(input.role);
    if (sameRoleFields(roleContentOf(baseline), fields)) {
        return {
            assetId,
            versionId: baseline.versionId,
            rowId: versionRowId(assetId, baseline.versionId),
            unchanged: true,
            roleAssetType: baseline.roleAssetType,
            sharedRoleAssetIds: [],
        };
    }
    const registration = addRoleVersion(ctx, {
        assetId,
        fields,
        roleAssetType: baseline.roleAssetType,
        source: input.source,
        inheritSource: { sourceTemplateId: baseline.sourceTemplateId, sourceFingerprint: baseline.sourceFingerprint },
        previousRow: baseline,
        activate: active !== null,
    });
    return { ...registration, sharedRoleAssetIds: [] };
}
/**
 * 保存前的影响面预览（角色资产，只读）：内容确实会变更时返回「引用了本资产的其它工作流资产」。
 *
 * 内容判据与 saveRoleAssetVersion 完全同源（同一个 `sameRoleFields` 与同一份字段映射），
 * 因此不会出现「预览说没事、保存却登记了新版本」的分叉。内容未变更返回空数组。
 */
export function previewRoleAssetCascade(ctx, assetId, role) {
    const baseline = roleBaselineRow(ctx.tx, assetId);
    if (!baseline)
        throw assetNotFound(assetId);
    if (sameRoleFields(roleContentOf(baseline), roleContentFieldsOf(role)))
        return [];
    return listRoleAssetReferences(ctx.tx, assetId);
}
// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------
/**
 * 被保存版本基线行：活跃资产取 Active 版本行，归档资产取最新版本行。
 * Active 行指向缺失版本时抛错（资产行已损坏），不静默回落到别的版本。
 */
function roleBaselineRow(tx, assetId) {
    const active = readRoleActive(tx, assetId);
    if (!active)
        return latestRoleVersionRow(tx, assetId);
    const row = readRoleVersionRow(tx, assetId, active.versionId);
    if (!row) {
        throw new Error(`角色资产 ${assetId} 的 Active 版本 v${active.versionId} 在历史中缺失：资产行已损坏`);
    }
    return row;
}
/** 被保存的 Active 版本行解析（调用方已给出则不回表）。 */
function resolvePreviousVersion(tx, input) {
    if (input.previousRow !== undefined)
        return input.previousRow;
    const active = readRoleActive(tx, input.assetId);
    return active ? readRoleVersionRow(tx, input.assetId, active.versionId) : null;
}
/** 资产当前类型（读 Active 版本行；Active 缺失或行损坏时回落到命中行）。 */
function currentRoleAssetType(tx, assetId, fallbackRow) {
    const active = readRoleActive(tx, assetId);
    if (!active)
        return fallbackRow.roleAssetType;
    const activeRow = readRoleVersionRow(tx, assetId, active.versionId);
    return activeRow ? activeRow.roleAssetType : fallbackRow.roleAssetType;
}
/** 角色模版 → 内容字段（name 必填校验；其余缺省即默认值，见 row-codec 映射口径）。 */
function roleContentFieldsOf(role) {
    requireText(role.name, 'role.name');
    return roleFieldsFromTemplate(role);
}
/** 行 → 内容字段（比较用；统计列不参与「内容是否变更」判定）。 */
function roleContentOf(row) {
    return {
        kind: row.kind,
        name: row.name,
        systemPrompt: row.systemPrompt,
        provider: row.provider,
        model: row.model,
        reasoning: row.reasoning,
        presetId: row.presetId,
        retryLimit: row.retryLimit,
        reactLimit: row.reactLimit,
        inputSchema: row.inputSchema,
        outputSchema: row.outputSchema,
        systemPromptSource: row.systemPromptSource,
        injectSystemPrompt: row.injectSystemPrompt,
        injectToolSections: row.injectToolSections,
        promptFilePath: row.promptFilePath,
    };
}
/**
 * 历史行插入（导出给工作流写路径复用：角色节点升版与角色资产升版必须落同一份列映射，
 * 否则两条路径的行形状会漂移）。
 */
export function insertRoleVersionRow(tx, values) {
    tx.run(`INSERT INTO role_asset_history (
       id, version_id, asset_id, kind, name, system_prompt, provider, model, reasoning, preset_id,
       retry_limit, react_limit, input_schema, output_schema, system_prompt_source,
       inject_system_prompt, inject_tool_sections, prompt_file_path, retrieval_context,
       role_asset_type, reference_status, reference_workflow_ids, source, source_template_id,
       source_fingerprint, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        values.id,
        values.versionId,
        values.assetId,
        values.kind,
        values.name,
        values.systemPrompt,
        values.provider,
        values.model,
        values.reasoning,
        values.presetId,
        values.retryLimit,
        values.reactLimit,
        values.inputSchema,
        values.outputSchema,
        values.systemPromptSource,
        values.injectSystemPrompt,
        values.injectToolSections,
        values.promptFilePath,
        values.retrievalContext,
        values.roleAssetType,
        values.referenceStatus,
        values.referenceWorkflowIds,
        values.source,
        values.sourceTemplateId,
        values.sourceFingerprint,
        values.createdAt,
        values.updatedAt,
    ]);
}
/** Active 行插入或替换（asset_id 主键，指针语义；导出给工作流写路径复用）。 */
export function writeRoleActiveRow(tx, values) {
    tx.run(`INSERT INTO role_asset_active (asset_id, version_id, name, retrieval_context, source_template_id, source_fingerprint, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       version_id = excluded.version_id,
       name = excluded.name,
       retrieval_context = excluded.retrieval_context,
       source_template_id = excluded.source_template_id,
       source_fingerprint = excluded.source_fingerprint,
       updated_at = excluded.updated_at`, [
        values.assetId,
        values.versionId,
        values.name,
        values.retrievalContext,
        values.sourceTemplateId,
        values.sourceFingerprint,
        values.updatedAt,
    ]);
}
/** 版本行 → 详情契约（不读模版，currentTemplateFingerprint 由 API 边界填充）。 */
export function roleAssetRowToDetail(row) {
    return {
        assetId: row.assetId,
        versionId: row.versionId,
        rowId: row.id,
        kind: row.kind,
        roleAssetType: row.roleAssetType,
        name: row.name,
        systemPrompt: row.systemPrompt,
        provider: row.provider,
        model: row.model,
        reasoning: row.reasoning,
        presetId: row.presetId,
        retryLimit: row.retryLimit,
        reactLimit: row.reactLimit,
        inputSchema: row.inputSchema ?? undefined,
        outputSchema: row.outputSchema ?? undefined,
        systemPromptSource: row.systemPromptSource ?? undefined,
        injectSystemPrompt: row.injectSystemPrompt,
        injectToolSections: row.injectToolSections,
        promptFilePath: row.promptFilePath ?? undefined,
        referenceWorkflowIds: row.referenceWorkflowIds,
        ...(row.sourceTemplateId ? { sourceTemplateId: row.sourceTemplateId } : {}),
        createdAt: row.createdAt,
    };
}
function textOrUndefined(value) {
    if (value === null || value === undefined)
        return undefined;
    const text = String(value);
    return text === '' ? undefined : text;
}
/** 列表读跳过损坏项时的告警（可追溯；不抛错以免整表不可用）。 */
function warnSkipped(kind, id, error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[assets] 跳过损坏的${kind} ${String(id)}：${detail}`);
}
//# sourceMappingURL=role-assets.js.map
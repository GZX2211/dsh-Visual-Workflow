// src/host/assets/experience-prompts.ts
//
// 经验生成提示词资产的读写端口：列表/详情、版本登记（只接受正文）、回滚、
// 以及经验生成路径读取当前活跃版本。
//
// 语义边界（用户裁决 2026-10-19）：
//   - 两款提示词是**资产**：与其他资产共用「历史不可变 + Active 指针 + 回滚只移指针」；
//   - 只有正文可编辑；名称 / 描述 / 主体类型是内置定义，保存新版本时从基线版本继承；
//   - 不允许归档：本文件刻意没有删除 Active 行的入口，初始化时为缺失指针自愈；
//   - 经验 provenance 继续用 generation_prompt_id（版本行 id）与
//     generation_prompt_version（版本文本）对接，历史经验永远指向生成时的版本。
//
// 事务边界：全部写函数由调用方（AssetStore.withTx）提供事务；读函数走只读事务。
import { assetBadArgs, assetNotFound, assetVersionNotFound } from './errors.js';
import { asExperienceType, experiencePromptRowToEntry } from './experience-codec.js';
import { versionRowId } from './ids.js';
import { requireAssetId, requireVersionId, toInteger, toNullableText } from './role-check.js';
/** 某主体类型当前生效的 Prompt（无活跃行返回 null：该类型的经验生成被显式关闭）。 */
export function getActivePromptRow(ctx, type) {
    const row = ctx.get(`SELECT h.*, 1 AS is_active, a.updated_at AS active_updated_at
       FROM experience_prompt_active a
       JOIN experience_prompts h ON h.asset_id = a.asset_id AND h.version_id = a.version_id
      WHERE a.experience_type = ?`, [type]);
    return row ? experiencePromptRowToEntry(row) : null;
}
/**
 * 全量 Prompt（含历史版本；同一资产内活跃行排在前）。
 *
 * 经验域只消费 `getActivePrompt`；本函数保留给诊断/管理读路径，
 * `active` 由 Active 指针比较得出，而不是行上的状态列（后者已不存在）。
 */
export function listPromptRows(ctx) {
    const rows = ctx.all(`SELECT h.*,
            CASE WHEN a.version_id IS NOT NULL THEN 1 ELSE 0 END AS is_active,
            COALESCE(a.updated_at, h.created_at) AS active_updated_at
       FROM experience_prompts h
       LEFT JOIN experience_prompt_active a
         ON a.asset_id = h.asset_id AND a.version_id = h.version_id
      ORDER BY h.experience_type ASC, is_active DESC, h.created_at DESC, h.id ASC`);
    return rows.map(experiencePromptRowToEntry);
}
/** 提示词资产列表（Active 版本投影；两款资产都必须有活跃指针，否则初始化会自愈）。 */
export function listPromptAssets(ctx) {
    const rows = ctx.all(`SELECT h.*, a.updated_at AS active_updated_at
       FROM experience_prompt_active a
       JOIN experience_prompts h ON h.asset_id = a.asset_id AND h.version_id = a.version_id
      ORDER BY h.experience_type ASC, h.asset_id ASC`);
    const summaries = [];
    for (const row of rows) {
        try {
            const asset = promptRowOf(row);
            summaries.push({
                assetId: asset.assetId,
                versionId: asset.versionId,
                name: asset.name,
                description: asset.description ?? '',
                experienceType: asset.experienceType,
                promptVersion: asset.promptVersion,
                prompt: asset.prompt,
                updatedAt: toInteger(row.active_updated_at, asset.createdAt),
            });
        }
        catch (error) {
            warnSkipped('提示词资产', row.asset_id, error);
        }
    }
    return summaries;
}
/**
 * 提示词资产详情（Active 版本）。
 *
 * Active 行缺失时回落到最新版本行（只读降级）：页面仍能看到可用正文，
 * 写路径会在下一次保存/回滚时重建指针；不把「指针损坏」伪装成「资产不存在」。
 */
export function getPromptAssetDetail(ctx, assetId) {
    const id = requireAssetId(assetId);
    const active = readPromptActiveRow(ctx, id);
    if (active) {
        const row = readPromptVersionRow(ctx, id, active.versionId);
        if (!row) {
            throw new Error(`提示词资产 ${id} 的 Active 版本 v${active.versionId} 在历史中缺失：资产行已损坏`);
        }
        return promptDetailOf(row, active.updatedAt);
    }
    const latest = latestPromptRow(ctx, id);
    return latest ? promptDetailOf(latest, latest.createdAt) : null;
}
/** 提示词资产版本列表（版本号倒序；不可归档，因此所有版本都属于同一条活跃资产）。 */
export function readPromptVersionEntries(ctx, assetId) {
    const id = requireAssetId(assetId);
    const active = readPromptActiveRow(ctx, id);
    const rows = ctx.all(`SELECT version_id, name, created_at, source
       FROM experience_prompts WHERE asset_id = ? ORDER BY version_id DESC`, [id]);
    if (rows.length === 0)
        throw assetNotFound(id);
    return rows.map((row) => ({
        versionId: toInteger(row.version_id, 0),
        rowId: versionRowId(id, toInteger(row.version_id, 0)),
        name: String(row.name ?? ''),
        createdAt: toInteger(row.created_at, 0),
        source: row.source === 'agent' ? 'agent' : 'human',
        active: active !== null && toInteger(row.version_id, 0) === active.versionId,
    }));
}
/**
 * 保存提示词资产新版本：只接受正文，其余固定字段从当前基线版本继承。
 *
 * 内容全等即 `unchanged`（与其他资产的保存查重同口径）：重复点击保存不堆版本。
 * 新版本行 id 用 `<assetId>@<versionId>`；`prompt_version` 取 `V<versionId>`，
 * 供经验 provenance 记录「生成时使用的是哪一版正文」。
 */
export function savePromptAssetVersion(ctx, input) {
    const assetId = requireAssetId(input.assetId);
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (prompt.trim() === '') {
        throw assetBadArgs('提示词正文不能为空：请填写正文后再保存（正文是经验生成的当前策略）');
    }
    const active = readPromptActiveRow(ctx.tx, assetId);
    const baseline = active
        ? readPromptVersionRow(ctx.tx, assetId, active.versionId)
        : latestPromptRow(ctx.tx, assetId);
    if (!baseline)
        throw assetNotFound(assetId);
    if (prompt === baseline.prompt) {
        return { assetId, versionId: baseline.versionId, rowId: baseline.id, unchanged: true };
    }
    const versionId = nextPromptVersionId(ctx.tx, assetId);
    const rowId = versionRowId(assetId, versionId);
    const now = ctx.now();
    ctx.tx.run(`INSERT INTO experience_prompts (
       id, version_id, asset_id, experience_type, name, description, prompt, prompt_version, source, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human', ?)`, [
        rowId,
        versionId,
        assetId,
        baseline.experienceType,
        baseline.name,
        baseline.description,
        prompt,
        `V${versionId}`,
        // created_at 是资产诞生时间，不是本版本登记时间（与其他资产同口径）
        baseline.createdAt,
    ]);
    writePromptActiveRow(ctx.tx, {
        assetId,
        versionId,
        experienceType: baseline.experienceType,
        name: baseline.name,
        updatedAt: now,
    });
    return { assetId, versionId, rowId, unchanged: false };
}
/**
 * 回滚：只把 Active 指针移向目标版本，不新增版本、不改历史行。
 * 提示词资产永远活跃，因此这里不存在「归档资产回滚即恢复」的分支。
 */
export function rollbackPromptAssetTo(ctx, assetId, versionId) {
    const id = requireAssetId(assetId);
    const version = requireVersionId(versionId);
    const target = readPromptVersionRow(ctx.tx, id, version);
    if (!target)
        throw assetVersionNotFound(id, version);
    const now = ctx.now();
    writePromptActiveRow(ctx.tx, {
        assetId: id,
        versionId: version,
        experienceType: target.experienceType,
        name: target.name,
        updatedAt: now,
    });
    return promptDetailOf(target, now);
}
// ---------------------------------------------------------------------------
// 内部：行读取与转换
// ---------------------------------------------------------------------------
/** Active 指针行（不存在返回 null）。 */
function readPromptActiveRow(ctx, assetId) {
    const row = ctx.get('SELECT * FROM experience_prompt_active WHERE asset_id = ?', [assetId]);
    if (!row)
        return null;
    return {
        assetId: requireAssetId(row.asset_id),
        versionId: toInteger(row.version_id, 0),
        experienceType: asExperienceType(row.experience_type),
        name: String(row.name ?? ''),
        updatedAt: toInteger(row.updated_at, 0),
    };
}
/** 指定版本行（不存在返回 null）。 */
function readPromptVersionRow(ctx, assetId, versionId) {
    const row = ctx.get('SELECT * FROM experience_prompts WHERE asset_id = ? AND version_id = ?', [assetId, versionId]);
    return row ? promptRowOf(row) : null;
}
/** 最新版本行（max version_id；资产不存在返回 null）。 */
function latestPromptRow(ctx, assetId) {
    const row = ctx.get('SELECT * FROM experience_prompts WHERE asset_id = ? ORDER BY version_id DESC LIMIT 1', [assetId]);
    return row ? promptRowOf(row) : null;
}
/** 下一个版本号 = max(version_id) + 1。 */
function nextPromptVersionId(ctx, assetId) {
    const row = ctx.get('SELECT MAX(version_id) AS max_version FROM experience_prompts WHERE asset_id = ?', [assetId]);
    return toInteger(row?.max_version, 0) + 1;
}
/** Active 行插入或替换（asset_id 主键，指针语义；保存与回滚共用一份列映射）。 */
function writePromptActiveRow(tx, values) {
    tx.run(`INSERT INTO experience_prompt_active (asset_id, version_id, experience_type, name, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       version_id = excluded.version_id,
       experience_type = excluded.experience_type,
       name = excluded.name,
       updated_at = excluded.updated_at`, [values.assetId, values.versionId, values.experienceType, values.name, values.updatedAt]);
}
/** 行 → 版本事实（严格读；列表读在调用点捕获后跳过损坏行）。 */
function promptRowOf(row) {
    const versionId = toInteger(row.version_id, 0);
    if (versionId < 1) {
        throw new Error(`提示词版本行 ${String(row.id)} 的 version_id 非法：资产行已损坏`);
    }
    return {
        id: requireAssetId(row.id, 'experience_prompts.id'),
        versionId,
        assetId: requireAssetId(row.asset_id, 'experience_prompts.asset_id'),
        experienceType: asExperienceType(row.experience_type),
        name: String(row.name ?? ''),
        description: toNullableText(row.description),
        prompt: String(row.prompt ?? ''),
        promptVersion: String(row.prompt_version ?? ''),
        source: row.source === 'agent' ? 'agent' : 'human',
        createdAt: toInteger(row.created_at, 0),
    };
}
/** 版本行 → 详情契约。 */
function promptDetailOf(row, updatedAt) {
    return {
        assetId: row.assetId,
        versionId: row.versionId,
        rowId: row.id,
        name: row.name,
        description: row.description ?? '',
        experienceType: row.experienceType,
        promptVersion: row.promptVersion,
        prompt: row.prompt,
        updatedAt,
        createdAt: row.createdAt,
    };
}
/** 列表读跳过损坏项时的告警（可追溯；不抛错以免整表不可用）。 */
function warnSkipped(kind, id, error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[assets] 跳过损坏的${kind} ${String(id)}：${detail}`);
}
//# sourceMappingURL=experience-prompts.js.map
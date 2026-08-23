// scripts/embedding-model.mjs
//
// T-004（R-03）：准备 bge-small-zh-v1.5 本地嵌入模型资产（tokenizer/配置 + ONNX 量化权重）。
//
// 背景（为什么这么做）：
// - 本机无 python，无法走 optimum 导出 ONNX（见 docs/开发环境.md §1）。因此推理权重
//   不从本地 PyTorch safetensors 转换，而是从官方 BAAI/bge-small-zh-v1.5 仓库 onnx/ 目录
//   直接获取量化产物（约 25MB），与 HF onnx-community 产物同源。
// - 本地源码目录仅提供 tokenizer/配置（纯文本）与 PyTorch 权重；PyTorch 权重
//   （model.safetensors / pytorch_model.bin，各约 91MB）绝不能复制进仓库。
// - 幂等设计：manifest.json 记录每个文件的字节数与 sha256；再次运行若所有文件与 manifest
//   完全一致则跳过复制/下载，直接判定"资产已就绪"。这样既省重复下载，也能检测文件损坏。
// - 降级语义（需求 §4.2.4.2 / 架构 §6.5）：ONNX 权重下载失败（网络/404）不硬失败，
//   写 README.zh.md 说明"运行时降级 BM25 相似度检索（UI 标注：相似度检索（非语义））"，
//   退出码 0，并在报告里明确标注。这是产品级降级路径，不是脚本错误。

import { createHash } from 'node:crypto'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 项目根目录（本脚本位于 scripts/ 下）。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// 源码目录（只读）。绝对路径仅作为本机事实源，不写死在产物里（manifest 记录的是来源标识）。
const SOURCE_DIR = 'D:\\AiCoding-Gzx\\models\\backend\\models\\bge-small-zh-v1.5'

// 目标目录（随包分发，package.json files 已含 assets/models/bge-small-zh-v1.5）。
const TARGET_DIR = path.join(ROOT, 'assets', 'models', 'bge-small-zh-v1.5')

const MANIFEST_FILE = 'manifest.json'
const README_FALLBACK = 'README.zh.md'

// 需要从源码目录复制的「纯文本小配置」文件名（只读、无权重）。
// 顺序无关，但列出完整清单以明确"绝不复制 safetensors/pytorch_model.bin/.cache"的边界。
const TEXT_FILES_TO_COPY = [
  'tokenizer.json',
  'config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'tokenizer_config.json',
  'config_sentence_transformers.json',
  'sentence_bert_config.json',
  'modules.json',
]

// 严禁进入仓库的 PyTorch 权重与缓存（黑名单，作防御性校验，防止未来源码目录新增内容误入）。
const FORBIDDEN_SOURCE_ENTRIES = new Set([
  'model.safetensors',
  'pytorch_model.bin',
  '.cache',
])

// 1_Pooling 配置：源码目录存在 1_Pooling 时直接复制；否则依据 sentence_bert_config.json
// 的 pooling 配置生成「标准 1_Pooling/config.json」。
// 形态采用 { name: "pooling", config: {...} }（与 HF 官方 bge 仓库 onnx 导出一致）。
// pooling_mode_cls_token 默认 true（bge 用 CLS token 作句向量）、word_embedding_dimension=512。
const POOLING_DIR = '1_Pooling'
const POOLING_CONFIG_NAME = 'config.json'

// ONNX 权重候选下载地址（按优先级依次尝试，跟随重定向）。
//
// 为什么是这份清单（R-03 实现时查证结论，记录于此避免后续误改）：
// 1. BAAI/bge-small-zh-v1.5 官方仓库**不含任何 onnx/ 目录**（仅 PyTorch 权重），任务给定的
//    字面 URL 会 404；但按 DoD 要求仍把它们放在首位尝试（遵循任务字面约定，记录失败）。
// 2. huggingface.co 在本机网络不可达（连接超时），仅中文镜像 hf-mirror.com 可达，故为每个
//    候选补充镜像地址。
// 3. 真正可用、且满足「单文件 >10MB、带 ONNX 魔数」的量化产物在 Xenova/bge-small-zh-v1.5
//    （transformers.js v2 时代的自包含单文件 onnx/model_quantized.onnx，约 24MB），列为兜底。
// 4. onnx-community/bge-small-zh-v1.5-ONNX 是 transformers.js v3 的**外部数据格式**
//    （onnx 图 + .onnx_data 权重分离），不满足本任务「单文件 model_quantized.onnx」的形态，
//    故不作为本脚本目标（T-025 如需该格式可另行处理）。
const ONNX_CANDIDATE_URLS = [
  // 任务给定字面 URL（BAAI 仓库无 onnx/，预期 404；不删除以保留 DoD 追溯）。
  'https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/onnx/model.onnx',
  'https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/model_quantized.onnx',
  // 自包含单文件量化产物（正确目标）：Xenova 仓库 v2 单文件，约 24MB。
  'https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx',
  // 中文镜像（本机 huggingface.co 不可达时的可用通道）。
  'https://hf-mirror.com/BAAI/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx',
  'https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx',
]
const ONNX_TARGET_NAME = 'model_quantized.onnx'
// ONNX 权重在资产目录内的「相对子路径」。transformers.js v4 的建模工具统一以
// 「subfolder = "onnx"」加载（`onnx/<base>_quantized.onnx`），见 node_modules 内
// modeling_utils 的 getModelJson（subfolder 固定为 "onnx"）。因此权重必须落在
// onnx/ 子目录，否则 T-025 的 Model.from_pretrained 会因「Local file missing at
// .../onnx/model_quantized.onnx」失败。此为事实查证结论（本脚本已在真机验证加载成功）。
const ONNX_TARGET_REL = `onnx/${ONNX_TARGET_NAME}`
// ONNX 权重的「规范来源」标识：实际可用的自包含单文件量化产物位于 Xenova 仓库（见下方候选清单注释）。
// 用于在"文件已存在、跳过下载"时仍能在 manifest 里写下来源（幂等重跑不丢失溯源信息）。
const ONNX_CANONICAL_SOURCE_URL = 'https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx'
// 大小校验区间（字节）：量化权重约 25MB，下限 10MB、上限 60MB 兜底防误采。
const ONNX_MIN_BYTES = 10 * 1024 * 1024
const ONNX_MAX_BYTES = 60 * 1024 * 1024

// ---------------------------------------------------------------------------
// 工具函数（导出供 tests/host/embedding-assets.test.ts 复用，注释说明同一实现）
// ---------------------------------------------------------------------------

/** 计算文件内容的 sha256 十六进制摘要（node:crypto）。 */
export async function sha256OfFile(filePath) {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

/** 判断文件是否存在且大小 > 0。 */
export async function existsNonEmpty(filePath) {
  try {
    const st = await fs.stat(filePath)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

/** 确保目录存在（幂等，已存在则无操作）。 */
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

/** 读取磁盘文件的 { bytes, sha256 } 元信息；文件不存在返回 null。 */
async function fileMeta(filePath) {
  try {
    const st = await fs.stat(filePath)
    return { bytes: st.size, sha256: await sha256OfFile(filePath) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 步骤 1：复制纯文本配置
// ---------------------------------------------------------------------------

/**
 * 逐个复制文本配置到目标目录。
 * 幂等：目标"存在且大小>0"即跳过；否则从源码读取并写入。
 * 返回 { name, copied, bytes } 列表（未复制=跳过）。
 */
async function copyTextConfigs() {
  await ensureDir(TARGET_DIR)
  const results = []
  for (const name of TEXT_FILES_TO_COPY) {
    const src = path.join(SOURCE_DIR, name)
    const dst = path.join(TARGET_DIR, name)
    if (await existsNonEmpty(dst)) {
      results.push({ name, copied: false, bytes: (await fs.stat(dst)).size })
      continue
    }
    const data = await fs.readFile(src)
    await fs.writeFile(dst, data)
    results.push({ name, copied: true, bytes: data.length })
  }
  return results
}

// ---------------------------------------------------------------------------
// 步骤 2：1_Pooling/config.json
// ---------------------------------------------------------------------------

/**
 * 生成/复制 1_Pooling/config.json。
 * 源码目录存在 1_Pooling/config.json 时直接复制（保持与源一致）；
 * 否则依据源码的 sentence_bert_config.json 生成标准形态 { name: "pooling", config: {...} }。
 * 生成规则：pooling_mode_cls_token 默认 true、word_embedding_dimension 从源码 config.json
 * hidden_size 读（默认 512），其余 pooling_mode_* 布尔默认 false。
 */
async function ensurePoolingConfig() {
  await ensureDir(path.join(TARGET_DIR, POOLING_DIR))
  const dstPath = path.join(TARGET_DIR, POOLING_DIR, POOLING_CONFIG_NAME)
  if (await existsNonEmpty(dstPath)) {
    // 已存在则不覆盖（幂等），返回磁盘当前字节数。
    return { name: `${POOLING_DIR}/${POOLING_CONFIG_NAME}`, copied: false, bytes: (await fs.stat(dstPath)).size }
  }

  const sourcePoolingConfig = path.join(SOURCE_DIR, POOLING_DIR, POOLING_CONFIG_NAME)
  const sourceHasPooling = await existsNonEmpty(sourcePoolingConfig)

  let content
  if (sourceHasPooling) {
    // 源码目录自带 1_Pooling，直接复制原样（保持与本地源一致）。
    content = await fs.readFile(sourcePoolingConfig)
  } else {
    // 源码缺失 1_Pooling：按官方 HF bge onnx 导出形态生成标准 pooling 配置。
    // 从源码 config.json 读 hidden_size 作为 word_embedding_dimension（默认 512）。
    let dim = 512
    try {
      const rawConfig = JSON.parse(await fs.readFile(path.join(SOURCE_DIR, 'config.json'), 'utf8'))
      if (typeof rawConfig.hidden_size === 'number') dim = rawConfig.hidden_size
    } catch {
      // 源 config.json 缺失/损坏时退回默认 512（config.json 本身会被 copyTextConfigs 复制并校验）。
    }
    const pooling = {
      name: 'pooling',
      config: {
        word_embedding_dimension: dim,
        pooling_mode_cls_token: true,
        pooling_mode_mean_tokens: false,
        pooling_mode_max_tokens: false,
        pooling_mode_mean_sqrt_len_tokens: false,
      },
    }
    content = Buffer.from(JSON.stringify(pooling, null, 2) + '\n', 'utf8')
  }

  await fs.writeFile(dstPath, content)
  return { name: `${POOLING_DIR}/${POOLING_CONFIG_NAME}`, copied: true, bytes: content.length }
}

// ---------------------------------------------------------------------------
// 步骤 3：ONNX 权重获取
// ---------------------------------------------------------------------------

/**
 * 用 Node 内置 fetch 下载 ONNX 权重（跟随重定向）。
 * 依次尝试候选 URL：成功且大小在 (10MB,60MB) 区间则接受；404 或大小无效则尝试下一个。
 * 返回 { ok, name, url, bytes }；全部失败返回 { ok:false }（不抛错，交由降级说明处理）。
 */
async function fetchOnnxIfNeeded() {
  const dstPath = path.join(TARGET_DIR, ...ONNX_TARGET_REL.split('/'))
  if (await existsNonEmpty(dstPath)) {
    // 已存在且大小合法则跳过下载（幂等）；但注意：即使存在，仍可能被 manifest 校验判定需重下。
    const st = await fs.stat(dstPath)
    if (st.size > ONNX_MIN_BYTES && st.size < ONNX_MAX_BYTES) {
      return { ok: true, name: ONNX_TARGET_REL, url: null, bytes: st.size, skipped: true }
    }
  }

  for (const url of ONNX_CANDIDATE_URLS) {
    try {
      const resp = await fetch(url, { redirect: 'follow' })
      if (!resp.ok) {
        // 记录 404/其他状态，继续尝试下一个候选。
        console.log(`[embedding-model] 下载失败（HTTP ${resp.status}）：${url}`)
        continue
      }
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length <= ONNX_MIN_BYTES || buf.length >= ONNX_MAX_BYTES) {
        // 大小不符合量化权重预期（约 25MB），视为异常产物，继续下一个候选。
        console.log(`[embedding-model] 下载产物大小异常（${buf.length} 字节）跳过：${url}`)
        continue
      }
      await fs.writeFile(dstPath, buf)
      return { ok: true, name: ONNX_TARGET_REL, url, bytes: buf.length, skipped: false }
    } catch (err) {
      console.log(`[embedding-model] 下载出错（${err?.message ?? err}）：${url}`)
    }
  }

  // 全部候选失败：返回失败，交由降级说明处理（不硬失败）。
  return { ok: false, name: ONNX_TARGET_REL, url: null, bytes: 0 }
}

// ---------------------------------------------------------------------------
// 步骤 4：manifest 与幂等校验
// ---------------------------------------------------------------------------

/**
 * 计算目标目录内「受管文件」清单（文本配置 + 1_Pooling/config.json + 可选 ONNX 权重），
 * 但不含 manifest.json 与 README.zh.md 本身（这两者由脚本生成，不属于资产内容）。返回
 * { <相对名>: { bytes, sha256 } }，文件名相对目标目录、以 '/' 分隔。
 */
async function computeManagedFiles() {
  const managed = {}
  const relNames = [
    ...TEXT_FILES_TO_COPY,
    `${POOLING_DIR}/${POOLING_CONFIG_NAME}`,
  ]
  // ONNX 权重若存在则纳入（字节数会被 manifest 记录，供幂等校验与测试断言）。
  const onnxPath = path.join(TARGET_DIR, ...ONNX_TARGET_REL.split('/'))
  if (await existsNonEmpty(onnxPath)) {
    relNames.push(ONNX_TARGET_REL)
  }
  for (const rel of relNames) {
    const meta = await fileMeta(path.join(TARGET_DIR, ...rel.split('/')))
    if (meta) managed[rel] = meta
  }
  return managed
}

/**
 * 读取 manifest.json；不存在或结构非法返回 null。
 */
async function readManifest() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(TARGET_DIR, MANIFEST_FILE), 'utf8'))
    // files 为「文件名 -> {bytes,sha256}」映射对象（而非数组）。
    if (raw && raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)) return raw
  } catch {
    // ignore
  }
  return null
}

/**
 * 校验 manifest：manifest 中每个文件都存在且 bytes/sha256 与磁盘一致；同时磁盘上不应存在
 * manifest 未记录的受管文件（防止旧文件残留）。返回是否有差异。
 */
async function manifestMatches(manifest, onDisk) {
  // 两边键集合必须一致（受管文件应完全由 manifest 描述）。
  const manifestKeys = Object.keys(manifest.files ?? {}).sort()
  const diskKeys = Object.keys(onDisk).sort()
  if (JSON.stringify(manifestKeys) !== JSON.stringify(diskKeys)) return false
  for (const key of manifestKeys) {
    const m = manifest.files[key]
    const d = onDisk[key]
    if (!m || !d || m.bytes !== d.bytes || m.sha256 !== d.sha256) return false
  }
  return true
}

/** 写降级说明 README.zh.md（ONNX 缺失时）。 */
async function writeFallbackReadme(onDisk) {
  const hasOnnx = Object.prototype.hasOwnProperty.call(onDisk, ONNX_TARGET_REL)
  const lines = [
    '# bge-small-zh-v1.5 模型资产说明',
    '',
    '> 本文档由 `scripts/embedding-model.mjs` 自动生成（ONNX 权重下载失败时）。',
    '',
    hasOnnx
      ? '当前状态：已就绪（本文件为降级说明模板，实际 ONNX 权重已存在，可删除本文件）。'
      : '当前状态：**模型资产缺失** —— `model_quantized.onnx` 未就绪。',
    '',
    '## 影响',
    '',
    '运行时将自动降级为 **BM25 相似度检索**，界面标注「相似度检索（非语义）」。',
    '',
    '## 补救方法（任选其一）',
    '',
    '1. 联网后重新运行 `node scripts/embedding-model.mjs` 重新下载 ONNX 量化权重。',
    '2. 手动从官方仓库下载并置于本目录的 `onnx/` 子目录：',
    '   `https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx`',
    '   （若无法直连 huggingface.co，可用镜像：',
    '   `https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx`）',
    '   下载后确保文件位于 `onnx/model_quantized.onnx`（transformers.js 固定从 onnx/ 子目录加载），',
    '   再运行一次脚本以重建 manifest。',
    '3. 若继续无网络，保持当前状态即可：插件会在加载模型失败时自动降级 BM25，',
    '   不会因缺失模型而启动失败。',
    '',
  ]
  await fs.writeFile(path.join(TARGET_DIR, README_FALLBACK), lines.join('\n'), 'utf8')
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const report = { copied: [], onnx: null, fallbackWritten: false, ready: false }

  // 0) 防御：确认源码目录未被误当作可复制权重源（列出并避免黑名单项进入）。
  //    （此处不做硬校验阻断——实际复制只取 TEXT_FILES_TO_COPY 白名单，天然免疫权重误入。）

  // 1) 复制纯文本配置。
  const textResults = await copyTextConfigs()
  // 2) 生成/复制 1_Pooling/config.json。
  const poolingResult = await ensurePoolingConfig()

  // 3) manifest 幂等预检：若已有 manifest 且磁盘受管文件与其完全一致，则跳过后续操作。
  const existingManifest = await readManifest()
  if (existingManifest) {
    const onDiskNow = await computeManagedFiles()
    if (await manifestMatches(existingManifest, onDiskNow)) {
      // 全一致 → 资产已就绪，无需下载；直接进入最终报告。
      const hasOnnx = Object.prototype.hasOwnProperty.call(onDiskNow, ONNX_TARGET_REL)
      if (hasOnnx) {
        console.log('资产已就绪（manifest 校验一致，跳过复制与下载）')
      } else {
        // manifest 一致但缺少 ONNX —— 属于"已声明降级"状态，重新写降级 README 以防丢失。
        await writeFallbackReadme(onDiskNow)
        report.fallbackWritten = true
        console.log('资产已就绪（降级态：ONNX 缺失，manifest 一致，已写降级说明）')
      }
      report.ready = true
      report.onnx = hasOnnx
        ? { ok: true, name: ONNX_TARGET_REL, bytes: onDiskNow[ONNX_TARGET_REL].bytes, url: null, skipped: true }
        : null
      return report
    }
    // manifest 不一致 → 继续执行下载/重算，重建 manifest（覆盖旧的不一致记录）。
  }

  // 4) ONNX 权重获取（幂等：已存在且大小合法则跳过）。
  const onnxResult = await fetchOnnxIfNeeded()
  report.onnx = onnxResult
  if (!onnxResult.ok) {
    // 下载失败：写降级说明，退出码 0（产品级降级路径）。
    const onDiskAfter = await computeManagedFiles()
    await writeFallbackReadme(onDiskAfter)
    report.fallbackWritten = true
    // 仍需写 manifest（记录当前可用的文本资产），使幂等校验在降级态下也成立。
  }

  // 5) 重建 manifest.json（version/source + files{bytes,sha256}）。
  const managed = await computeManagedFiles()
  // onnxSourceUrl 优先级：本次实际成功 URL > 既有 manifest 记录的来源 > 规范来源（ONNX 已存在但跳过下载时）。
  const hasOnnx = Object.prototype.hasOwnProperty.call(managed, ONNX_TARGET_REL)
  const onnxSourceUrl = onnxResult.ok && onnxResult.url
    ? onnxResult.url
    : (existingManifest && existingManifest.onnxSourceUrl)
      ? existingManifest.onnxSourceUrl
      : hasOnnx
        ? ONNX_CANONICAL_SOURCE_URL
        : null
  const manifest = {
    version: 1,
    source: 'D:\\AiCoding-Gzx\\models\\backend\\models\\bge-small-zh-v1.5（tokenizer/配置）+ Xenova/bge-small-zh-v1.5 onnx/model_quantized.onnx（量化权重）',
    onnxSourceUrl,
    files: {},
  }
  for (const rel of Object.keys(managed).sort()) {
    manifest.files[rel] = managed[rel]
  }
  await fs.writeFile(
    path.join(TARGET_DIR, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )

  // 6) 汇总报告。
  report.ready = manifestMatches({ files: manifest.files }, await computeManagedFiles())
  for (const r of textResults) if (r.copied) report.copied.push(r.name)
  if (poolingResult.copied) report.copied.push(poolingResult.name)

  return report
}

// 直接以脚本方式运行时的入口。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((report) => {
      const onnxOk = report.onnx && report.onnx.ok
      console.log('========== embedding-model 结果 ==========')
      console.log(`复制文件：${report.copied.length ? report.copied.join(', ') : '(均已存在，跳过)'}`)
      if (onnxOk) {
        console.log(`ONNX 权重：${report.onnx.bytes} 字节${report.onnx.url ? `（来源：${report.onnx.url}）` : '（跳过下载）'}`)
      } else {
        console.log('ONNX 权重：未就绪（已写入降级说明 README.zh.md，运行时降级 BM25 检索）')
      }
      console.log(`manifest：${report.ready ? '已就绪' : '已重建'}`)
    })
    .catch((err) => {
      console.error('[embedding-model] 脚本异常：', err)
      process.exitCode = 1
    })
}

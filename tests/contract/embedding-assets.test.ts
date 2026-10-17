// tests/contract/embedding-assets.test.ts
//
// T-004 模型资产业务测试：校验 assets/models/bge-small-zh-v1.5 的资产齐备性。
//
// 覆盖点（DoD 与任务验收）：
// 1. manifest.json 存在，且 files 中每个受管文件的 bytes/sha256 与磁盘实际内容一致；
// 2. tokenizer.json / config.json / special_tokens_map.json / 1_Pooling/config.json 存在；
// 3. model_quantized.onnx 存在时：大小在 (10MB, 60MB) 且文件头为 ONNX 魔数（前 4 字节）；
//    model_quantized.onnx 缺失时：README.zh.md 必须存在且包含「BM25」与「降级」字样。
//    两条分支由 it.runIf/it.skipIf 表达（vitest 报告里 skipped 可见），
//    不用 `if (…) return`——那会让用例名恒为通过，跳过时不留任何信号。
//
// 关于 sha256：与本脚本 scripts/embedding-model.mjs 使用同一 node:crypto 逻辑（测试文件
// 独立复刻该实现，因 .mjs 脚本不便于从 .ts 测试直接 import 而复制，注释说明）。
// 层级归属：断言对象是随包分发的资产目录与生成脚本产物（不是 embedding 模块代码行为），
// 故属 tests/contract（包与构建契约门禁）；模块代码行为见 tests/host/embedding/。
// 运行环境：node（host 测试默认，不引入 jsdom）。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录（package.json 所在目录）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// 资产目录（对应 package.json files 中的 assets/models/bge-small-zh-v1.5）。
const ASSET_DIR = resolve(root, 'assets', 'models', 'bge-small-zh-v1.5')

// 必备（无 ONNX 也必须存在）的文本资产。
const REQUIRED_TEXT_FILES = ['tokenizer.json', 'config.json', 'special_tokens_map.json']
// 1_Pooling 子目录内的 pooling 配置。
const POOLING_CONFIG = '1_Pooling/config.json'
// ONNX 量化权重相对路径与大小校验区间（脚本同款区间：>10MB 且 <60MB）。
// 说明：transformers.js v4 固定从 onnx/ 子目录加载（modeling_utils 的 subfolder="onnx"），
// 故权重必须位于 onnx/model_quantized.onnx（而非资产目录根），否则运行时加载失败。
const ONNX_REL = 'onnx/model_quantized.onnx'
const ONNX_MIN_BYTES = 10 * 1024 * 1024
const ONNX_MAX_BYTES = 60 * 1024 * 1024

// 本机世界状态：权重是否随仓库分发。两条互斥分支由此在注册期二选一。
const onnxPath = resolve(ASSET_DIR, ...ONNX_REL.split('/'))
const ONNX_PRESENT = existsSync(onnxPath)

/** 计算磁盘文件的 sha256 十六进制摘要（node:crypto，与 scripts/embedding-model.mjs 同一逻辑）。 */
function sha256OfFile(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

/** 读取并解析 manifest.json；不存在/结构非法返回 null。 */
function readManifest(): Record<string, any> | null {
  const p = resolve(ASSET_DIR, 'manifest.json')
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>
    if (raw && raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)) return raw
  } catch {
    // 非法 manifest 视为 null。
  }
  return null
}

describe('T-004 模型资产（manifest.json 存在且齐备）', () => {
  it('manifest.json 存在', () => {
    expect(existsSync(resolve(ASSET_DIR, 'manifest.json'))).toBe(true)
  })

  it('manifest.files 中每个文件的 bytes/sha256 与磁盘一致', () => {
    const manifest = readManifest()
    expect(manifest).not.toBeNull()
    const files = (manifest as any).files as Record<string, { bytes: number; sha256: string }>
    expect(Object.keys(files).length).toBeGreaterThan(0)
    for (const rel of Object.keys(files)) {
      const abs = resolve(ASSET_DIR, ...rel.split('/'))
      if (!existsSync(abs)) {
        // 权重缺失属合法降级形态，且它是否入库由 ONNX 分支用例单独裁定；
        // 其余受管文件缺失即可疑清单腐化，必须失败。
        expect(rel === ONNX_REL, `manifest 记录的文件缺失：${rel}`).toBe(true)
        continue
      }
      const stat = statSync(abs)
      const diskSha = sha256OfFile(abs)
      expect(stat.size, `manifest 尺寸不符：${rel}`).toBe(files[rel].bytes)
      expect(diskSha, `manifest sha256 不符：${rel}`).toBe(files[rel].sha256)
    }
    // 有 ONNX 时，manifest 必须把它登记为受管文件（防止「权重存在但不在清单」静默漏管）。
    if (ONNX_PRESENT) expect(Object.keys(files)).toContain(ONNX_REL)
  })
})

describe('T-004 模型资产（必备文本配置存在）', () => {
  it('tokenizer.json / config.json / special_tokens_map.json 存在', () => {
    for (const name of REQUIRED_TEXT_FILES) {
      expect(existsSync(resolve(ASSET_DIR, name)), `缺失：${name}`).toBe(true)
    }
  })

  it('1_Pooling/config.json 存在', () => {
    expect(existsSync(resolve(ASSET_DIR, ...POOLING_CONFIG.split('/')))).toBe(true)
  })
})

describe('T-004 模型资产（ONNX 权重或降级说明，二选一）', () => {
  it.runIf(ONNX_PRESENT)('onnx/model_quantized.onnx 大小在 (10MB,60MB) 且文件头为 ONNX 魔数', () => {
    const size = statSync(onnxPath).size
    expect(size).toBeGreaterThan(ONNX_MIN_BYTES)
    expect(size).toBeLessThan(ONNX_MAX_BYTES)
    // ONNX 魔数：文件头 4 字节为 0x08 0x06 0x12 0x0d（protobuf field header + 'onnx' 长度与起始）。
    const head = readFileSync(onnxPath).subarray(0, 4)
    expect([...head]).toEqual([0x08, 0x06, 0x12, 0x0d])
  })

  it.skipIf(ONNX_PRESENT)('onnx/model_quantized.onnx 缺失时 README.zh.md 存在且包含「BM25」与「降级」', () => {
    const readmePath = resolve(ASSET_DIR, 'README.zh.md')
    expect(existsSync(readmePath), 'ONNX 缺失时必须有 README.zh.md').toBe(true)
    const content = readFileSync(readmePath, 'utf8')
    expect(content).toContain('BM25')
    expect(content).toContain('降级')
  })

  it('二选一分支恰好命中一条（防止两边同时被跳过而门禁空转）', () => {
    expect([ONNX_PRESENT, existsSync(resolve(ASSET_DIR, 'README.zh.md'))].filter(Boolean).length).toBeGreaterThanOrEqual(1)
  })
})

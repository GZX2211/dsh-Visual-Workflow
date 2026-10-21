// tests/host/builtin-templates/install.test.ts
//
// 内置预设模板播种：中英种子内容门禁、按界面语言选择、首次写入、幂等、
// 不覆盖用户修改、删除后不复活（标记驱动）、老用户已有同 id 模板时的兼容、坏标记不误播种。

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FlowStore } from '../../../src/host/storage/flow-store.js'
import { validateFlow } from '../../../src/host/graph/index.js'
import {
  BUILTIN_FLOW_DESIGN_GUIDE_ID,
  BUILTIN_FLOW_TEMPLATES_EN,
  BUILTIN_FLOW_TEMPLATES_ZH,
  builtinFlowTemplatesFor,
  installBuiltinFlowTemplates,
} from '../../../src/host/builtin-templates/install.js'
import type { WorkflowTemplate } from '../../../src/host/shared/graph-model.js'

const dirs: string[] = []

afterEach(async () => {
  // 逆序清理：先释放后创建的 store 对应目录，避免 Windows 上的占用残留。
  for (const dir of dirs.splice(0).reverse()) await rm(dir, { recursive: true, force: true })
})

/** 建一个已完成目录初始化的真实 FlowStore（隔离的临时数据目录）。 */
async function freshStore(): Promise<{ store: FlowStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-builtin-'))
  dirs.push(dir)
  const store = new FlowStore(dir)
  await store.init()
  return { store, dir }
}

/** 按 id 取种子（缺失即测试数据损坏，直接失败）。 */
function seedOf(templates: readonly WorkflowTemplate[], templateId: string): WorkflowTemplate {
  const found = templates.find((template) => template.id === templateId)
  if (!found) throw new Error(`内置模板种子不存在：${templateId}`)
  return found
}

/** 判断字符串是否含中文字符（英文种子不得含中文，阶段规范值除外）。 */
const CJK = /[\u3400-\u9fff]/

/**
 * 阶段节点的 label 是存储规范值（graph/model.ts 的 stageLabel 硬编码中文），
 * 英文界面由客户端按词典本地化显示；因此英文种子允许且仅允许这三个中文值。
 */
const STAGE_LABELS = new Set(['启动', '结束', '暂停'])

/** 递归收集值中所有含中文的字符串。 */
function cjkTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (CJK.test(value)) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) cjkTexts(item, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) cjkTexts(item, out)
    return out
  }
  return out
}

/** 英文种子中不允许出现的中文（阶段规范值之外的任何中文都算漏译）。 */
function unexpectedCjk(value: unknown): string[] {
  return cjkTexts(value).filter((text) => !STAGE_LABELS.has(text))
}

/** 文本字段（中英版本应只在这些字段上不同；其余字段必须逐字段一致）。 */
const TEXT_KEYS = ['label', 'systemPrompt', 'content', 'description', 'collabPrompt', 'inputSchema', 'outputSchema'] as const

/** 把全部可翻译文本替换为占位符，用于比对中英种子的结构与非文本字段。 */
function withoutText(template: WorkflowTemplate): unknown {
  const clone = JSON.parse(JSON.stringify(template)) as Record<string, unknown>
  clone.name = '<TEXT>'
  clone.description = '<TEXT>'
  for (const node of (clone.nodes ?? []) as Array<{ data?: Record<string, unknown> }>) {
    for (const key of TEXT_KEYS) {
      if (node.data && key in node.data) node.data[key] = '<TEXT>'
    }
  }
  for (const line of (clone.lines ?? []) as Array<{ condition?: { label?: unknown } }>) {
    if (line.condition) line.condition.label = '<TEXT>'
  }
  return clone
}

describe('内置预设模板种子内容（中文）', () => {
  it('固定 id 与名称，且通过图结构校验', () => {
    expect(BUILTIN_FLOW_DESIGN_GUIDE_ID).toBe('tpl-mvciz28k-jvzw9u')
    const seed = seedOf(BUILTIN_FLOW_TEMPLATES_ZH, BUILTIN_FLOW_DESIGN_GUIDE_ID)
    expect(seed.mode).toBe('mode1')
    expect(seed.name).toBe('流程设计指南（预设模版）')
    const validation = validateFlow(seed)
    expect(validation.ok).toBe(true)
    expect(validation.issues).toEqual([])
  })

  it('节点与连线完整随包分发（含团队/数据库/虚拟节点等指南要素）', () => {
    const seed = seedOf(BUILTIN_FLOW_TEMPLATES_ZH, BUILTIN_FLOW_DESIGN_GUIDE_ID)
    expect(seed.nodes).toHaveLength(31)
    expect(seed.lines).toHaveLength(32)
    const kinds = new Set(seed.nodes.map((node) => node.kind))
    for (const kind of ['start', 'end', 'pause', 'task', 'agent', 'group', 'database', 'proxy']) {
      expect(kinds, `种子缺少 ${kind} 节点`).toContain(kind)
    }
  })
})

describe('内置预设模板种子内容（英文）', () => {
  it('与中文版同 id、同结构，仅文本字段不同且不含中文字符', () => {
    const zhSeed = seedOf(BUILTIN_FLOW_TEMPLATES_ZH, BUILTIN_FLOW_DESIGN_GUIDE_ID)
    const enSeed = seedOf(BUILTIN_FLOW_TEMPLATES_EN, BUILTIN_FLOW_DESIGN_GUIDE_ID)

    expect(enSeed.id).toBe(BUILTIN_FLOW_DESIGN_GUIDE_ID)
    expect(enSeed.mode).toBe('mode1')
    expect(enSeed.name).toBe('Process Design Guide (Preset Template)')
    expect(enSeed.nodes).toHaveLength(31)
    expect(enSeed.lines).toHaveLength(32)
    expect(unexpectedCjk(enSeed)).toEqual([])

    // 文本字段之外（坐标/连线/成员引用/时间戳等）必须与中文版完全一致。
    expect(withoutText(enSeed)).toEqual(withoutText(zhSeed))
  })

  it('通过图结构校验', () => {
    const validation = validateFlow(seedOf(BUILTIN_FLOW_TEMPLATES_EN, BUILTIN_FLOW_DESIGN_GUIDE_ID))
    expect(validation.ok).toBe(true)
    expect(validation.issues).toEqual([])
  })
})

describe('内置预设模板语言选择', () => {
  it('中文界面选择中文种子，英文界面选择英文种子', () => {
    expect(builtinFlowTemplatesFor('中文')).toBe(BUILTIN_FLOW_TEMPLATES_ZH)
    expect(builtinFlowTemplatesFor('English')).toBe(BUILTIN_FLOW_TEMPLATES_EN)
    expect(builtinFlowTemplatesFor('en-US')).toBe(BUILTIN_FLOW_TEMPLATES_EN)
  })

  it('未识别/为空的语言回退中文（与 DEFAULT_SYSTEM_LANGUAGE 一致）', () => {
    expect(builtinFlowTemplatesFor('Español')).toBe(BUILTIN_FLOW_TEMPLATES_ZH)
    expect(builtinFlowTemplatesFor('')).toBe(BUILTIN_FLOW_TEMPLATES_ZH)
  })
})

describe('内置预设模板播种', () => {
  it('默认（未指定语言）播种中文版，落盘 revision 由存储层记账', async () => {
    const { store } = await freshStore()
    const installed = await installBuiltinFlowTemplates(store)
    expect(installed).toEqual([BUILTIN_FLOW_DESIGN_GUIDE_ID])

    const saved = await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)
    expect(saved).not.toBeNull()
    expect(saved).toMatchObject({
      id: BUILTIN_FLOW_DESIGN_GUIDE_ID,
      mode: 'mode1',
      name: '流程设计指南（预设模版）',
      revision: 1,
    })
    expect(saved!.nodes).toHaveLength(31)
    expect(saved!.lines).toHaveLength(32)
  })

  it('英文界面首次播种英文版', async () => {
    const { store } = await freshStore()
    await installBuiltinFlowTemplates(store, 'English')

    const saved = await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)
    expect(saved?.name).toBe('Process Design Guide (Preset Template)')
    expect(unexpectedCjk(saved)).toEqual([])
    expect(saved!.nodes).toHaveLength(31)
  })

  it('已播种后重复安装不重复写入（幂等）', async () => {
    const { store } = await freshStore()
    await installBuiltinFlowTemplates(store)
    expect(await installBuiltinFlowTemplates(store)).toEqual([])
    expect(await store.listFlowTemplates()).toHaveLength(1)
  })

  it('用户修改模板后重启不覆盖用户的修改（语言无关）', async () => {
    const { store } = await freshStore()
    await installBuiltinFlowTemplates(store)
    const saved = (await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID))!
    await store.saveFlowTemplate({ ...saved, name: '我改的名字' })

    expect(await installBuiltinFlowTemplates(store, 'English')).toEqual([])
    expect((await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID))!.name).toBe('我改的名字')
  })

  it('用户删除模板后再启动不复活（已播种标记仍然有效）', async () => {
    const { store } = await freshStore()
    await installBuiltinFlowTemplates(store, 'English')
    expect(await store.deleteFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)).toBe(true)

    expect(await installBuiltinFlowTemplates(store, 'English')).toEqual([])
    expect(await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)).toBeNull()
    expect(await store.listFlowTemplates()).toEqual([])
  })

  it('同 id 模板已存在但无播种标记（老用户数据）时不覆盖，并补记标记', async () => {
    const { store } = await freshStore()
    await store.saveFlowTemplate({ ...seedOf(BUILTIN_FLOW_TEMPLATES_ZH, BUILTIN_FLOW_DESIGN_GUIDE_ID), name: '老用户已有版本' })
    expect(await store.listAppliedBuiltinSeeds()).toEqual([])

    expect(await installBuiltinFlowTemplates(store, 'English')).toEqual([BUILTIN_FLOW_DESIGN_GUIDE_ID])
    expect((await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID))!.name).toBe('老用户已有版本')
    expect(await store.listAppliedBuiltinSeeds()).toEqual([BUILTIN_FLOW_DESIGN_GUIDE_ID])

    // 补记标记后删除：后续启动同样不复活（即使界面语言已切换）。
    await store.deleteFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)
    await installBuiltinFlowTemplates(store)
    expect(await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)).toBeNull()
  })

  it('播种标记损坏时显式失败且不写入模板（避免把已删除模板误判为未播种）', async () => {
    const { store, dir } = await freshStore()
    await writeFile(join(dir, 'builtin-seeds.json'), '{ 不是合法 JSON', 'utf8')

    await expect(installBuiltinFlowTemplates(store)).rejects.toThrow(/builtin-seeds\.json/)
    expect(await store.getFlowTemplate(BUILTIN_FLOW_DESIGN_GUIDE_ID)).toBeNull()
  })
})

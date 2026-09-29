// tests/client/components/sidebar/library-model.test.ts
//
// buildLibraryModel 单测：
//   ① P4 体验与沉淀：父代理模板卡 pinned=false，不再常驻 is-pinned 高亮；
//   ② 资产态分区（活跃资产 + 历史资产两栏；角色活跃栏不含内联资产）、
//      资产卡片 payload（工作流资产 → 打开画布文档；角色资产 → 属性栏 / 拖入画布）；
//   ③ 历史资产分栏的折叠语义（默认折叠、搜索不自动展开、历史卡片不可拖入画布）；
//   ④ 搜索过滤（名称 + 描述 / 角色提示词，大小写不敏感、trim）与空态文案。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——library-model 用例归入本文件。

import { describe, expect, it, vi } from 'vitest'
import { ASSET_HISTORY_SECTIONS, buildLibraryModel, type LibraryModelInput } from '../../../../src/client/components/sidebar/library-model.js'
import { zh } from '../../../../src/client/i18n.js'

/** builder 输入工厂（只覆盖被测字段，其余为最小缺省）。 */
function makeInput(partial: Partial<LibraryModelInput> = {}): LibraryModelInput {
  return {
    copy: zh,
    libTab: 'workflow',
    mode: 'mode1',
    workflows: [],
    currentSessionId: 's-1',
    flowTemplates: [],
    parentTemplate: null,
    roleTemplates: [],
    fileTemplates: [],
    databaseTemplates: [],
    groupTemplates: [],
    stageKinds: [],
    libSelection: null,
    modeName: () => '标准',
    onSelectWorkflow: () => {},
    onSelectFlowTemplate: () => {},
    onSelectLib: () => {},
    onPlaceTemplate: () => {},
    onPlaceTemplateIntoGroup: () => {},
    onPlaceStage: () => {},
    onPlaceGroup: () => {},
    onPlaceGroupFromTemplate: () => {},
    onPlaceParent: () => {},
    onCreateNew: () => {},
    ...partial,
  }
}

/** 资产态列表输入（活跃 + 历史；用例只给关心的那一段）。 */
function assetLists(
  active: { workflows?: Array<ReturnType<typeof workflowAsset>>; roles?: Array<ReturnType<typeof roleAsset>> } = {},
  retired: { workflows?: Array<ReturnType<typeof workflowAsset>>; roles?: Array<ReturnType<typeof roleAsset>> } = {},
): NonNullable<LibraryModelInput['assets']> {
  return {
    workflows: active.workflows ?? [],
    roles: active.roles ?? [],
    retiredWorkflows: retired.workflows ?? [],
    retiredRoles: retired.roles ?? [],
  }
}

function workflowAsset(assetId: string, name: string, description = ''): NonNullable<LibraryModelInput['assets']>['workflows'][number] {
  return { assetId, versionId: 1, name, description, updatedAt: 1 }
}

function roleAsset(
  assetId: string,
  name: string,
  kind: 'parent' | 'agent' = 'agent',
  roleAssetType: 'standalone' | 'inline' | 'shared' = 'standalone',
): NonNullable<LibraryModelInput['assets']>['roles'][number] {
  return { assetId, versionId: 2, name, kind, roleAssetType, updatedAt: 1 }
}
describe('P4 父模板卡高亮修复（buildLibraryModel）', () => {
  it('父代理模板卡 pinned=false（不再常驻 is-pinned 高亮）', () => {
    const model = buildLibraryModel(makeInput({
      libTab: 'role',
      parentTemplate: { id: 'tpl-parent', name: 'CEO' } as never,
    }))
    const parent = model.sections.find((section) => section.key === 'parent')
    expect(parent?.cards[0].pinned).toBe(false)
  })
})

describe('资产态分区（活跃资产 / 历史资产）', () => {
  it('工作流 Tag：活跃资产与历史资产两栏（不再区分实例 + 工作流模版）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      workflows: [{ id: 'flow-1', name: '实例一' }],
      flowTemplates: [{ id: 'tpl-1', name: '模版一' } as never],
      assets: assetLists(
        { workflows: [workflowAsset('a-1', '资产一', '描述一')] },
        { workflows: [workflowAsset('a-2', '归档资产')] },
      ),
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['assetWorkflows', ASSET_HISTORY_SECTIONS.workflow])
    const active = model.sections[0]
    expect(active.title).toBe(zh.assetActiveSection)
    expect(active.plus).toBe(false)
    expect(active.cards.map((card) => card.name)).toEqual(['资产一'])
    expect(active.cards[0].kind).toBe('flowAsset')
    const history = model.sections[1]
    expect(history.title).toBe(zh.assetHistorySection)
    expect(history.cards.map((card) => card.name)).toEqual(['归档资产'])
  })

  it('角色 Tag：活跃资产与历史资产两栏（不再分区父代理 / 角色模版）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      parentTemplate: { id: 'tpl-parent', name: 'CEO' } as never,
      roleTemplates: [{ id: 'r-1', name: '研究', systemPrompt: '' } as never],
      assets: assetLists(
        { roles: [roleAsset('a-r1', '资产角色'), roleAsset('a-r2', '资产父代理', 'parent')] },
        { roles: [roleAsset('a-r3', '归档角色')] },
      ),
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['assetRoles', ASSET_HISTORY_SECTIONS.role])
    expect(model.sections[0].title).toBe(zh.assetActiveSection)
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['资产角色', '资产父代理'])
    // 父代理资产副行标注父代理；普通资产副行标注资产种类
    expect(model.sections[0].cards[1].sub).toBe(zh.parentAgent)
    expect(model.sections[0].cards[0].sub).toBe(zh.roleAssetType.standalone)
    expect(model.sections[1].cards.map((card) => card.name)).toEqual(['归档角色'])
  })

  it('角色活跃栏不含内联资产（内联角色的编辑入口在画布节点上）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      assets: assetLists({
        roles: [
          roleAsset('a-standalone', '独立角色'),
          roleAsset('a-inline', '内联角色', 'agent', 'inline'),
          roleAsset('a-shared', '共享角色', 'agent', 'shared'),
        ],
      }),
    }))
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['独立角色', '共享角色'])
  })

  it('其他 Tag：无分区 + 整页空态提示（资产分类只含工作流 / 角色 / 经验）', () => {
    const model = buildLibraryModel(makeInput({ librarySource: 'asset', libTab: 'other' }))
    expect(model.sections).toEqual([])
    expect(model.emptyHint).toBe(zh.assetListNotSupported)
  })

  it('资产为空：活跃分区保留但卡片为空，空态文案为「资产只能由模版入库晋升」', () => {
    const model = buildLibraryModel(makeInput({ librarySource: 'asset', libTab: 'workflow', assets: assetLists() }))
    expect(model.sections[0].cards).toEqual([])
    expect(model.sections[0].emptyText).toBe(zh.assetEmptyHint)
    // 历史分栏：空态文案独立（不是「暂无资产」的误读）
    expect(model.sections[1].cards).toEqual([])
    expect(model.sections[1].emptyText).toBe(zh.assetHistoryEmpty)
  })

  it('模版态缺省（未传 librarySource）：保持既有实例 + 工作流模版两分区', () => {
    const model = buildLibraryModel(makeInput({
      workflows: [{ id: 'flow-1', name: '实例一' }],
      flowTemplates: [{ id: 'tpl-1', name: '模版一' } as never],
      assets: assetLists({ workflows: [workflowAsset('a-1', '资产一')] }),
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['instances', 'flowTemplates'])
  })
})

describe('资产态「数据」Tag 以「经验」呈现（用户批注）', () => {
  /** 经验条目（只给被测字段，其余为契约最小缺省）。 */
  function experience(
    id: string,
    taskContext: string,
    insight: string,
    active = true,
    taskType = '软件开发',
  ): NonNullable<LibraryModelInput['experiences']>[number] {
    return {
      id,
      active,
      reflectionPromptVersion: '1',
      taskType,
      taskContext,
      insight,
      createdAt: 1,
      updatedAt: 1,
    }
  }

  it('Tab 标签随库来源切换：资产态为「经验」，模版态仍是「数据」', () => {
    const assetTabs = buildLibraryModel(makeInput({ librarySource: 'asset', libTab: 'data' })).tabs
    const templateTabs = buildLibraryModel(makeInput({ librarySource: 'template', libTab: 'data' })).tabs
    expect(assetTabs.map((tab) => tab.label)).toEqual(['工作流', '角色', zh.libTabExperience, '其他'])
    expect(templateTabs.map((tab) => tab.label)).toEqual(['工作流', '角色', '数据', '其他'])
    // Tab key 不变：两态共用同一 key，只有标签与内容随来源切换
    expect(assetTabs.map((tab) => tab.key)).toEqual(['workflow', 'role', 'data', 'other'])
  })

  it('经验分栏：活跃 / 历史两栏，主行取任务上下文、副行取经验摘要', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'data',
      experiences: [
        experience('ex-1', '重构旧模块', '先补测试再重构', true),
        experience('ex-2', '归档的上下文', '已归档的经验', false),
      ],
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['assetExperiences', ASSET_HISTORY_SECTIONS.experience])
    expect(model.sections[0].title).toBe(zh.experienceActiveSection)
    expect(model.sections[0].plus).toBe(false)
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['重构旧模块'])
    expect(model.sections[0].cards[0].kind).toBe('experience')
    expect(model.sections[0].cards[0].sub).toBe('先补测试再重构')
    expect(model.sections[1].title).toBe(zh.experienceHistorySection)
    expect(model.sections[1].cards.map((card) => card.name)).toEqual(['归档的上下文'])
    expect(model.emptyHint).toBeNull()
  })

  it('经验没有画布形态：卡片无拖入回调，点击进属性栏', () => {
    const onOpenExperience = vi.fn()
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'data',
      experiences: [experience('ex-1', '上下文一', '经验一')],
      onOpenExperience,
    }))
    const payload = model.sections[0].cards[0].payload
    expect(payload.onDrop).toBeUndefined()
    expect(payload.onDropIntoGroup).toBeUndefined()
    payload.onClick()
    expect(onOpenExperience).toHaveBeenCalledWith('ex-1')
  })

  it('经验为空：两栏均保留并给出经验专属空态文案', () => {
    const model = buildLibraryModel(makeInput({ librarySource: 'asset', libTab: 'data' }))
    expect(model.sections[0].emptyText).toBe(zh.experienceEmptyHint)
    expect(model.sections[1].emptyText).toBe(zh.experienceHistoryEmpty)
    expect(model.emptyHint).toBeNull()
  })

  it('经验搜索：命中任务类型 / 上下文 / 经验本体 / 证据（大小写不敏感）', () => {
    const base = {
      librarySource: 'asset' as const,
      libTab: 'data' as const,
      experiences: [
        { ...experience('ex-1', '重构旧模块', '先补测试再重构', true, '软件开发'), evidence: '缺陷率下降' },
        experience('ex-2', '撰写文档', '先列提纲', true, '写作'),
      ],
    }
    expect(buildLibraryModel(makeInput({ ...base, libSearch: '写作' })).sections[0].cards.map((card) => card.id)).toEqual(['ex-2'])
    expect(buildLibraryModel(makeInput({ ...base, libSearch: '缺陷率' })).sections[0].cards.map((card) => card.id)).toEqual(['ex-1'])
    expect(buildLibraryModel(makeInput({ ...base, libSearch: '先补测试' })).sections[0].cards.map((card) => card.id)).toEqual(['ex-1'])
    expect(buildLibraryModel(makeInput({ ...base, libSearch: '软件开发' })).sections[0].cards.map((card) => card.id)).toEqual(['ex-1'])
    // 无命中：整页空态（分区被过滤掉）
    const empty = buildLibraryModel(makeInput({ ...base, libSearch: '不存在的关键词' }))
    expect(empty.sections).toEqual([])
    expect(empty.emptyHint).toBe(zh.searchNoResult)
  })

  it('模版态数据 Tag 仍是文件 + 数据库（经验不参与）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'template',
      libTab: 'data',
      experiences: [experience('ex-1', '上下文一', '经验一')],
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['files', 'databases'])
    expect(model.emptyHint).toBeNull()
  })
})

describe('历史资产分栏的折叠语义', () => {
  const historyInput = (collapsedSections?: readonly string[]): LibraryModelInput => makeInput({
    librarySource: 'asset',
    libTab: 'workflow',
    collapsedSections,
    assets: assetLists({ workflows: [workflowAsset('a-1', '资产一')] }, { workflows: [workflowAsset('a-2', '归档资产')] }),
  })

  it('未传折叠集：历史分栏可折叠但默认展开（折叠态由视图层持有）', () => {
    const history = buildLibraryModel(historyInput()).sections[1]
    expect(history.collapsible).toBe(true)
    expect(history.collapsed).toBe(false)
  })

  it('折叠集命中分栏 key：标记 collapsed（卡片仍在模型里，由视图决定是否渲染）', () => {
    const history = buildLibraryModel(historyInput([ASSET_HISTORY_SECTIONS.workflow])).sections[1]
    expect(history.collapsed).toBe(true)
    expect(history.cards.map((card) => card.name)).toEqual(['归档资产'])
  })

  it('搜索不自动展开折叠的历史分栏：过滤照常生效，折叠态保持', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      libSearch: '归档',
      collapsedSections: [ASSET_HISTORY_SECTIONS.workflow],
      assets: assetLists({ workflows: [workflowAsset('a-1', '资产一')] }, { workflows: [workflowAsset('a-2', '归档资产')] }),
    }))
    // 活跃栏无命中被过滤掉；历史栏有命中但保持折叠（命中数由视图层展示）
    expect(model.sections.map((section) => section.key)).toEqual([ASSET_HISTORY_SECTIONS.workflow])
    expect(model.sections[0].collapsed).toBe(true)
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['归档资产'])
  })
})

describe('资产卡片 payload（拖拽 / 打开）', () => {
  it('工作流资产：点击与拖入都打开资产文档（画布文档 = 资产）', () => {
    const onSelectFlowAsset = vi.fn()
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: assetLists({ workflows: [workflowAsset('a-1', '资产一')] }),
      onSelectFlowAsset,
    }))
    const payload = model.sections[0].cards[0].payload
    expect(payload.label).toBe('资产一')
    payload.onClick()
    payload.onDrop?.({ x: 10, y: 20 })
    expect(onSelectFlowAsset.mock.calls).toEqual([['a-1'], ['a-1']])
  })

  it('角色资产：点击进属性栏；拖入画布携带落点坐标', () => {
    const onOpenRoleAsset = vi.fn()
    const onPlaceRoleAsset = vi.fn()
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      assets: assetLists({ roles: [roleAsset('a-r1', '资产角色')] }),
      onOpenRoleAsset,
      onPlaceRoleAsset,
    }))
    const payload = model.sections[0].cards[0].payload
    payload.onClick()
    payload.onDrop?.({ x: 88, y: 99 })
    expect(onOpenRoleAsset).toHaveBeenCalledWith('a-r1')
    expect(onPlaceRoleAsset).toHaveBeenCalledWith('a-r1', { x: 88, y: 99 })
    // 落点缺省时使用默认格点（与模版拖入同口径）
    payload.onDrop?.()
    expect(onPlaceRoleAsset).toHaveBeenLastCalledWith('a-r1', { x: 120, y: 80 })
    // 角色资产不入组（V1 只支持拖到画布）
    expect(payload.onDropIntoGroup).toBeUndefined()
  })

  it('历史资产：可点击打开，但不可拖入画布（拖入等于让归档资产重回编排）', () => {
    const onOpenRoleAsset = vi.fn()
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      assets: assetLists({}, { roles: [roleAsset('a-r9', '归档角色')] }),
      onOpenRoleAsset,
    }))
    const payload = model.sections[1].cards[0].payload
    expect(payload.onDrop).toBeUndefined()
    payload.onClick()
    expect(onOpenRoleAsset).toHaveBeenCalledWith('a-r9')
  })
})

describe('库搜索过滤（两态共用同一关键词）', () => {
  const roleTemplates = [
    { id: 'r-1', name: '研究员', systemPrompt: '负责调研与归档' },
    { id: 'r-2', name: 'Writer', systemPrompt: '负责写稿' },
  ] as never

  it('模版态：名称 + 描述命中（大小写不敏感、首尾空白忽略）', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '  writer  ',
      libTab: 'role',
      roleTemplates,
    }))
    const cards = model.sections.flatMap((section) => section.cards)
    expect(cards.map((card) => card.name)).toEqual(['Writer'])
  })

  it('模版态：角色提示词命中（角色 System Prompt 属可搜索字段）', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '归档',
      libTab: 'role',
      roleTemplates,
    }))
    expect(model.sections.flatMap((section) => section.cards).map((card) => card.name)).toEqual(['研究员'])
  })

  it('模版态：过滤实例列表与工作流模版列表（全部分区）', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '甲',
      workflows: [{ id: 'flow-1', name: '甲方流程', description: '' }, { id: 'flow-2', name: '乙方流程' }],
      flowTemplates: [{ id: 'tpl-1', name: '模板甲', description: '' }, { id: 'tpl-2', name: '模板乙' }] as never,
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['instances', 'flowTemplates'])
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['甲方流程'])
    expect(model.sections[1].cards.map((card) => card.name)).toEqual(['模板甲'])
  })

  it('资产态：按资产名称过滤；角色资产命中', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      libSearch: '资',
      assets: assetLists({ workflows: [workflowAsset('a-1', '资产一'), workflowAsset('a-2', '别的')] }),
    }))
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['资产一'])
  })

  it('资产态角色：搜索命中职责摘要（summary = 提示词前 60 字）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      libSearch: '归档',
      assets: assetLists({
        roles: [
          { ...roleAsset('a-r1', '资产角色'), summary: '负责调研与归档' },
          { ...roleAsset('a-r2', '另一个角色'), summary: '负责写稿' },
        ],
      }),
    }))
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['资产角色'])
  })

  it('资产态角色：名称与摘要都不命中 → 整页无结果空态', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      libSearch: '不存在的关键词',
      assets: assetLists({ roles: [{ ...roleAsset('a-r1', '资产角色'), summary: '负责调研与归档' }] }),
    }))
    expect(model.sections).toEqual([])
    expect(model.emptyHint).toBe(zh.searchNoResult)
  })

  it('搜索无命中：整页空态为「没有匹配的条目」，且不残留空分区', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '不存在的关键词',
      workflows: [{ id: 'flow-1', name: '甲方流程' }],
      flowTemplates: [{ id: 'tpl-1', name: '模板甲' } as never],
    }))
    expect(model.emptyHint).toBe(zh.searchNoResult)
    expect(model.sections).toEqual([])
  })

  it('空关键词（含全空白）不过滤：分区与卡片保持原样、无整页空态', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '   ',
      workflows: [{ id: 'flow-1', name: '甲方流程' }],
      flowTemplates: [{ id: 'tpl-1', name: '模板甲' } as never],
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['instances', 'flowTemplates'])
    expect(model.emptyHint).toBeNull()
  })
})


// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/panels.test.tsx
//
// Inspector 装配层单测（D-20）：模板来源的父代理渲染属性表单（含 preset 下拉），
// 不再显示「父代理模板无独立属性」空态；画布父代理节点同样可编辑。
//
// 底部按钮分录（用户裁决）：
//   模版态（工作流模版 / 角色模版）= 保存 + 删除 + 入库（其余模版无入库）；
//   资产态（flowAsset / roleAsset）= 保存 + 删除 + 回滚（无入库、无另存为模板/复制）；
//   实例/服务/节点/连线保持改造前分录。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Inspector } from '../../../../../src/client/components/panels/inspector/Inspector.js'
import { zh } from '../../../../../src/client/i18n.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
})

const presets = [{ id: 'standard', name: '标准' }, { id: 'minimal', name: '极简' }]
const models = [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: 'High' }] }]
const combos = [{ id: 'combo-a', name: '团队模式', tools: ['wf_ask'], mcpServers: [] }]

async function render(element: React.ReactElement): Promise<void> {
  // 同一用例内多次 render（分录参数化断言）时必须先卸载旧根，否则容器里残留两份界面
  if (root) {
    act(() => { root!.unmount() })
    root = null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

/** 底部按钮文案序列（分录断言口径）。 */
function footerLabels(): string[] {
  return Array.from(container!.querySelectorAll('.wf-inspector__footer button')).map((item) => item.textContent ?? '')
}

/** 按文案取底部按钮。 */
function footerButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-inspector__footer button'))
    .find((item) => item.textContent === label)
}

describe('P4 父代理模板可编辑（Inspector，D-20）', () => {
  const common = {
    copy: zh,
    open: true,
    width: 320,
    presets,
    tools: [],
    models,
    combos,
    flowMeta: { nodeCount: 0, revision: 0 },
    onPatch: () => {},
    onDelete: () => {},
    onSave: () => {},
    onCopyProxy: () => {},
    onRemoveMember: () => {},
    onFileSelect: () => {},
    onLoadMd: () => {},
    onLoadGroupMd: () => {},
    onTestDb: () => {},
    saveDisabled: false,
    importBusy: false,
  }

  it('模板来源的父代理：渲染属性表单（含 preset 下拉），不再显示「无独立属性」空态', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { presetId: 'standard', label: 'CEO' }, name: 'CEO', isParent: true, template: true } as never,
    } as never))
    const text = container!.textContent ?? ''
    expect(text).not.toContain('父代理模板无独立属性')
    expect(text).toContain(zh.nodeKinds.parent)
    expect(container!.querySelectorAll('select').length).toBeGreaterThan(0)
  })

  it('画布父代理节点同样可编辑（isParent 且非模板）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { presetId: 'standard', label: 'CEO' }, name: 'CEO', isParent: true, nodeId: 'n-p1' } as never,
    } as never))
    expect(container!.textContent).not.toContain('父代理模板无独立属性')
    expect(container!.querySelectorAll('select').length).toBeGreaterThan(0)
  })

  it('阶段节点：不渲染保存按钮（只读属性）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'stage', data: { label: '启动' }, name: '启动', nodeId: 's-1' } as never,
    } as never))
    const labels = Array.from(container!.querySelectorAll('button')).map((item) => item.textContent)
    expect(labels).not.toContain(zh.inspectorSave)
    expect(labels).toContain(zh.inspectorDelete)
  })
})

describe('Inspector 底部按钮分录（模版态 / 资产态）', () => {
  const common = {
    copy: zh,
    open: true,
    width: 320,
    presets, tools: [], models, combos,
    flowMeta: { nodeCount: 0, revision: 0 },
    onPatch: () => {}, onDelete: () => {}, onSave: () => {},
    onPromote: () => {}, onOpenVersions: () => {}, onRollbackVersion: () => {}, onCloseVersions: () => {},
    onSaveAsTemplate: () => {},
    onCopyProxy: () => {}, onRemoveMember: () => {}, onFileSelect: () => {},
    onLoadMd: () => {}, onLoadGroupMd: () => {}, onTestDb: () => {},
    saveDisabled: false, importBusy: false,
  }

  it('工作流模版：保存 + 删除 + 入库（无回滚）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'workflow', data: { name: '模版一' }, name: '模版一', template: true, templateId: 'tpl-1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete, zh.assetPromote])
  })

  it('角色模版：保存 + 删除 + 入库（无回滚）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { name: '角色模版' }, name: '角色模版', template: true, templateId: 'r-1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete, zh.assetPromote])
  })

  it('文件 / 数据库 / 协作组模板：只有保存 + 删除（不显示入库）', async () => {
    for (const kind of ['file', 'database', 'group'] as const) {
      await render(React.createElement(Inspector, {
        ...common,
        editorData: { kind, data: { name: '模板' }, name: '模板', template: true, templateId: 't-1' } as never,
      } as never))
      expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete])
    }
  })

  it('工作流资产（flowAsset）：保存 + 归档 + 回滚（无入库、无另存为模板）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'workflow', data: { name: '资产一' }, name: '资产一', asset: true, assetId: 'a-1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.assetArchive, zh.assetRollback])
  })

  it('角色资产（roleAsset）：保存 + 归档 + 回滚（无复制按钮）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { name: '资产角色' }, name: '资产角色', roleAsset: true, assetId: 'a-r1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.assetArchive, zh.assetRollback])
  })

  it('历史（已归档）资产：状态按钮变为可点的「恢复」，且不再提供回滚入口', async () => {
    for (const editorData of [
      { kind: 'workflow', data: { name: '归档流程' }, name: '归档流程', asset: true, assetId: 'a-old', retired: true },
      { kind: 'role', data: { name: '归档角色' }, name: '归档角色', roleAsset: true, assetId: 'a-rold', retired: true },
    ] as const) {
      await render(React.createElement(Inspector, {
        ...common,
        editorData: editorData as never,
      } as never))
      // 归档只生效一次：历史资产的状态按钮翻转为「恢复」（可点、非危险色、带恢复语义说明）
      const restore = footerButton(zh.assetRestore)
      expect(restore?.disabled).toBe(false)
      expect(restore?.getAttribute('title')).toBe(zh.assetRestoreHint)
      expect(restore?.classList.contains('is-danger')).toBe(false)
      // 恢复后再回滚：历史资产本身不给回滚入口（职责分离）
      expect(footerLabels()).toEqual([zh.inspectorSave, zh.assetRestore])
    }
  })

  it('经验（活跃 / 已归档）：只有保存 + 归档（或恢复），没有回滚与入库', async () => {
    const entry = { id: 'ex-1', active: true, taskType: '软件开发', taskContext: '上下文', insight: '经验一', createdAt: 1, updatedAt: 1 }
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'experience', data: entry, name: entry.taskContext, experience: true, experienceId: 'ex-1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.assetArchive])
    expect(footerButton(zh.assetArchive)?.getAttribute('title')).toBe(zh.experienceArchiveHint)
    expect(footerLabels()).not.toContain(zh.assetRollback)

    await render(React.createElement(Inspector, {
      ...common,
      editorData: {
        kind: 'experience',
        data: { ...entry, active: false },
        name: entry.taskContext,
        experience: true,
        experienceId: 'ex-1',
        retired: true,
      } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.assetRestore])
    expect(footerButton(zh.assetRestore)?.getAttribute('title')).toBe(zh.experienceRestoreHint)
  })

  it('经验表单：五个可编辑字段自上而下 + 只读元信息', async () => {
    const entry = {
      id: 'ex-1',
      active: true,
      sourceRunId: 'run-9',
      taskType: '软件开发',
      taskContext: '上下文一',
      insight: '经验一',
      evidence: '证据一',
      reviewFeedback: '审核意见一',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    }
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'experience', data: entry, name: entry.taskContext, experience: true, experienceId: 'ex-1' } as never,
    } as never))
    const labels = Array.from(document.querySelectorAll('.wf-field .wf-hint')).map((node) => node.textContent)
    expect(labels.slice(0, 5)).toEqual([
      zh.experienceTaskType, zh.experienceTaskContext, zh.experienceInsight, zh.experienceEvidence, zh.experienceReviewFeedback,
    ])
    const readonlyText = Array.from(document.querySelectorAll('.wf-form-stack .wf-hint')).map((node) => node.textContent).join('\n')
    expect(readonlyText).toContain(`${zh.experienceIdLabel}：ex-1`)
    expect(readonlyText).toContain(`${zh.experienceSourceRun}：run-9`)
    expect(readonlyText).toContain(zh.experienceCreatedAt)
    expect(readonlyText).toContain(zh.experienceUpdatedAt)
  })

  it('画布角色节点：绑定来源资产时多出回滚按钮（与左侧栏角色资产一致）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: {
        kind: 'role', data: { label: '子代理' }, name: '子代理', nodeId: 'n-1', sourceAssetId: 'a-r1',
      } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete, zh.assetRollback, zh.inspectorCopy])
  })

  it('画布角色节点：未绑定来源资产（从模版/实例拖入）不显示回滚按钮', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { label: '子代理' }, name: '子代理', nodeId: 'n-1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete, zh.inspectorCopy])
  })

  it('入库锁定：按钮禁用且 title 说明「已入库，模版未再修改」', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      promoteLocked: true,
      editorData: { kind: 'workflow', data: { name: '模版一' }, name: '模版一', template: true, templateId: 'tpl-1' } as never,
    } as never))
    const promote = footerButton(zh.assetPromote)
    expect(promote?.disabled).toBe(true)
    expect(promote?.getAttribute('title')).toBe(zh.assetPromoteLockedHint)
  })

  it('入库未锁定：按钮可点，title 说明入库语义', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      promoteLocked: false,
      editorData: { kind: 'workflow', data: { name: '模版一' }, name: '模版一', template: true, templateId: 'tpl-1' } as never,
    } as never))
    const promote = footerButton(zh.assetPromote)
    expect(promote?.disabled).toBe(false)
    expect(promote?.getAttribute('title')).toBe(zh.assetPromoteHint)
  })

  it('实例 / 服务：保存 + 删除 + 另存为模板（回归）', async () => {
    for (const kind of ['workflow', 'service'] as const) {
      await render(React.createElement(Inspector, {
        ...common,
        editorData: { kind, data: { name: '实例' }, name: '实例' } as never,
      } as never))
      expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete, zh.saveAsTemplate])
    }
  })

  it('画布角色节点：保存 + 删除 + 复制（回归）；连线：保存 + 删除（回归）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { label: '子代理' }, name: '子代理', nodeId: 'n-1' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete, zh.inspectorCopy])

    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'edge', data: {}, name: '' } as never,
    } as never))
    expect(footerLabels()).toEqual([zh.inspectorSave, zh.inspectorDelete])
  })
})

describe('Inspector 资产版本上拉列表接线（回滚入口）', () => {
  const common = {
    copy: zh,
    open: true,
    width: 320,
    presets, tools: [], models, combos,
    flowMeta: { nodeCount: 0, revision: 0 },
    onPatch: () => {}, onDelete: () => {}, onSave: () => {},
    onPromote: () => {}, onOpenVersions: () => {}, onRollbackVersion: () => {}, onCloseVersions: () => {},
    onSaveAsTemplate: () => {},
    onCopyProxy: () => {}, onRemoveMember: () => {}, onFileSelect: () => {},
    onLoadMd: () => {}, onLoadGroupMd: () => {}, onTestDb: () => {},
    saveDisabled: false, importBusy: false,
  }
  const flowAsset = { kind: 'workflow', data: { name: '资产一' }, name: '资产一', asset: true, assetId: 'a-1' } as never

  it('点击回滚：请求打开版本列表；装载完成前显示加载中文案', async () => {
    const onOpenVersions = vi.fn()
    await render(React.createElement(Inspector, {
      ...common, onOpenVersions, assetVersions: null, editorData: flowAsset,
    } as never))

    act(() => { footerButton(zh.assetRollback)!.click() })

    expect(onOpenVersions).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('.wf-asset-versions')).not.toBeNull()
    expect(container!.querySelector('.wf-asset-versions__hint')?.textContent).toBe(zh.assetVersionsLoading)
  })

  it('点击版本条目：回滚该版本并收起列表；不出现二次确认弹层', async () => {
    const onRollbackVersion = vi.fn()
    const versions = {
      kind: 'workflow' as const, assetId: 'a-1',
      items: [
        { versionId: 2, rowId: 'a-1@2', name: 'v2', createdAt: 2, source: 'human' as const, active: true },
        { versionId: 1, rowId: 'a-1@1', name: 'v1', createdAt: 1, source: 'agent' as const, active: false },
      ],
    }
    await render(React.createElement(Inspector, {
      ...common, onRollbackVersion, assetVersions: versions, editorData: flowAsset,
    } as never))

    act(() => { footerButton(zh.assetRollback)!.click() })
    const items = Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-asset-versions__item'))
    expect(items).toHaveLength(2)

    act(() => { items[1]!.click() })

    expect(onRollbackVersion).toHaveBeenCalledWith(1)
    expect(container!.querySelector('.wf-asset-versions')).toBeNull()
    // 回滚不弹二次确认（确认弹层由 Studio 装配的 ConfirmDialog 承担，Inspector 不渲染）
    expect(container!.querySelector('.wf-confirm')).toBeNull()
  })

  it('再次点击回滚 / 点关闭：收起列表并清空版本数据面', async () => {
    const onCloseVersions = vi.fn()
    const versions = {
      kind: 'role' as const, assetId: 'a-r1',
      items: [{ versionId: 1, rowId: 'a-r1@1', name: 'v1', createdAt: 1, source: 'human' as const, active: true }],
    }
    await render(React.createElement(Inspector, {
      ...common, onCloseVersions, assetVersions: versions,
      editorData: { kind: 'role', data: { name: '资产角色' }, name: '资产角色', roleAsset: true, assetId: 'a-r1' } as never,
    } as never))

    act(() => { footerButton(zh.assetRollback)!.click() })
    expect(container!.querySelector('.wf-asset-versions')).not.toBeNull()

    act(() => { footerButton(zh.assetRollback)!.click() })
    expect(container!.querySelector('.wf-asset-versions')).toBeNull()
    expect(onCloseVersions).toHaveBeenCalledTimes(1)

    act(() => { footerButton(zh.assetRollback)!.click() })
    const close = Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-asset-versions button'))
      .find((item) => item.textContent === zh.assetVersionsClose)
    act(() => { close!.click() })
    expect(container!.querySelector('.wf-asset-versions')).toBeNull()
    expect(onCloseVersions).toHaveBeenCalledTimes(2)
  })

  it('编辑器切到别的资产：版本列表自动收起（不展示上一个资产的版本）', async () => {
    const versions = {
      kind: 'workflow' as const, assetId: 'a-1',
      items: [{ versionId: 1, rowId: 'a-1@1', name: 'v1', createdAt: 1, source: 'human' as const, active: true }],
    }
    await render(React.createElement(Inspector, { ...common, assetVersions: versions, editorData: flowAsset } as never))
    act(() => { footerButton(zh.assetRollback)!.click() })
    expect(container!.querySelector('.wf-asset-versions')).not.toBeNull()

    // 同一实例换入另一个资产的编辑数据（未卸载重挂）
    await act(async () => {
      root!.render(React.createElement(Inspector, {
        ...common,
        assetVersions: versions,
        editorData: { kind: 'workflow', data: { name: '资产二' }, name: '资产二', asset: true, assetId: 'a-2' } as never,
      } as never))
    })

    expect(container!.querySelector('.wf-asset-versions')).toBeNull()
  })
})


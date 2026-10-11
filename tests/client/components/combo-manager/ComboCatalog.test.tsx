// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/combo-manager/ComboCatalog.test.tsx
//
// 组合目录（components/combo-manager/ComboCatalog.tsx）：
//   ① 结构合法：卡片勾选框不得嵌在主按钮内（无效 HTML 与嵌套交互）；
//   ② 卡片显隐与「一键开关」必须共用同一标签判定（lib/tool-tags 的唯一本体）：
//      形如 mcp__xxx（无第二段 __）的工具按官方工具归属，其卡片不得在「官方工具」标签下消失。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ComboCatalog, type ComboCatalogProps } from '../../../../src/client/components/combo-manager/ComboCatalog.js'
import { zh } from '../../../../src/client/i18n.js'
import { TAG_BUILTIN } from '../../../../src/client/lib/tool-tags.js'
import type { ToolCatalog } from '../../../../src/client/hooks/useToolCombos.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function catalogOf(names: string[]): ToolCatalog {
  return {
    items: names.map((name) => ({ key: `tool:${name}`, name, description: `${name} 描述` })),
    mcp: [],
    loadedPlugins: [],
    disabledTools: [],
  }
}

function propsOf(catalog: ToolCatalog, activeTag: string, onBulkToolDisabled = vi.fn()): ComboCatalogProps {
  return {
    copy: zh,
    catalog,
    tab: 'plugins',
    onTabChange: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    activeTag,
    onTagChange: vi.fn(),
    disabledTools: new Set<string>(),
    comboDraft: { tools: [], mcpServers: [] },
    busy: false,
    onToggleTool: vi.fn(),
    onToggleMcp: vi.fn(),
    onToggleToolDisabled: vi.fn(),
    onToggleMcpDisabled: vi.fn(),
    onEditMcp: vi.fn(),
    onDeleteMcp: vi.fn(),
    onBulkToolDisabled,
  }
}

async function renderCatalog(props: ComboCatalogProps): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(ComboCatalog, props))
  })
}

describe('组合目录', () => {
  it('卡片勾选框不得嵌套在主按钮内', async () => {
    await renderCatalog(propsOf(catalogOf(['read']), 'all'))
    expect(container!.querySelectorAll('button input')).toHaveLength(0)
    expect(container!.querySelectorAll('.wf-combo-card__main')).toHaveLength(1)
  })

  it('「官方工具」标签下卡片显隐与一键开关目标一致（mcp__xxx 按官方工具归属）', async () => {
    const onBulkToolDisabled = vi.fn()
    await renderCatalog(propsOf(catalogOf(['mcp__orphan', 'read']), TAG_BUILTIN, onBulkToolDisabled))
    const names = Array.from(container!.querySelectorAll('.wf-combo-card__name')).map((item) => item.textContent)
    expect(names).toEqual(expect.arrayContaining(['mcp__orphan', 'read']))

    const bulk = container!.querySelector<HTMLButtonElement>('.wf-combo-tag__bulk')
    await act(async () => { bulk?.click() })
    expect(onBulkToolDisabled).toHaveBeenCalledWith(true, expect.arrayContaining(['mcp__orphan', 'read']))
  })
})

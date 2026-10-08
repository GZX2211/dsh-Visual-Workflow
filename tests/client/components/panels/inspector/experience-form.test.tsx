// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/experience-form.test.tsx
//
// ExperienceForm 单测：属性栏「长期统计」只读区的呈现契约（文档 §34 / §14）。
//   ① 六项统计值只读展示，统计区内不得出现任何输入控件；
//   ② 统计行缺失时展示「暂无统计」，不伪造 0；
//   ③ 编辑字段的补丁只带被编辑的字段，统计值绝不随补丁下发。
//
// 为什么单独建档而不是并入 panels.test.tsx：那支测的是 Inspector 装配与底部按钮分录；
// 本支只锁定「统计只读」这一条契约，避免互相拖累（见 tests/AGENTS 单一职责）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ExperienceForm } from '../../../../../src/client/components/panels/inspector/experience-form.js'
import { zh } from '../../../../../src/client/i18n.js'
import type { ExperienceEntry } from '../../../../../src/host/shared/asset-types.js'

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
  vi.restoreAllMocks()
})

/** 经验条目样本（只填本用例断言所需的字段，统计由 overrides 控制有无）。 */
function entry(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: 'ex-1',
    active: true,
    experienceType: 'agent',
    responsibility: '负责发布链路',
    taskType: '插件开发',
    decisionDomain: '发布时机',
    situation: '发布前发现缺陷',
    trigger: '再次发布',
    principle: '先跑端到端',
    recommendedAction: '补一轮端到端验证',
    exclusions: [],
    evidence: [],
    taskRetrievalText: '任务侧投影',
    decisionRetrievalText: '决策侧投影',
    sourceRunId: 'run-9',
    generationPromptId: 'prompt-3',
    generationPromptVersion: 'v2',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  }
}

const STATS: ExperienceEntry['stats'] = {
  experienceId: 'ex-1',
  effectiveSampleCount: 3.5,
  recalledCount: 7,
  usedCount: 4,
  fitMean: 0.8,
  empiricalValue: -0.25,
  variance: 0.02,
  stability: 0.9,
  evidenceStrength: 0.63,
  harmCount: 1,
  harmRate: 0.25,
  harmSeverity: 0.5,
  qualitySignal: 0.3,
  trust: 0.5,
  updatedAt: 1,
}

async function renderForm(data: ExperienceEntry, onPatch: (patch: Record<string, unknown>) => void = () => {}): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    // 组件按 Record<string, unknown> 收编宿主条目形状（见 ExperienceFormProps）；
    // 展开一次即可得到带隐式索引签名的对象，无需断言绕过类型检查
    root.render(React.createElement(ExperienceForm, { data: { ...data }, copy: zh, onPatch }))
  })
}

/** 统计行的标签序列。 */
function statLabels(): (string | null)[] {
  return Array.from(container!.querySelectorAll('.wf-stat__label')).map((node) => node.textContent)
}

/** 统计行的数值序列。 */
function statValues(): (string | null)[] {
  return Array.from(container!.querySelectorAll('.wf-stat__value')).map((node) => node.textContent)
}

describe('ExperienceForm：长期统计只读展示（§34）', () => {
  it('test_统计区_有统计_展示六项值且区内无输入控件', async () => {
    await renderForm(entry({ stats: STATS }))

    expect(statLabels()).toEqual([
      zh.experienceStatsFields.trust,
      zh.experienceStatsFields.empiricalValue,
      zh.experienceStatsFields.evidenceStrength,
      zh.experienceStatsFields.stability,
      zh.experienceStatsFields.usedCount,
      zh.experienceStatsFields.harmRate,
    ])
    expect(statValues()).toEqual(['0.50', '-0.25', '0.63', '0.90', '4', '0.25'])
    // 只读区不提供任何可编辑控件（人工不能直接编辑统计值）
    expect(container!.querySelectorAll('.wf-stat-list input, .wf-stat-list textarea, .wf-stat-list select')).toHaveLength(0)
    // 统计值不得出现在可编辑字段里（否则保存时会随表单回传）
    const editable = Array.from(container!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.wf-field input, .wf-field textarea'))
    expect(editable.some((node) => node.value === '0.50' || node.value === '4')).toBe(false)
  })

  it('test_统计区_统计缺失_展示暂无统计且不伪造数值', async () => {
    await renderForm(entry())

    const text = container!.textContent ?? ''
    expect(text).toContain(zh.experienceStatsEmpty)
    expect(container!.querySelector('.wf-stat-list')).toBeNull()
    expect(statValues()).toEqual([])
    // 缺失态不得出现任何统计数值（0 也是伪造的事实）
    expect(text).not.toContain('0.50')
  })

  it('test_编辑字段_统计值不随补丁下发', async () => {
    const onPatch = vi.fn()
    await renderForm(entry({ stats: STATS }), onPatch)

    const responsibility = container!.querySelector<HTMLTextAreaElement>('.wf-field textarea')!
    // 原生 setter 改写取值：直接赋 value 会被 React 的取值追踪判定为「未变化」而不触发 onChange
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(responsibility, '改写后的责任')
      responsibility.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(onPatch).toHaveBeenCalledTimes(1)
    expect(onPatch).toHaveBeenCalledWith({ responsibility: '改写后的责任' })
  })
})

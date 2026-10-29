// tests/client/styles/scheduler.test.ts
//
// 定时任务样式片段：有效星期选择器的状态表达契约（静态规则语义断言，不验证浏览器渲染）。
//
// 为什么断言规则而不是渲染结果：jsdom 不计算 :hover / :focus-visible / @media，
// Issue #24「指针移到别的星期上时『日』仍然高亮」只能在规则层验证其成因——
// 悬停没有限定设备、鼠标点击后的焦点残留没有复位、键盘焦点被顺手一起抹掉。
// 断言只取「选择器语义 + 声明集合 + 所属媒体查询」，不约束规则顺序、声明书写顺序与空白。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { schedulerStyles } from '../../../src/client/styles/scheduler.js'
import {
  activeRulesOf,
  anyFocusRulesOf,
  clearsFocusRing,
  dayHoverRulesOf,
  focusResetRulesOf,
  gatesHoverToFinePointer,
  hasVisibleFocusRing,
  keyboardFocusRulesOf,
  parseStyleRules,
} from './fixtures/style-rules.js'

const RULES = parseStyleRules(schedulerStyles)
const DAY_HOVER_RULES = dayHoverRulesOf(RULES)
const FOCUS_RESET_RULES = focusResetRulesOf(RULES)
const KEYBOARD_FOCUS_RULES = keyboardFocusRulesOf(RULES)
const ANY_FOCUS_RULES = anyFocusRulesOf(RULES)
const ACTIVE_RULES = activeRulesOf(RULES)

describe('定时任务星期选择器：悬停状态', () => {
  it('悬停样式只在支持悬停的精细指针设备上生效（触摸设备不得残留 sticky hover）', () => {
    expect(DAY_HOVER_RULES.length, '未找到 .wf-sched-day 的悬停规则：悬停反馈被整体删除，属于回归').toBeGreaterThan(0)
    const ungated = DAY_HOVER_RULES.filter((rule) => !gatesHoverToFinePointer(rule.media)).map((rule) => rule.selector)
    expect(ungated, '这些悬停规则没有限定在 (hover: hover) and (pointer: fine)，触摸设备点击后会持续高亮').toEqual([])
  })

  it('桌面端悬停反馈内容不变：brand 描边 + 主文字色', () => {
    for (const rule of DAY_HOVER_RULES) {
      expect(rule.declarations.get('border-color'), `${rule.selector} 的悬停描边色`).toBe('var(--wf-brand)')
      expect(rule.declarations.get('color'), `${rule.selector} 的悬停文字色`).toBe('var(--wf-ink)')
    }
  })
})

describe('定时任务星期选择器：焦点状态', () => {
  it('鼠标点击后指针已离开时，焦点残留被复位为基础态（含阴影）', () => {
    expect(FOCUS_RESET_RULES.length, '缺少「非选中、非键盘焦点、非悬停」的焦点复位规则：宿主 focus 样式会与悬停同款').toBeGreaterThan(0)
    const matched = FOCUS_RESET_RULES.some(
      (rule) =>
        rule.declarations.get('border-color') === 'var(--wf-border)' &&
        rule.declarations.get('color') === 'var(--wf-ink-2)' &&
        rule.declarations.get('background') === 'var(--wf-layer)' &&
        rule.declarations.get('box-shadow') === 'none',
    )
    expect(matched, '复位规则必须同时还原 border-color / color / background / box-shadow：宿主可能施加任一项').toBe(true)
  })

  it('键盘聚焦保留可见焦点环（不得只剩 outline: none）', () => {
    expect(KEYBOARD_FOCUS_RULES.length, '缺少 :focus-visible 规则：键盘用户将失去焦点指示').toBeGreaterThan(0)
    const visible = KEYBOARD_FOCUS_RULES.some((rule) => hasVisibleFocusRing(rule.declarations))
    expect(visible, ':focus-visible 必须提供可见描边或阴影').toBe(true)
  })

  it('任意焦点中的星期按钮都清除宿主焦点圈（outline 与 box-shadow）', () => {
    expect(ANY_FOCUS_RULES.length, '缺少无条件的 :focus 规则：指针仍停在按钮上时宿主焦点圈无法清除').toBeGreaterThan(0)
    const cleared = ANY_FOCUS_RULES.some((rule) => clearsFocusRing(rule.declarations))
    expect(cleared, ':focus 必须同时清除 outline 与 box-shadow（宿主发光焦点环常由 box-shadow 实现）').toBe(true)
  })
})

describe('定时任务星期选择器：选中态', () => {
  it('选中态保持 brand 描边、brand 文字与提亮背景，不被焦点规则削弱', () => {
    expect(ACTIVE_RULES.length, '缺少 .wf-sched-day.is-active 规则').toBeGreaterThan(0)
    const active = ACTIVE_RULES.find((rule) => rule.declarations.get('border-color') === 'var(--wf-brand)')
    expect(active, '选中态必须保留 brand 描边').toBeDefined()
    expect(active?.declarations.get('color')).toBe('var(--wf-brand)')
    expect(active?.declarations.get('background')?.startsWith('color-mix('), '选中态背景应为提亮的 color-mix').toBe(true)
  })
})

describe('定时任务星期选择器：组件契约不变', () => {
  it('修复不得引入主动失焦（blur）等焦点管理副作用', () => {
    const formSource = readFileSync('src/client/components/scheduler/SchedulerTaskForm.tsx', 'utf8')
    expect(formSource, 'Issue #24 的修复只允许落在样式层；在 onClick 里 blur() 会破坏键盘可访问性').not.toContain('.blur(')
  })
})

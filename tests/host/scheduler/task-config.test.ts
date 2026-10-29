// tests/host/scheduler/task-config.test.ts
//
// 定时任务配置契约单测（三层分工）：
//   parseScheduledTaskInput（请求体形状收敛 + id 前缀校验）→
//   validateScheduledTask（字段级业务校验，中文错误消息）→
//   normalizeScheduledTask（保存前补齐/清洗）。

import { describe, expect, it } from 'vitest'
import {
  normalizeScheduledTask,
  parseScheduledTaskInput,
  ScheduledTaskInputError,
  validateScheduledTask,
} from '../../../src/host/scheduler/index.js'
import type { ScheduledTask } from '../../../src/host/shared/types.js'
import { makeTask } from './fixtures/task-fixture.js'

/** 固定时钟（createdAt/updatedAt 注入用）。 */
const fixedNow = (): number => Date.parse('2026-09-25T00:00:00.000Z')

describe('parseScheduledTaskInput（请求体 → 任务实体）', () => {
  it('未知请求体收敛为任务形状：缺省值 + 固定运行时策略 + 时钟注入时间戳', () => {
    const task = parseScheduledTaskInput({ taskId: 'task-9' }, { now: fixedNow })
    expect(task).toMatchObject({
      taskId: 'task-9',
      name: '',
      workflowTemplateId: '',
      sessionMode: 'new-session',
      ownerSessionId: '',
      enabled: true,
      timezone: '',
      triggerMode: 'daily_time',
      dailyTimeConfig: null,
      intervalConfig: null,
      runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    })
    expect(task.window).toEqual({ startDate: '', endDate: '', daysOfWeek: [], timeRanges: [], unbounded: false })
  })

  it('id 前缀非法/缺失 → ScheduledTaskInputError（消息即端点 400 文案）', () => {
    expect(() => parseScheduledTaskInput({ taskId: 'wf-1' }, { now: fixedNow })).toThrow(ScheduledTaskInputError)
    expect(() => parseScheduledTaskInput({ taskId: 'wf-1' }, { now: fixedNow })).toThrow('定时任务 id 必须以 task- 前缀')
    expect(() => parseScheduledTaskInput({}, { now: fixedNow })).toThrow('定时任务 id 必须以 task- 前缀')
  })

  it('非对象请求体 → requires task', () => {
    expect(() => parseScheduledTaskInput(null, { now: fixedNow })).toThrow('requires task')
    expect(() => parseScheduledTaskInput('nope', { now: fixedNow })).toThrow('requires task')
  })

  it('daysOfWeek 逐项 Number 收敛；时间区间缺边补齐为空串；空白 workspacePath 由规范化阶段剥除；createdAt 保留既有值', () => {
    const task = parseScheduledTaskInput({
      taskId: 'task-9',
      window: { daysOfWeek: ['1', 2], timeRanges: [{ start: '08:00' }, { end: '18:00' }] },
      workspacePath: '   ',
      createdAt: '2026-01-01T00:00:00.000Z',
    }, { now: fixedNow })
    expect(task.window.daysOfWeek).toEqual([1, 2])
    expect(task.window.timeRanges).toEqual([{ start: '08:00', end: '' }, { start: '', end: '18:00' }])
    // 形状收敛只做类型收敛、不做清洗：空白 workspacePath 随原值带出，
    // 由 normalizeScheduledTask 在落盘前剥除（保持存储干净）。
    expect(task.workspacePath).toBe('   ')
    expect(normalizeScheduledTask(task).workspacePath).toBeUndefined()
    expect(task.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('会话/触发模式非白名单取值收敛为缺省；间隔配置原样收敛（是否合法由校验层判定）', () => {
    const task = parseScheduledTaskInput({
      taskId: 'task-9',
      sessionMode: 'bogus',
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 0, startFrom: 9 },
    }, { now: fixedNow })
    expect(task.sessionMode).toBe('new-session')
    expect(task.triggerMode).toBe('interval')
    expect(task.intervalConfig).toEqual({ intervalMinutes: 0, startFrom: '9' })
  })
})

describe('校验与规范化', () => {
  it('validateScheduledTask：非法字段返回中文错误（interval 范围/时刻重复/窗口非法）', () => {
    expect(validateScheduledTask(makeTask())).toBe(null)
    expect(validateScheduledTask(makeTask({ name: '' }))).toBe('任务名称不能为空')
    expect(validateScheduledTask(makeTask({ timezone: 'Mars/Olympus' }))).toBe('时区无效')
    expect(validateScheduledTask(makeTask({
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 0, startFrom: '09:00' },
    }))).toContain('1-1439')
    expect(validateScheduledTask(makeTask({
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 1440, startFrom: '09:00' },
    }))).toContain('1-1439')
    expect(validateScheduledTask(makeTask({
      triggerMode: 'daily_time',
      dailyTimeConfig: { timePoints: ['10:00', '10:00'] },
    }))).toContain('不可重复')
    expect(validateScheduledTask(makeTask({
      window: { startDate: '2026-09-30', endDate: '2026-09-01', daysOfWeek: [], timeRanges: [{ start: '08:00', end: '18:00' }] },
    }))).toContain('起始日期不能晚于结束日期')
    expect(validateScheduledTask(makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [7], timeRanges: [{ start: '08:00', end: '18:00' }] },
    }))).toContain('0-6')
    expect(validateScheduledTask(makeTask({
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [] },
    }))).toContain('至少需要一个可执行时间段')
  })

  it('normalizeScheduledTask：时刻升序去重 + policy 兜底 + 非法时间剔除', () => {
    const task = makeTask({
      triggerMode: 'daily_time',
      dailyTimeConfig: { timePoints: ['16:30', '10:00', '10:00', 'bad'] },
      runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    })
    const normalized = normalizeScheduledTask(task)
    expect(normalized.dailyTimeConfig?.timePoints).toEqual(['10:00', '16:30'])
    expect(normalized.runtimePolicy).toEqual({ missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' })
    const tzFallback = normalizeScheduledTask(makeTask({ timezone: '' }))
    expect(tzFallback.timezone).toBe('Asia/Shanghai')
    const enabledFallback = normalizeScheduledTask(makeTask({ enabled: false }))
    expect(enabledFallback.enabled).toBe(false)
  })

  it('parse → validate → normalize 串联：收敛后的非法配置被校验层拒绝，合法配置规范化落盘', () => {
    const rejected = parseScheduledTaskInput({
      taskId: 'task-9',
      name: '任务',
      workflowTemplateId: 'tpl-1',
      ownerSessionId: 'session-1',
      timezone: 'Asia/Shanghai',
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [{ start: '08:00', end: '18:00' }] },
      triggerMode: 'interval',
      intervalConfig: { intervalMinutes: 0, startFrom: '09:00' },
    }, { now: fixedNow })
    expect(validateScheduledTask(rejected)).toContain('1-1439')

    const accepted = parseScheduledTaskInput({
      taskId: 'task-9',
      name: '  任务  ',
      workflowTemplateId: 'tpl-1',
      ownerSessionId: 'session-1',
      timezone: 'Asia/Shanghai',
      window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [1], timeRanges: [{ start: '08:00', end: '18:00' }] },
      triggerMode: 'daily_time',
      dailyTimeConfig: { timePoints: ['14:00', '10:00'] },
      workspacePath: 'D:\\ws',
    }, { now: fixedNow })
    expect(validateScheduledTask(accepted)).toBe(null)
    const normalized = normalizeScheduledTask(accepted)
    expect(normalized.name).toBe('任务')
    expect(normalized.dailyTimeConfig?.timePoints).toEqual(['10:00', '14:00'])
    expect(normalized.workspacePath).toBe('D:\\ws')
  })
})

// ---------------------------------------------------------------------------
// 第三层：条件触发配置（condition 为可选字段；旧任务缺省 = 未启用）
// ---------------------------------------------------------------------------

/** 当前平台可用的绝对脚本路径（校验层按运行平台判定绝对路径）。 */
const ABSOLUTE_SCRIPT = process.platform === 'win32' ? 'C:\\scripts\\check-issue.mjs' : '/opt/scripts/check-issue.mjs'
const RELATIVE_SCRIPT = 'scripts/check-issue.mjs'

/** 以原始形状挂上 condition（类型上尚未声明该字段，夹具负责透传）。 */
function withCondition(task: ScheduledTask, condition: unknown): ScheduledTask {
  return { ...task, condition } as unknown as ScheduledTask
}

/** 读取 condition 原始值（未声明字段的受控读取）。 */
function conditionOf(task: ScheduledTask): unknown {
  return (task as ScheduledTask & { condition?: unknown }).condition
}

describe('条件触发配置：请求体收敛', () => {
  it('请求体没有 condition → 收敛为 null（旧数据兼容）', () => {
    const task = parseScheduledTaskInput({ taskId: 'task-9' }, { now: fixedNow })
    expect(conditionOf(task)).toBeNull()
  })

  it('condition 不是对象 → null（字符串/数组/null 都不算配置）', () => {
    for (const raw of ['enabled', ['a'], null]) {
      const task = parseScheduledTaskInput({ taskId: 'task-9', condition: raw }, { now: fixedNow })
      expect(conditionOf(task), String(raw)).toBeNull()
    }
  })

  it('是对象 → enabled 仅按 true 收窄，scriptPath 转字符串并 trim', () => {
    const task = parseScheduledTaskInput({
      taskId: 'task-9',
      condition: { enabled: 'yes', scriptPath: `  ${ABSOLUTE_SCRIPT}  ` },
    }, { now: fixedNow })
    expect(conditionOf(task)).toEqual({ enabled: false, scriptPath: ABSOLUTE_SCRIPT })
  })
})

describe('条件触发配置：校验（仅在启用时校验路径）', () => {
  it('启用但路径为空 → 提示选择脚本文件', () => {
    const message = validateScheduledTask(withCondition(makeTask(), { enabled: true, scriptPath: '  ' }))
    expect(message).toContain('请选择脚本文件')
  })

  it('启用但路径是相对路径 → 提示必须是绝对路径', () => {
    const message = validateScheduledTask(withCondition(makeTask(), { enabled: true, scriptPath: RELATIVE_SCRIPT }))
    expect(message).toContain('绝对路径')
  })

  it('启用但扩展名不支持 → 提示仅支持 .mjs/.cjs/.js', () => {
    const ps1 = process.platform === 'win32' ? 'C:\\scripts\\check.ps1' : '/opt/scripts/check.ps1'
    const message = validateScheduledTask(withCondition(makeTask(), { enabled: true, scriptPath: ps1 }))
    expect(message).toContain('.mjs')
  })

  it('未启用条件时不校验路径（允许保留历史值）', () => {
    expect(validateScheduledTask(withCondition(makeTask(), { enabled: false, scriptPath: RELATIVE_SCRIPT }))).toBeNull()
    expect(validateScheduledTask(makeTask())).toBeNull()
  })
})

describe('条件触发配置：规范化', () => {
  it('关闭且路径为空 → 化简为 null（保持存储干净）', () => {
    const normalized = normalizeScheduledTask(withCondition(makeTask(), { enabled: false, scriptPath: '' }))
    expect(conditionOf(normalized)).toBeNull()
  })

  it('关闭但路径非空 → 保留配置（重新开启不必重填）', () => {
    const normalized = normalizeScheduledTask(withCondition(makeTask(), { enabled: false, scriptPath: ABSOLUTE_SCRIPT }))
    expect(conditionOf(normalized)).toEqual({ enabled: false, scriptPath: ABSOLUTE_SCRIPT })
  })

  it('启用 → 保留并 trim；与会话策略无关（current-session 同样保留）', () => {
    const normalized = normalizeScheduledTask(withCondition(
      makeTask({ sessionMode: 'current-session' }),
      { enabled: true, scriptPath: ` ${ABSOLUTE_SCRIPT} ` },
    ))
    expect(conditionOf(normalized)).toEqual({ enabled: true, scriptPath: ABSOLUTE_SCRIPT })
  })
})

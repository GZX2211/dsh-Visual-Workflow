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

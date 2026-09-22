// tests/host/scheduler/fixtures/task-fixture.ts
//
// 定时任务测试夹具：标准任务（2026-09-01 ~ 09-30 工作日，daily_time 10:00/14:00/16:30），
// 供窗口/触发/配置校验各单测复用（避免每个文件各写一份形状）。

import type { ScheduledTask } from '../../../../src/host/shared/types.js'

export const TZ = 'Asia/Shanghai'

/** 标准窗口：2026-09-01 ~ 2026-09-30，工作日，daily_time 10:00/14:00/16:30。 */
export function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    taskId: 'task-1',
    name: '测试任务',
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 'session-owner',
    enabled: true,
    timezone: TZ,
    window: {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      daysOfWeek: [1, 2, 3, 4, 5],
      timeRanges: [{ start: '06:00', end: '09:00' }, { start: '12:00', end: '14:00' }, { start: '22:00', end: '23:59' }],
    },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['10:00', '14:00', '16:30'] },
    intervalConfig: { intervalMinutes: 70, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

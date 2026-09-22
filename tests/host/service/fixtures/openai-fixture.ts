// tests/host/service/fixtures/openai-fixture.ts
//
// OpenAI 兼容 API 测试夹具：fake 数据层/编排器（记录调用、终态可控）+ api 实例装配。
// 供核心（openai-api）与 HTTP 适配（openai-http）两组单测共用。

import { OpenAiApi } from '../../../../src/host/service/index.js'
import type { RunSnapshot, RunStatus, ServiceState } from '../../../../src/host/shared/types.js'

/** fake 数据层（openai-api 用到的面）。 */
export class FakeStore {
  runs: RunSnapshot[] = []
  service: ServiceState | null = null
  async getRun(id: string): Promise<RunSnapshot | null> {
    return this.runs.find((run) => run.id === id) ?? null
  }
  async listRuns(flowId: string): Promise<RunSnapshot[]> {
    return this.runs.filter((run) => run.flowId === flowId)
  }
  async getServiceById(): Promise<ServiceState | null> {
    return this.service
  }
}

/** fake 编排器（记录调用；终态可控）。 */
export class FakeOrchestrator {
  startCalls: Array<{ sessionId: string; flowId: string; mode: string; question: string }> = []
  resumeCalls: Array<{ sessionId: string; flowId: string }> = []
  stopCalls: string[] = []
  status: RunStatus = 'completed'
  nextRunId = 'run-1'
  async startRun(input: { sessionId: string; flowId: string; mode: string; question?: string }) {
    this.startCalls.push({ ...input, question: input.question ?? '' })
    return { runId: this.nextRunId, defPath: '/def.json' }
  }
  async resumeRun(input: { sessionId: string; flowId: string }) {
    this.resumeCalls.push(input)
    return { runId: 'run-resumed', defPath: '/def.json' }
  }
  async stopRun(runId: string) {
    this.stopCalls.push(runId)
    this.status = 'stopped'
  }
  runSnapshot(): { status: RunStatus; summary: string } | null {
    return { status: this.status, summary: '摘要' }
  }
}

export interface Harness {
  api: OpenAiApi
  store: FakeStore
  orchestrator: FakeOrchestrator
  sweeps: { count: number }
  sessions: Map<string, string>
}

export function makeHarness(options: { apiKey?: string | null; maxConcurrent?: number; status?: RunStatus } = {}): Harness {
  const store = new FakeStore()
  const orchestrator = new FakeOrchestrator()
  orchestrator.status = options.status ?? 'completed'
  const sweeps = { count: 0 }
  const sessions = new Map<string, string>()
  let seq = 0
  const api = new OpenAiApi({
    store: store as never,
    orchestrator: orchestrator as never,
    serviceId: 'svc-1',
    apiKey: options.apiKey ?? null,
    maxConcurrent: options.maxConcurrent ?? 50,
    resolveSession: async (userId) => {
      let sid = sessions.get(userId)
      if (!sid) {
        sid = `session-${++seq}`
        sessions.set(userId, sid)
      }
      return sid
    },
    ensureRootAgent: async () => ({ agent: { followup() {}, session: { seq: 0, events: [] } }, provider: 'deepseek', model: 'deepseek-chat' }),
    sweep: async () => { sweeps.count += 1 },
    pollMs: 1,
  })
  return { api, store, orchestrator, sweeps, sessions }
}

export function pausedRun(id: string): RunSnapshot {
  return {
    id,
    flowId: 'svc-1',
    flowName: '服务',
    sessionId: 'session-1',
    mode: 'mode2',
    status: 'paused',
    startedAt: '2026-08-24T00:00:00.000Z',
    endedAt: null,
    summary: '',
    nodes: [],
  }
}

// tests/host/api/runtime.test.ts
//
// 运行期配置下发端点组的边界职责（api/runtime.ts）：
//   1. 下发值来自宿主能力缝——改配置即改下发值（不硬编码、不缓存）；
//   2. 真实宿主接线——VisualWorkflowHost 的下发值取自 config.runPollMs；
//   3. 能力缝缺失时明确 501，不静默返回假值。
//
// 运行环境：node（host 测试默认）。

import { afterEach, describe, expect, it } from 'vitest'
import { VisualWorkflowHost } from '../../../src/host/visual-workflow-host.js'
import type { Config } from '../../../src/host/config.js'
import { VisualWorkflowApi, type ApiHost } from '../../../src/host/api/index.js'
import { EP_RUNTIME_CONFIG } from '../../../src/host/shared/protocol.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(async () => {
  await cleanupAll()
})

describe('运行期配置下发端点', () => {
  it('下发值来自配置：改配置 → 下发值随之变化', async () => {
    const config = { runPollMs: 2000 }
    const h = await makeHarness({ runtimeConfig: () => ({ runPollMs: config.runPollMs }) })

    expect(await h.api.handle(EP_RUNTIME_CONFIG, {})).toEqual({ runPollMs: 2000 })

    config.runPollMs = 750
    expect(await h.api.handle(EP_RUNTIME_CONFIG, {})).toEqual({ runPollMs: 750 })
  })

  it('能力缝缺失：明确 501，不静默返回假值', async () => {
    const h = await makeHarness()

    await expect(h.api.handle(EP_RUNTIME_CONFIG, {})).rejects.toMatchObject({ status: 501 })
  })
})

describe('生产装配接线（宿主实例当 ApiHost）', () => {
  it('经 API 分发调用：以宿主原型方法作能力缝时不得丢失 receiver', async () => {
    // 为什么这样构造：生产上 registerRoutes(ctx, this) 直接传宿主实例，能力缝是
    // VisualWorkflowHost.prototype 上的方法——两端点走同一条调用链才能暴露 receiver 丢失；
    // 箭头函数注入没有自己的 this，抓不到这类缺陷。
    const host = Object.create(VisualWorkflowHost.prototype) as VisualWorkflowHost
    const config: Partial<Config> = { runPollMs: 900 }
    ;(host as unknown as { config: Partial<Config> }).config = config
    const api = new VisualWorkflowApi({ get: () => null }, host as unknown as ApiHost)

    expect(await api.handle(EP_RUNTIME_CONFIG, {})).toEqual({ runPollMs: 900 })

    config.runPollMs = 1200
    expect(await api.handle(EP_RUNTIME_CONFIG, {})).toEqual({ runPollMs: 1200 })
  })
})

describe('宿主下发接线', () => {
  it('VisualWorkflowHost 的下发值取自 config.runPollMs', () => {
    // 为什么用原型 + 替身 this：真实装配需要 cordis root 与磁盘初始化（属 tests/integration），
    // 这里只锁定「下发值来自 config 而非常量」这条接线事实。
    const host = Object.create(VisualWorkflowHost.prototype) as VisualWorkflowHost
    const stub = host as unknown as { config: Partial<Config> }
    const config: Partial<Config> = { runPollMs: 321 }
    stub.config = config

    expect(host.runtimeConfig()).toEqual({ runPollMs: 321 })

    config.runPollMs = 1500
    expect(host.runtimeConfig()).toEqual({ runPollMs: 1500 })
  })
})

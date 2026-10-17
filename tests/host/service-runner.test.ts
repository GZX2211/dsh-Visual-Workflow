// tests/host/service-runner.test.ts
//
// 服务进程入口（src/host/service-runner.ts）的可测契约：
//   - apply：launcher 未提供 appExit 时必须明确报错（服务进程必须能请求退出）。
//
// 服务身份/端口只经 serve.patch.yml 渲染进 config（launcher 不传 flag，见 manager.spawnChild），
// 该装配路径由 tests/integration/host-assembly.test.ts 的 skipReconcile 用例与端到端流程覆盖，
// 本文件不真实 fork/装配进程。

import { describe, expect, it } from 'vitest'
import { apply, type Config } from '../../src/host/service-runner.js'

const config: Config = { serviceId: 'svc-1', dataDir: 'D:/data', port: 7860, apiKey: null, maxConcurrent: 50 }

describe('apply 前置契约', () => {
  it('launcher 未提供 appExit → 明确报错（不得静默启动后无法退出）', () => {
    const ctx = { get: () => undefined } as never
    expect(() => apply(ctx, config)).toThrow(/appExit/)
  })
})

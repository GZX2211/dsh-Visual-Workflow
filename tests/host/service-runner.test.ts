// tests/host/service-runner.test.ts
//
// 服务进程入口（src/host/service-runner.ts）的可测契约：
//   - parseServiceArgs：--visual-workflow-serve / --port 的权威解析与非法输入判定；
//   - apply：launcher 未提供 appExit 时必须明确报错（服务进程必须能请求退出）。
//
// boot 的真实装配路径（含 VisualWorkflowHost 挂载与 OpenAI API 注册）由
// tests/integration/host-assembly.test.ts 的 skipReconcile 用例与端到端流程覆盖，
// 本文件不真实 fork/装配进程。

import { describe, expect, it } from 'vitest'
import { apply, parseServiceArgs, type Config } from '../../src/host/service-runner.js'

const config: Config = { serviceId: 'svc-1', dataDir: 'D:/data', port: 7860, apiKey: null, maxConcurrent: 50 }

describe('parseServiceArgs（cmdlineArgs 权威解析）', () => {
  it('完整 flag → 解析 serviceId 与端口', () => {
    expect(parseServiceArgs(['--visual-workflow-serve', 'svc-1', '--port', '7860'])).toEqual({ serviceId: 'svc-1', port: 7860 })
  })

  it('flag 顺序无关；同名 flag 以后者为准', () => {
    expect(parseServiceArgs(['--port', '9000', '--visual-workflow-serve', 'svc-9'])).toEqual({ serviceId: 'svc-9', port: 9000 })
    expect(
      parseServiceArgs(['--visual-workflow-serve', 'a', '--visual-workflow-serve', 'b', '--port', '1', '--port', '2']),
    ).toEqual({ serviceId: 'b', port: 2 })
  })

  it('缺失任一 flag / 空值 / 非法端口 → null（回退 config）', () => {
    expect(parseServiceArgs([])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve', 'svc-1'])).toBeNull()
    expect(parseServiceArgs(['--port', '7860'])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve'])).toBeNull()
    expect(parseServiceArgs(['--port'])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve', '  ', '--port', '7860'])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve', 'svc-1', '--port', 'abc'])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve', 'svc-1', '--port', '0'])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve', 'svc-1', '--port', '-1'])).toBeNull()
    expect(parseServiceArgs(['--visual-workflow-serve', 'svc-1', '--port', '7860.5'])).toBeNull()
  })

  it('无关参数被忽略（launcher 转交的 app 参数族可含其它 token）', () => {
    expect(parseServiceArgs(['--profile', 'headless', '--visual-workflow-serve', 'svc-1', '--port', '7860'])).toEqual({
      serviceId: 'svc-1',
      port: 7860,
    })
  })
})

describe('apply 前置契约', () => {
  it('launcher 未提供 appExit → 明确报错（不得静默启动后无法退出）', () => {
    const ctx = { get: () => undefined } as never
    expect(() => apply(ctx, config)).toThrow(/appExit/)
  })
})

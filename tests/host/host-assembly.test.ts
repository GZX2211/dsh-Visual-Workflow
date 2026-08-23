// tests/host/host-assembly.test.ts
//
// Host 装配测试（T-015）：用真实 @deepseek-ai/cordis Context（peer，测试期物化）
// 启动插件 fiber——断言 ① 启动无错且数据目录结构建立；② dataDir 缺失时 fiber 失败；
// ③ fiber 卸载后事件监听与显式清理生效（dispose 幂等）。断言依据：架构文档 §4.1/
// §9.6、SKILL §4.3 Effect 所有权、任务清单 T-015 DoD。

import { describe, expect, it, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { VisualWorkflowHost, VisualWorkflowHostServiceName, type Config } from '../../src/host/index.js'
import { FlowStore } from '../../src/host/storage/flow-store.js'

/** 构造含临时 dataDir 的完整配置（其余键取 schema 默认）。 */
function makeConfig(dir: string): Config {
  return {
    dataDir: dir,
    servicePortBase: 7860,
    apiKey: null,
    maxConcurrentPerService: 50,
    wfAskAgentTimeoutMs: 120000,
    runIdleTimeoutMs: 1800000,
    runPollMs: 2000,
    reactIterationLimitDefault: 50,
    retryLimitDefault: 3,
    outputFullLimit: 102400,
    documentTextLimit: 20000,
    embeddingModelDir: null,
    embeddingEndpoint: null,
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

describe('VisualWorkflowHost 装配', () => {
  it('真实 cordis 启动无错：service 提供、数据目录结构建立', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))

    // service 已提供且为宿主实例
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost
    expect(host).toBeInstanceOf(VisualWorkflowHost)
    expect(host.store).toBeInstanceOf(FlowStore)
    // 数据目录结构建立（§6 目录规划）
    for (const d of FlowStore.DIRS) {
      expect(existsSync(join(dir, d)), `目录 ${d} 应存在`).toBe(true)
    }
    await root.fiber.dispose()
  })

  it('同一 fiber 内重复提供被 cordis 拒绝（service 唯一性）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    // 同一名称 service 二次注册会冲突（官方 Service 语义：同名冲突即报错）
    await expect(root.plugin(VisualWorkflowHost, makeConfig(dir))).rejects.toThrow()
    await root.fiber.dispose()
  })

  it('dataDir 缺失时 fiber 失败（不吞错，SKILL §4.2）', async () => {
    const root = new Context()
    await expect(root.plugin(VisualWorkflowHost, { ...makeConfig(''), dataDir: '' })).rejects.toThrow(/dataDir/)
    await root.fiber.dispose()
  })

  it('卸载后事件观察失效 + dispose 幂等', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    // 显式 dispose（模拟 fiber 卸载路径）
    host.dispose()
    expect(host.disposed).toBe(true)
    // 幂等：重复 dispose 不抛错
    expect(() => host.dispose()).not.toThrow()

    // 卸载后事件观察不再产生副作用：cordis 自动反注册 + 钩子内部清理态守卫双保险
    // （断言不抛错即通过；真实回写逻辑在 T-021 填充）
    expect(() => {
      root.emit('subagent/end', {})
      root.emit('agent/error', {})
    }).not.toThrow()
    await root.fiber.dispose()
  })
})

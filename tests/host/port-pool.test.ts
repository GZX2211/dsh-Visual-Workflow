// tests/host/port-pool.test.ts
//
// 端口池单测：空闲探测/占用递增/上限/非法基址回退。

import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { findFreePort, probePort, SERVICE_PORT_BASE } from '../../src/host/service/port-pool.js'

const held: Server[] = []

afterEach(async () => {
  await Promise.all(held.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

/** 占用一个端口（返回占用的 server）。 */
function hold(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      held.push(server)
      resolve(server)
    })
  })
}

describe('probePort', () => {
  it('空闲端口返回 true', async () => {
    const free = await findFreePort(18080)
    expect(await probePort(free)).toBe(true)
  })

  it('已占用端口返回 false', async () => {
    const server = await hold(18090)
    expect(await probePort(18090)).toBe(false)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})

describe('findFreePort', () => {
  it('基址空闲时直接返回基址', async () => {
    const port = await findFreePort(18100)
    expect(port).toBe(18100)
  })

  it('基址被占时向上递增取第一个空闲端口', async () => {
    await hold(18110)
    await hold(18111)
    const port = await findFreePort(18110)
    expect(port).toBe(18112)
  })

  it('超出探测上限抛错（端口池耗尽）', async () => {
    expect(await findFreePort(18120, { limit: 2 })).toBe(18120)
    const server = await hold(18121)
    await expect(findFreePort(18121, { limit: 1 })).rejects.toThrow('端口池耗尽')
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('非法基址回退默认基址', async () => {
    const port = await findFreePort(Number.NaN)
    expect(port).toBe(SERVICE_PORT_BASE)
  })

  it('探测返回的端口可再次绑定（竞态窗口语义）', async () => {
    const port = await findFreePort(18130)
    const server = await hold(port)
    expect(await probePort(port)).toBe(false)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})

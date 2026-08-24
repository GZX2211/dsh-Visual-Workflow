// src/host/service/port-pool.ts
//
// 模式二服务端口池：从基础端口（默认 7860）向上探测空闲端口。
// 探测语义：在目标主机上临时 bind 监听（成功即释放），保证「分配到的端口
// 可被服务子进程直接复用」。竞态（探测后被其他进程抢占）由子进程
// EADDRINUSE 启动失败兜底（服务标记 crashed，可重启）。

import { createServer } from 'node:net'

/** 端口池基础端口（与配置默认值一致；向上探测）。 */
export const SERVICE_PORT_BASE = 7860

/** 端口池上限（防配置错误导致无限探测）。 */
export const SERVICE_PORT_MAX = 65535

/** 单次探测的候选上限（超出视为端口池耗尽）。 */
export const PORT_PROBE_LIMIT = 200

export interface ProbeOptions {
  /** 监听主机（默认回环；0.0.0.0 场景由部署配置决定）。 */
  host?: string
  /** 探测候选上限（测试可收紧）。 */
  limit?: number
  /** 时钟注入（测试可控）。 */
  now?: () => number
}

/** 空闲端口探测：从 base 起逐一尝试，返回第一个可绑定端口。 */
export async function findFreePort(base: number, options: ProbeOptions = {}): Promise<number> {
  const host = options.host ?? '127.0.0.1'
  const limit = options.limit ?? PORT_PROBE_LIMIT
  const start = Number.isInteger(base) && base > 0 ? base : SERVICE_PORT_BASE
  for (let offset = 0; offset < limit; offset += 1) {
    const port = start + offset
    if (port > SERVICE_PORT_MAX) break
    if (await probePort(port, host)) return port
  }
  throw new Error(`端口池耗尽：${start} 起 ${limit} 个端口均不可用`)
}

/** 单端口探测：bind 成功立即释放，返回是否空闲。 */
export async function probePort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    const done = (ok: boolean): void => {
      server.removeAllListeners()
      server.close(() => resolve(ok))
    }
    server.once('error', () => done(false))
    server.listen(port, host, () => done(true))
  })
}

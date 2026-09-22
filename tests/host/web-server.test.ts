// tests/host/web-server.test.ts
//
// 官方 webServer 最小结构契约（src/host/web-server.ts）：服务缺失/形状不符 → null
// （调用方按各自语义告警降级），形状符合 → 返回官方服务本身。
//
// 两个 HTTP 边界（api 与 service）消费同一解析守卫，本文件锁定契约本身；
// 边界的降级行为见 tests/host/api/routes.test.ts 与 file-download.test.ts。

import { describe, expect, it } from 'vitest'
import { webServerOf } from '../../src/host/web-server.js'

describe('webServerOf（官方 webServer 服务解析守卫）', () => {
  it('服务缺失 / 非对象 / 无 register → null', () => {
    expect(webServerOf({ get: () => undefined })).toBeNull()
    expect(webServerOf({ get: () => null })).toBeNull()
    expect(webServerOf({ get: () => 'webServer' })).toBeNull()
    expect(webServerOf({ get: () => ({}) })).toBeNull()
    expect(webServerOf({ get: () => ({ register: 'not-a-function' }) })).toBeNull()
  })

  it('register 为函数 → 返回官方服务本身（保留对象身份，不包装）', () => {
    const service = { register: () => () => {} }
    expect(webServerOf({ get: () => service })).toBe(service)
  })

  it('只解析 webServer 服务名（不触碰其它服务）', () => {
    const names: string[] = []
    webServerOf({ get: (name: string) => { names.push(name); return undefined } })
    expect(names).toEqual(['webServer'])
  })
})

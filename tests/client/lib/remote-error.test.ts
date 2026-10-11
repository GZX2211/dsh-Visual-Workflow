// tests/client/lib/remote-error.test.ts
//
// 远端错误读取（lib/remote-error.ts —— 稳定错误码与错误文案的唯一读取口径）：
//   合法 RemoteError 取 code / message；非 Error 抛出值回退字符串原文；空值给出空串。
// 为什么需要唯一口径：列表 hook 的「按错误码特化提示」与组件层的错误提示都必须读同一规则，
// 各自复制读取逻辑会在错误码语义变更时漏改一处。

import { describe, expect, it } from 'vitest'
import { remoteErrorCodeOf, remoteErrorMessageOf } from '../../../src/client/lib/remote-error.js'
import type { RemoteError } from '../../../src/client/lib/remote.js'

describe('远端错误读取', () => {
  it('读取稳定错误码（无码返回空串）', () => {
    const error = new Error('boom') as RemoteError
    error.code = 'ERR_ASSET_NOT_FOUND'
    expect(remoteErrorCodeOf(error)).toBe('ERR_ASSET_NOT_FOUND')
    expect(remoteErrorCodeOf(new Error('boom'))).toBe('')
    expect(remoteErrorCodeOf(null)).toBe('')
    expect(remoteErrorCodeOf(undefined)).toBe('')
  })

  it('读取错误文案：Error 用 message，非 Error 用字符串原文，无信息回退错误码', () => {
    expect(remoteErrorMessageOf(new Error('保存失败'))).toBe('保存失败')
    expect(remoteErrorMessageOf('传输中断')).toBe('传输中断')
    const codeOnly = new Error('') as RemoteError
    codeOnly.code = 'REMOTE_PARSE'
    expect(remoteErrorMessageOf(codeOnly)).toBe('REMOTE_PARSE')
    expect(remoteErrorMessageOf(null)).toBe('')
  })
})

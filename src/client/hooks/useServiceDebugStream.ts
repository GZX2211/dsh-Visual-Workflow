// src/client/hooks/useServiceDebugStream.ts
//
// 模式二服务调试流（SSE 打字机）：组件只消费本面，网络访问与生命周期归此 hook。
// 责任边界（谁创建谁释放 + 卸载后不写状态 + 归属中止）：
//   - 每次 send 创建 AbortController，stop / 卸载 / 服务离开运行态都会中止；
//   - 回调与 catch 进入前校验挂载状态（卸载后不写状态）；
//   - 输出累积与错误前缀由 hook 负责，用户可见文案经参数注入（hook 不持有词典）。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { parseSseDelta } from '../lib/sse-delta.js'

/** 服务调试面（组件消费）。 */
export interface ServiceDebugFace {
  /** 累积的流式输出（含错误行）。 */
  output: string
  /** 是否有进行中的调试流。 */
  streaming: boolean
  /** 发送一条调试问题（空串 / 非运行态 / 已有流在飞时忽略）。 */
  send(prompt: string): void
  /** 主动停止当前流。 */
  stop(): void
}

export interface ServiceDebugOptions {
  /** 调试目标服务 id。 */
  serviceId: string
  /** 调试会话归属（Host 侧组装 `debug-<sessionId>` userId）。 */
  sessionId: string
  /** 服务是否处于运行态（false 时中止在途流并拒绝新的发送）。 */
  enabled: boolean
  /** 流内错误行前缀（来自词典，如「[错误] 」）。 */
  errorPrefix: string
}

export function useServiceDebugStream(remote: RemoteFace, options: ServiceDebugOptions): ServiceDebugFace {
  const { serviceId, sessionId, enabled, errorPrefix } = options
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // 卸载后不得再写状态，且进行中的 SSE 流必须中止（谁创建谁释放）
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // 服务非运行（停止/崩溃/切换）时中止进行中的调试流
  useEffect(() => {
    if (enabled) return
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [enabled])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const send = useCallback((prompt: string): void => {
    const text = prompt.trim()
    if (!text || !enabled || streaming) return
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    setOutput('')
    void (async () => {
      try {
        await remote.stream(
          EP.EP_SERVICE_DEBUG,
          { serviceId, sessionId, prompt: text },
          (line) => {
            if (!mountedRef.current) return
            if (!line.startsWith('data: ')) return
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') return
            // Bug 3：正文路径必须走 choices[0].delta.content（parseSseDelta 已兼容旧格式）
            const delta = parseSseDelta(data)
            if (delta.error) {
              setOutput((prev) => `${prev ? `${prev}\n\n` : ''}${errorPrefix}${delta.error}`)
            } else if (delta.content) {
              setOutput((prev) => prev + delta.content)
            }
          },
          controller.signal,
        )
      } catch (error) {
        if (!mountedRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        setOutput((prev) => `${prev ? `${prev}\n\n` : ''}${errorPrefix}${message}`)
      } finally {
        if (mountedRef.current) setStreaming(false)
        abortRef.current = null
      }
    })()
  }, [enabled, errorPrefix, remote, serviceId, sessionId, streaming])

  return { output, streaming, send, stop }
}

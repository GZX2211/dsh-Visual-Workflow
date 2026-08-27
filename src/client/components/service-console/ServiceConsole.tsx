// src/client/components/service-console/ServiceConsole.tsx
//
// 模式二服务调试台：服务运行中时提供调试输入——把问题经 Host 代理转发到
// 服务进程的 OpenAI 兼容端点，SSE 增量渲染（打字机效果）。
// 服务状态指示与启动/停止归画布控制栏最右侧（Toolbar 状态位），此处不再重复。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import type { ServiceState } from '../../../host/shared/types.js'
import { EP, streamCall } from '../../lib/remote.js'

export interface ServiceConsoleProps {
  copy: Dict
  service: ServiceState | null
  /** 调试会话隔离（Host 侧组装 `debug-<sessionId>` userId）。 */
  sessionId: string
  busy: boolean
}

/**
 * 解析后端 SSE data 行的内容增量（Bug 3）。
 * 后端 openai-api 的 sseChunk 把正文放在 choices[0].delta.content；
 * 为兼容旧增量格式（delta.content）做回退取值。
 * @returns { content?, error? } 增量文本或错误消息（无匹配返回空对象）。
 */
export function parseSseDelta(data: string): { content?: string; error?: string } {
  let parsed: {
    choices?: Array<{ delta?: { content?: unknown } }>
    delta?: { content?: unknown }
    error?: { message?: unknown }
  }
  try {
    parsed = JSON.parse(data)
  } catch {
    return {}
  }
  if (parsed.error?.message) return { error: String(parsed.error.message) }
  const content = parsed.choices?.[0]?.delta?.content ?? parsed.delta?.content
  return typeof content === 'string' && content ? { content } : {}
}

export function ServiceConsole({ copy, service, sessionId, busy }: ServiceConsoleProps) {
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)

  const status = service?.status ?? 'stopped'
  const running = status === 'running'

  // 服务非运行（停止/崩溃/切换）时中止进行中的调试流；依赖 status 稳定值
  // 而非 service 对象引用（状态轮询每次产生新引用，不能打断流式渲染）
  useEffect(() => {
    if (status !== 'running') {
      abortRef.current?.abort()
      abortRef.current = null
      setStreaming(false)
    }
  }, [status])

  // 流式输出追加后滚动到底部
  useEffect(() => {
    const node = outputRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [output])

  const stopDebug = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const sendDebug = useCallback(async (): Promise<void> => {
    const text = prompt.trim()
    if (!text || !running || streaming) return
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    setOutput('')
    try {
      await streamCall(
        EP.EP_SERVICE_DEBUG,
        { serviceId: service?.id ?? '', sessionId, prompt: text },
        (line) => {
          if (!line.startsWith('data: ')) return
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') return
          // Bug 3：正文路径必须走 choices[0].delta.content（parseSseDelta 已兼容旧格式）
          const delta = parseSseDelta(data)
          if (delta.error) {
            setOutput((prev) => `${prev ? `${prev}\n\n` : ''}[错误] ${delta.error}`)
          } else if (delta.content) {
            setOutput((prev) => prev + delta.content!)
          }
        },
        controller.signal,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOutput((prev) => `${prev ? `${prev}\n\n` : ''}[错误] ${message}`)
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [prompt, running, sessionId, service?.id, streaming])

  if (!service || !running) return null
  return (
    <section className="wf-service-console">
      <div className="wf-service-console__debug">
        <div className="wf-service-console__debug-head">
          <span className="wf-service-console__debug-title">{copy.serviceDebugTitle}</span>
          <span className="wf-hint">{copy.serviceDebugHint}</span>
        </div>
        <textarea
          className="wf-service-console__input"
          value={prompt}
          rows={2}
          placeholder={copy.serviceDebugPlaceholder}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendDebug()
            }
          }}
        />
        <div className="wf-service-console__debug-actions">
          {streaming
            ? <button type="button" className="wf-btn is-danger" onClick={stopDebug}>{copy.serviceDebugStop}</button>
            : <button type="button" className="wf-btn is-primary" onClick={() => { void sendDebug() }} disabled={busy || !prompt.trim()}>{copy.serviceDebugSend}</button>}
        </div>
        <pre ref={outputRef} className="wf-service-console__output">{output || copy.serviceDebugEmpty}</pre>
      </div>
    </section>
  )
}

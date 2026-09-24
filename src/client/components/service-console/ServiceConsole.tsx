// src/client/components/service-console/ServiceConsole.tsx
//
// 模式二服务调试台（纯表现层）：服务运行中时提供调试输入，流式输出（打字机）由
// 注入的服务调试面提供（useServiceDebugStream——网络访问与生命周期归该 hook）。
// 服务状态指示与启动/停止归画布控制栏最右侧（Toolbar 状态位），此处不再重复。

import { useEffect, useRef, useState } from 'react'
import type { Dict } from '../../i18n.js'
import type { ServiceState } from '../../../host/shared/types.js'
import type { ServiceDebugFace } from '../../hooks/useServiceDebugStream.js'

export interface ServiceConsoleProps {
  copy: Dict
  service: ServiceState | null
  busy: boolean
  /** 服务调试流面（发送 / 停止 / 输出 / 进行中），由装配层注入。 */
  debug: ServiceDebugFace
}

export function ServiceConsole({ copy, service, busy, debug }: ServiceConsoleProps) {
  const [prompt, setPrompt] = useState('')
  const outputRef = useRef<HTMLPreElement | null>(null)

  // 流式输出追加后滚动到底部
  useEffect(() => {
    const node = outputRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [debug.output])

  const running = (service?.status ?? 'stopped') === 'running'
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
              debug.send(prompt)
            }
          }}
        />
        <div className="wf-service-console__debug-actions">
          {debug.streaming
            ? <button type="button" className="wf-btn is-danger" onClick={debug.stop}>{copy.serviceDebugStop}</button>
            : <button type="button" className="wf-btn is-primary" onClick={() => debug.send(prompt)} disabled={busy || !prompt.trim()}>{copy.serviceDebugSend}</button>}
        </div>
        <pre ref={outputRef} className="wf-service-console__output">{debug.output || copy.serviceDebugEmpty}</pre>
      </div>
    </section>
  )
}

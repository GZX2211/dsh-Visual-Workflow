// src/client/components/panels/inspector/text-expand.tsx
//
// 属性栏多行文本域扩展编辑：文本域右下角提供展开按钮，展开后在画布区域
// （由布局层把 TextExpandOverlay 放进画布容器）得到可编辑的大文本区域，
// 右上角「收起」按钮或 Esc 返回属性栏。
//
// 为什么经 Context 而不是逐层传 props：文本域分散在多个表单，扩展层需要渲染在
// 布局层的画布容器内，二者不是父子关系；扩展态是纯渲染态，由布局层本地状态持有。
// 没有 Provider 时退化为普通文本域（不渲染不可用的展开按钮）。

import { createContext, useContext, useEffect, useState } from 'react'
import type { Dict } from '../../../i18n.js'

/** 一次扩展编辑请求（打开时快照；切换编辑对象由布局层收起）。 */
export interface TextExpandRequest {
  /** 字段标识：切换到另一个字段时扩展层重置为该字段的值。 */
  key: string
  /** 字段名（扩展层标题）。 */
  label: string
  value: string
  placeholder?: string
  onChange(value: string): void
}

/** 扩展宿主（由布局层提供；文案走词典注入）。 */
export interface TextExpandHost {
  open(request: TextExpandRequest): void
  /** 展开按钮的可访问名称。 */
  expandLabel: string
}

const TextExpandContext = createContext<TextExpandHost | null>(null)

/** 为属性栏子树提供扩展宿主。 */
export function TextExpandProvider({ host, children }: { host: TextExpandHost; children: React.ReactNode }) {
  return <TextExpandContext.Provider value={host}>{children}</TextExpandContext.Provider>
}

/**
 * 可展开文本域：渲染属性栏 textarea，并在右下角提供展开入口。
 * value 与 onChange 的语义与受控 textarea 一致（扩展层写回同一个 onChange）。
 */
export function ExpandableTextArea({ label, value, placeholder, onChange, minHeight }: {
  label: string
  value: unknown
  placeholder?: string
  onChange(value: string): void
  minHeight?: number
}) {
  const host = useContext(TextExpandContext)
  const text = String(value ?? '')
  return (
    <div className="wf-textarea-wrap">
      <textarea
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        style={minHeight ? { minHeight } : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {host
        ? (
            <button
              type="button"
              className="wf-textarea__expand"
              title={host.expandLabel}
              aria-label={host.expandLabel}
              onClick={() => host.open({ key: label, label, value: text, placeholder, onChange })}
            >
              ⤢
            </button>
          )
        : null}
    </div>
  )
}

/**
 * 扩展编辑层：由布局层挂进画布容器（容器负责铺满中间画布），
 * 自带右上角收起按钮与 Esc 收起。
 */
export function TextExpandOverlay({ copy, request, onClose }: {
  copy: Dict
  request: TextExpandRequest
  onClose(): void
}) {
  const [draft, setDraft] = useState(request.value)
  // 切换到另一个字段时重置为新的字段值；同一字段内的编辑由本地 draft 承载。
  // 只跟随 key：属性栏数据因 draft 写回而刷新时，不得覆盖正在编辑的内容。
  useEffect(() => {
    setDraft(request.value)
  }, [request.key])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="wf-text-expand" role="dialog" aria-label={request.label}>
      <div className="wf-text-expand__head">
        <span className="wf-text-expand__title">{request.label}</span>
        <button
          type="button"
          className="wf-text-expand__collapse"
          title={String(copy.textExpandCollapse)}
          aria-label={String(copy.textExpandCollapse)}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <textarea
        className="wf-text-expand__input"
        value={draft}
        placeholder={request.placeholder}
        spellCheck={false}
        autoFocus
        onChange={(event) => {
          setDraft(event.target.value)
          request.onChange(event.target.value)
        }}
      />
    </div>
  )
}

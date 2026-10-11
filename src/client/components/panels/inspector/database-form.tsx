// src/client/components/panels/inspector/database-form.tsx
//
// 数据库表单（本地 / 服务器）：连接信息 + 检索高级选项。

import { useState } from 'react'
import type { Dict } from '../../../i18n.js'
import { Field } from '../form-field.js'
import { InputField, NameField, TextAreaField } from './form-primitives.js'

export function DatabaseForm({ data, copy, onPatch, onTest }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
  onTest(): void
}) {
  const isServer = data.dbType === 'server'
  const conn = (data.conn ?? {}) as { host?: string; port?: number; user?: string; password?: string; db?: string }
  const vectorOptions = (data.vectorOptions ?? {}) as Record<string, number | undefined>
  /**
   * 已存口令不回显（D07-05）：受控值只承载「本次会话内用户新输入的口令」，失焦即清空，
   * 因此打开属性栏不会把已存明文重新下发到浏览器 DOM。data.conn.password 仍是运行期
   * 事实源（driver.ts 依赖），这里只改展示口径，不改写入时机与字段。
   */
  const [passwordDraft, setPasswordDraft] = useState<string | null>(null)
  const setOpt = (patch: Record<string, number | undefined>): void => onPatch({ vectorOptions: { ...vectorOptions, ...patch } })
  const clampInt = (value: string, min: number, fallback: number, max?: number): number => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < min) return min
    return max === undefined ? n : Math.min(max, n)
  }
  return (
    <div>
      <h3>{copy.nodeKinds.database}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <TextAreaField label={copy.description} value={data.description} placeholder={copy.descriptionHint} onChange={(value) => onPatch({ description: value })} />
      <Field label={copy.dbTypeLabel}>
        <select value={String(data.dbType ?? 'local')} onChange={(event) => onPatch({ dbType: event.target.value })}>
          <option value="local">{copy.dbTypeLocal}</option>
          <option value="server">{copy.dbTypeServer}</option>
        </select>
      </Field>
      {isServer ? (
        <div className="wf-form-grid-1">
          <Field label={copy.dbKindLabel}>
            <select value={String(data.dbKind ?? 'mysql')} onChange={(event) => onPatch({ dbKind: event.target.value })}>
              <option value="mysql">MySQL</option>
              <option value="postgresql">PostgreSQL</option>
            </select>
          </Field>
          <div className="wf-form-grid-wide">
            <InputField label={copy.dbHost} value={conn.host} onChange={(value) => onPatch({ conn: { ...conn, host: value } })} />
            <InputField label={copy.dbPort} type="number" value={conn.port ?? ''} onChange={(value) => onPatch({ conn: { ...conn, port: Number(value) || 0 } })} />
          </div>
          <div className="wf-form-grid-2">
            <InputField label={copy.dbUser} value={conn.user} onChange={(value) => onPatch({ conn: { ...conn, user: value } })} />
            <Field label={copy.dbPassword}>
              <input
                type="password"
                value={passwordDraft ?? ''}
                placeholder={String(conn.password ?? '') === '' ? copy.dbPasswordPlaceholder : copy.dbPasswordStored}
                onChange={(event) => {
                  setPasswordDraft(event.target.value)
                  onPatch({ conn: { ...conn, password: event.target.value } })
                }}
                onBlur={() => setPasswordDraft(null)}
              />
            </Field>
          </div>
          <InputField label={copy.dbName} value={conn.db} onChange={(value) => onPatch({ conn: { ...conn, db: value } })} />
          <div>
            <button type="button" className="wf-btn" onClick={onTest} disabled={!conn.host}>{copy.dbTest}</button>
          </div>
        </div>
      ) : (
        <div className="wf-form-grid-1">
          <InputField label={copy.dbLocalPath} value={data.localPath} placeholder="D:\data\mydb.sqlite" onChange={(value) => onPatch({ localPath: value })} />
          <Field label={copy.dbVectorSource}>
            <select value={String(data.vectorSource ?? 'embedding')} onChange={(event) => onPatch({ vectorSource: event.target.value })}>
              <option value="embedding">{copy.dbVectorEmbedding}</option>
              <option value="bm25">{copy.dbVectorBm25}</option>
            </select>
          </Field>
          <span className="wf-hint">{copy.dbLocalHint}</span>
        </div>
      )}
      {/* 检索高级选项：可折叠，内容读取已配置/默认值显示（不空白），右侧列阈值在上、分块窗口在下 */}
      <details className="wf-advanced">
        <summary>{copy.dbAdvanced}</summary>
        <div className="wf-advanced__content">
          <div className="wf-form-grid-1">
            <div className="wf-form-grid-2">
              <Field label={copy.dbTopK}>
                <input type="number" min={1} max={50} value={Number(vectorOptions.topK ?? 5)} onChange={(event) => setOpt({ topK: clampInt(event.target.value, 1, 5, 50) })} />
              </Field>
              <Field label={copy.dbScoreThreshold}>
                <input type="number" step="0.1" value={Number(vectorOptions.scoreThreshold ?? 0)} onChange={(event) => setOpt({ scoreThreshold: Number(event.target.value) || 0 })} />
              </Field>
            </div>
            <div className="wf-form-grid-2">
              <Field label={copy.dbOverlap}>
                <input type="number" min={0} value={Number(vectorOptions.overlap ?? 128)} onChange={(event) => setOpt({ overlap: clampInt(event.target.value, 0, 0) })} />
              </Field>
              <Field label={copy.dbChunkSize}>
                <input type="number" min={1} value={Number(vectorOptions.chunkSize ?? 384)} onChange={(event) => setOpt({ chunkSize: clampInt(event.target.value, 1, 1) })} />
              </Field>
            </div>
            <Field label={copy.dbMaxRows}>
              <input type="number" min={1} value={Number(vectorOptions.maxRows ?? 10000)} onChange={(event) => setOpt({ maxRows: clampInt(event.target.value, 1, 1) })} />
            </Field>
            <span className="wf-hint wf-form-preline">{copy.dbAdvancedHint}</span>
          </div>
        </div>
      </details>
    </div>
  )
}

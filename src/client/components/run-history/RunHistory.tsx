// src/client/components/run-history/RunHistory.tsx
//
// 运行历史面板（照搬旧项目 run-view.js，TSX 化 + 断点恢复入口）：
// 按 run 记录展示状态/起止时间/节点状态摘要；paused|interrupted 可恢复
// （断点续跑生成新 run，resumedFromRunId 追溯继承链，需求 §4.7）。

import type { Dict } from '../../i18n.js'
import type { RunSnapshot } from '../../../host/shared/types.js'

export interface RunHistoryProps {
  history: RunSnapshot[]
  selectedRunId: string | null
  copy: Dict
  onSelect(id: string): void
  onClose(): void
  onResume(runId: string): void
  canResume: boolean
}

function statusLabel(status: string, copy: Dict): string {
  return String((copy.status as Record<string, string>)[status] ?? status ?? '')
}

function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString()
  } catch {
    return String(value)
  }
}

const RESUMABLE = new Set(['paused', 'interrupted'])

export function RunHistory({ history, selectedRunId, copy, onSelect, onClose, onResume, canResume }: RunHistoryProps) {
  const items = Array.isArray(history) ? history : []
  return (
    <div className="wf-history-backdrop">
      <div className="wf-history" role="dialog" aria-modal="true">
        <h3>{copy.history}</h3>
        {items.length === 0 ? (
          <p style={{ color: 'var(--wf-ink-2)', fontSize: 12 }}>{copy.historyEmpty}</p>
        ) : (
          <div className="wf-history__list">
            {items.map((run) => {
              const resumable = canResume && RESUMABLE.has(run.status)
              return (
                <button
                  key={run.id}
                  type="button"
                  className={`wf-history__item${run.id === selectedRunId ? ' is-active' : ''}`}
                  onClick={() => onSelect(run.id)}
                >
                  <span className="wf-history__title">
                    <span className={`wf-status-dot${run.status === 'running' ? ' is-running' : ''}`} />
                    {`${run.flowName ?? run.flowId}`}
                    {run.resumedFromRunId ? <span className="wf-history__chain">{`${copy.resumedFrom} #${String(run.resumedFromRunId).slice(0, 8)}`}</span> : null}
                  </span>
                  <span className="wf-history__meta">
                    {`${statusLabel(run.status, copy)} · ${formatTime(run.startedAt)}${run.resumeFromNodeId ? ` · ${copy.resumeFromNode} ${run.resumeFromNodeId}` : ''}${run.summary ? ` · ${run.summary}` : ''}`}
                  </span>
                  {run.nodes?.length
                    ? (
                        <span className="wf-history__meta">
                          {run.nodes.map((node) => `${node.nodeId}:${statusLabel(node.status, copy)}`).join('  ')}
                        </span>
                      )
                    : null}
                  {resumable ? (
                    <span className="wf-history__resume">
                      <button
                        type="button"
                        className="wf-btn is-primary"
                        onClick={(event) => { event.stopPropagation(); onResume(run.id) }}
                      >
                        {copy.resumeRun}
                      </button>
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
        <div className="wf-history__actions">
          <button type="button" className="wf-btn" onClick={onClose}>✕</button>
        </div>
      </div>
    </div>
  )
}

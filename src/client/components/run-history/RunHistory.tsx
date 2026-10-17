// src/client/components/run-history/RunHistory.tsx
//
// 运行历史面板（断点恢复入口）：
// 按 run 记录展示状态/起止时间/节点状态摘要；paused|interrupted|stopped 可恢复
// （断点续跑生成新 run，resumedFromRunId 追溯继承链；stopped 可续跑为
// 定时任务阶段用户裁决修正：停止后点「运行/恢复」断点续跑而非从头重跑）。

import type { Dict } from '../../i18n.js'
import type { RunSnapshot } from '../../../host/shared/types.js'
import { statusLabelOf } from '../../lib/status-label.js'
import { Modal } from '../modal/Modal.js'

export interface RunHistoryProps {
  history: RunSnapshot[]
  selectedRunId: string | null
  copy: Dict
  onSelect(id: string): void
  onClose(): void
  onResume(runId: string): void
  canResume: boolean
}

/** 运行历史里的状态文案：词典缺失时回退状态码原文（便于识别新状态）。 */
function statusLabel(status: string, copy: Dict): string {
  return statusLabelOf(copy, status) || String(status ?? '')
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

const RESUMABLE = new Set(['paused', 'interrupted', 'stopped'])

export function RunHistory({ history, selectedRunId, copy, onSelect, onClose, onResume, canResume }: RunHistoryProps) {
  const items = Array.isArray(history) ? history : []
  return (
    <Modal className="wf-history" backdropClassName="wf-history-backdrop" label={String(copy.history)} onClose={onClose}>
      <h3>{copy.history}</h3>
      {items.length === 0 ? (
        <p style={{ color: 'var(--wf-ink-2)', fontSize: 12 }}>{copy.historyEmpty}</p>
      ) : (
        <div className="wf-history__list">
          {items.map((run) => {
            const resumable = canResume && RESUMABLE.has(run.status)
            return (
              // 列表项与「恢复」是两级交互面：外层用 div 承载，避免交互元素嵌套（无效 HTML 与嵌套交互）
              <div
                key={run.id}
                className={`wf-history__item${run.id === selectedRunId ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="wf-history__select"
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
                </button>
                {resumable ? (
                  <span className="wf-history__resume">
                    <button
                      type="button"
                      className="wf-btn is-primary"
                      onClick={() => onResume(run.id)}
                    >
                      {copy.resumeRun}
                    </button>
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      <div className="wf-history__actions">
        <button type="button" className="wf-btn" onClick={onClose}>✕</button>
      </div>
    </Modal>
  )
}

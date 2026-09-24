// src/client/lib/status-label.ts
//
// 状态文案投影（唯一本体）：把状态码投影为词典文案。
// 此前 FlowNode / GroupCard / LeftPanel / SchedulerManager / RunHistory 各自
// 实现同一份 (copy.status as Record<string,string>)[status] 映射，任一处漏改
// 都会造成同一状态在不同位置显示不同文案。
//
// 只依赖最小结构（不引入 i18n/UI 模块）：调用方直接传词典对象即可。

/** 运行/节点状态词典的最小消费面。 */
export interface RunStatusDict {
  status: Record<string, string>
}

/** 定时任务词典的最小消费面。 */
export interface SchedulerStatusDict {
  schedulerStatus: Record<string, string>
  schedulerLastResult: Record<string, string>
}

/** 运行/节点状态文案；未知状态或空值返回空串（调用方按需要回退原文或占位符）。 */
export function statusLabelOf(copy: RunStatusDict, status: string | null | undefined): string {
  if (!status) return ''
  return String(copy.status[status] ?? '')
}

/** 定时任务运行状态文案；未知状态回退状态码本身（便于排查新状态）。 */
export function schedulerStatusLabelOf(copy: SchedulerStatusDict, status: string | null | undefined): string {
  if (!status) return ''
  return String(copy.schedulerStatus[status] ?? status)
}

/** 定时任务最近结果文案；无结果返回占位符「—」。 */
export function schedulerResultLabelOf(copy: SchedulerStatusDict, result: string | null | undefined): string {
  if (!result) return '—'
  return String(copy.schedulerLastResult[result] ?? result)
}

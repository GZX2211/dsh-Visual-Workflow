// src/host/tools/wf-experience-recall/types.ts
//
// wf_experience_recall 的返回契约（两阶段：候选摘要 / 完整经验）。
// 两个阶段由 `kind` 判别，模型据此决定是否需要第二阶段按 id 取回完整内容。

import type { ExperienceEntry } from '../../shared/asset-types.js'

/** 候选条目：只够判断「值不值得完整取回」的摘要。 */
export interface RecallCandidateEntry {
  id: string
  /** 相似度得分（语义检索为单位向量内积；词法回退为 BM25 得分）。 */
  score: number
  /** 由检索层给出的摘要（工具层不重算）。 */
  summary: string
  /** 本次得分来源：semantic 语义检索 / bm25 词法回退。 */
  source: 'semantic' | 'bm25'
}

/** 第一阶段返回体：候选清单与本次生效的检索通道。 */
export interface RecallCandidatesResult {
  kind: 'candidates'
  hits: RecallCandidateEntry[]
  source: 'semantic' | 'bm25'
}

/** 第二阶段返回体：完整经验条目。 */
export interface RecallDetailsResult {
  kind: 'details'
  entries: ExperienceEntry[]
}

export type RecallResult = RecallCandidatesResult | RecallDetailsResult

// src/host/experience/ports.ts
//
// Experience 域对外依赖的最小缝与调用方身份本体。
//
// 为什么域层不直接使用资产库与编排器：经验域需要的是「读写经验行的语义」与「当前运行事实」，
// 而不是某个实现。宿主在组合根把资产库与编排器适配为这里的端口，域层因此可在单测中以
// 受控 fake 运行，也不会出现「域层摸编排器内部 Map」这类反向依赖。
//
// 行形状与判重判据一律复用共享契约（../shared/asset-types.js），本文件不重新定义一份。

import type {
  ExperienceEntry,
  ExperienceGenerationPromptEntry,
  ExperienceInsertCheckedInput,
  ExperiencePatch,
  ExperienceRetrievalUpdate,
  ExperienceType,
} from "../shared/asset-types.js"

/**
 * 调用方身份（唯一本体）。
 *
 * 子代理时 `childId` 为官方子代理会话的 agent.id；父代理省略。
 * 父代理的 `sessionId` 即会话 id；子代理的 `sessionId` 为其父会话 id（用于定位运行所属会话）。
 */
export interface ExperienceCaller {
  isChild: boolean
  sessionId: string
  childId?: string
}

/**
 * 召回与判重所需的活跃经验行（纯数据，禁止把 BLOB 暴露为 Buffer 给域层）。
 *
 * 为什么必须同时带两个通道的向量与检索文本：召回按 §8.2 对任务侧与决策侧分别打分后取并集，
 * 判重只看决策侧；两者读的是同一批行，因此由同一次读盘给出，避免重复查询与两批数据不一致。
 */
export interface ExperienceRetrievalRow {
  id: string
  taskEmbedding: Float64Array
  taskRetrievalText: string
  decisionEmbedding: Float64Array
  decisionRetrievalText: string
}

/** 经验持久化端口（由资产库适配）。 */
export interface ExperienceStorePort {
  /** 生成经验行 id（前缀 id 规则由资产库持有）。 */
  nextId(): string
  /** 取某类型当前生效的生成 Prompt；无则 null。 */
  getActivePrompt(type: ExperienceType): Promise<ExperienceGenerationPromptEntry | null>
  /** 列出全部生成 Prompt（含历史版本与归档）。 */
  listPrompts(): Promise<ExperienceGenerationPromptEntry[]>
  /** 列出经验行（活跃 + 归档，条目自带 active 标记）。 */
  listRows(limit: number): Promise<ExperienceEntry[]>
  /** 按 id 取经验行；activeOnly 时归档行不返回。 */
  getRows(ids: string[], options?: { activeOnly?: boolean }): Promise<ExperienceEntry[]>
  /** 取某类型全部活跃行的检索数据（召回与判重共用）。 */
  listActiveEmbeddings(type: ExperienceType): Promise<ExperienceRetrievalRow[]>
  /** 判重与写入同事务完成；判据由域层注入。 */
  insertChecked(input: ExperienceInsertCheckedInput): Promise<{
    inserted: ExperienceEntry[]
    skipped: Array<{ reason: string; decisionRetrievalText: string }>
  }>
  /**
   * 就地改写语义字段并写入域层在事务外算好的检索投影与向量。
   * 必填字段被清空由资产库拒绝（经验没有版本，改坏无从回滚）。
   */
  updateFields(id: string, patch: ExperiencePatch, next: ExperienceRetrievalUpdate): Promise<ExperienceEntry>
  /** 置活跃 / 归档（两个方向同一操作，避免两套写入路径）。 */
  setActive(id: string, active: boolean): Promise<ExperienceEntry>
}

/**
 * 运行事实端口（由编排器适配）。
 *
 * 语义固定为「当前运行实例内」：会话的活跃 run、子代理所属 run、本 run 内是否启动过协作组。
 */
export interface ExperienceRuntimePort {
  activeRunForSession(sessionId: string): { runId: string; flowId: string; sessionId: string } | null
  runForChild(childId: string): { runId: string; flowId: string; sessionId: string; nodeId: string } | null
  hasTeamInCurrentRun(sessionId: string): boolean
  hasActiveRun(sessionId: string): boolean
}

/**
 * 语义嵌入端口（由嵌入引擎适配）。
 *
 * `source === "bm25"` 表示嵌入能力已退化：此时无向量可用，召回走词法回退、写入直接拒绝，
 * 因此 source 是能力事实而非实现细节，必须在端口上可见。
 */
export interface ExperienceEmbeddingPort {
  readonly source: "local" | "remote" | "bm25"
  readonly dimension: number
  embed(texts: string[]): Promise<Float64Array[]>
}

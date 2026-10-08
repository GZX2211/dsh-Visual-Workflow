// src/host/assets/embedding-blob.ts
//
// 向量列的进出编码（BLOB ↔ Float64Array）。
//
// 为什么读侧必须严格校验：磁盘上的字节可能来自手工改库、写入中断或换模型后的旧行，
// 悄悄截断或补零会产出「维度看似合法、数值其实错位」的向量，让召回给出看起来正常的
// 错误排序。因此任何一处不可信就判为「无向量」并给出原因，由调用方按各自语义降级
// （本模块只保证列表读不因此崩掉）。

import { experienceBadArgs } from "./errors.js"

/** Float64 的固定字节数：维度与字节长度互为校验的唯一依据。 */
const FLOAT64_BYTES = 8

/** 解码结论：`vector` 为 null 表示该列不可用作向量，`reason` 说明不可用的原因。 */
export interface EmbeddingDecode {
  vector: Float64Array | null
  reason: string | null
}

/**
 * 向量 → BLOB；空向量（长度 0）表示当前没有向量能力，返回 null 落 NULL 列。
 *
 * 非有限数值直接拒绝（抛可行动错误）：NaN / Infinity 入库后无法与任何向量比较，
 * 还会污染内积结果，属于必须让调用方看到的数据缺陷，不能静默写入。
 */
export function encodeEmbedding(vector: Float64Array): Buffer | null {
  if (vector.length === 0) return null
  for (let index = 0; index < vector.length; index += 1) {
    if (!Number.isFinite(vector[index])) {
      throw experienceBadArgs(`经验向量第 ${index + 1} 个分量不是有限数值：请检查嵌入模型输出后重试`)
    }
  }
  // 复制一份字节：入参视图的缓冲可能被调用方复用，直接落库会写入后续被改写的内容
  return Buffer.from(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength))
}

/** BLOB → 向量；字节长度不是 8 的倍数或与记录维度不符即判为无向量。 */
export function decodeEmbedding(blob: unknown, dimension: number | null): EmbeddingDecode {
  if (blob === null || blob === undefined) return { vector: null, reason: "该行没有向量列值" }
  if (!(blob instanceof Uint8Array)) return { vector: null, reason: "向量列不是二进制值" }
  if (blob.byteLength === 0) return { vector: null, reason: "向量列为空" }
  if (blob.byteLength % FLOAT64_BYTES !== 0) {
    return { vector: null, reason: `向量字节长度 ${blob.byteLength} 不是 ${FLOAT64_BYTES} 的整数倍` }
  }
  const length = blob.byteLength / FLOAT64_BYTES
  if (dimension !== null && dimension !== length) {
    return { vector: null, reason: `向量维度 ${length} 与记录维度 ${dimension} 不一致` }
  }
  // 复制到独立缓冲再建视图：驱动返回的视图未保证 8 字节对齐，直接建视图会抛 RangeError
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  const vector = new Float64Array(copy.buffer)
  for (let index = 0; index < vector.length; index += 1) {
    if (!Number.isFinite(vector[index])) return { vector: null, reason: `向量第 ${index + 1} 个分量不是有限数值` }
  }
  return { vector, reason: null }
}

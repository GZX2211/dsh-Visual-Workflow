// src/host/experience/embedding-codec.ts
//
// 经验向量列（BLOB）与 Float64Array 的编解码。
//
// 为什么必须严格拒绝而不是容错：向量被截断或补零后仍然是「一条合法向量」，判重与召回会
// 静默给出错误结论且无任何症状可发现。因此维度、字节长度（8 的倍数）、有限值三项都硬校验，
// 错误消息给出实际值与期望值，让调用方能定位到写坏的来源。

import { WfError } from "../orchestrator/errors.js"
import { ERR_EXPERIENCE_VALIDATION } from "../shared/protocol.js"

/** 单个数值的字节数（双精度）。 */
const BYTES_PER_VALUE = 8

function assertDimension(dimension: number, action: string): void {
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new WfError(
      `向量维度必须是正整数（实际为 ${String(dimension)}）：无法${action}，请检查经验行的 embedding_dimension 与嵌入端口声明的维度。`,
      ERR_EXPERIENCE_VALIDATION,
    )
  }
}

function nonFiniteError(position: number, value: number): WfError {
  return new WfError(
    `向量第 ${position} 个数值为 ${String(value)}（不是有限值）：经验向量已损坏或来源异常，请重新生成该经验的向量后重试（不会做截断或补零）。`,
    ERR_EXPERIENCE_VALIDATION,
  )
}

/** 编码为 BLOB 字节：维度必须与数值个数一致，且全部数值有限。 */
export function encodeEmbedding(vector: Float64Array, dimension: number): Buffer {
  assertDimension(dimension, "编码")
  if (vector.length !== dimension) {
    throw new WfError(
      `向量维度不符：声明 dimension=${dimension}，实际有 ${vector.length} 个数值；编码不会截断或补零，请按 embedding_dimension 重新生成向量。`,
      ERR_EXPERIENCE_VALIDATION,
    )
  }
  const copy = new Float64Array(dimension)
  for (let index = 0; index < dimension; index += 1) {
    const value = vector[index]
    if (!Number.isFinite(value)) throw nonFiniteError(index + 1, value)
    copy[index] = value
  }
  return Buffer.from(copy.buffer)
}

/** 解码 BLOB 字节：字节长度必须是 8 的倍数且与声明维度一致，且全部数值有限。 */
export function decodeEmbedding(buffer: Uint8Array, dimension: number): Float64Array {
  assertDimension(dimension, "解码")
  const byteLength = buffer.byteLength
  if (byteLength % BYTES_PER_VALUE !== 0) {
    throw new WfError(
      `向量字节长度 ${byteLength} 不是 ${BYTES_PER_VALUE} 的倍数：BLOB 已损坏或以其它精度写入，无法解码（不会做截断或补零）。`,
      ERR_EXPERIENCE_VALIDATION,
    )
  }
  const count = byteLength / BYTES_PER_VALUE
  if (count !== dimension) {
    throw new WfError(
      `向量维度不符：声明 dimension=${dimension}，字节长度 ${byteLength} 对应 ${count} 个数值；解码不会截断或补零，请检查 embedding_dimension 与向量列是否一致。`,
      ERR_EXPERIENCE_VALIDATION,
    )
  }
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, byteLength)
  const out = new Float64Array(dimension)
  for (let index = 0; index < dimension; index += 1) {
    const value = bytes.readDoubleLE(index * BYTES_PER_VALUE)
    if (!Number.isFinite(value)) throw nonFiniteError(index + 1, value)
    out[index] = value
  }
  return out
}

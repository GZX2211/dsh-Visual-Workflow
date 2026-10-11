// src/host/experience/embedding-codec.ts
//
// 经验向量列（BLOB）与 Float64Array 的编解码。
//
// 为什么必须严格拒绝而不是容错：向量被截断或补零后仍然是「一条合法向量」，判重与召回会
// 静默给出错误结论且无任何症状可发现。因此维度、字节长度（8 的倍数）、有限值三项都硬校验，
// 错误消息给出实际值与期望值，让调用方能定位到写坏的来源。
//
// 模型可见文案规范（docs/model-facing-surface-rules §3）：全英文且稳定码写在 message 文本里。

import { WfError } from "../orchestrator/errors.js"
import { ERR_EXPERIENCE_VALIDATION } from "../shared/protocol.js"

/** 单个数值的字节数（双精度）。 */
const BYTES_PER_VALUE = 8

/** 编解码错误出口：稳定码写进 message 文本（模型看不到 error.code）。 */
function codecError(message: string): WfError {
  return new WfError(`${ERR_EXPERIENCE_VALIDATION}: ${message}`, ERR_EXPERIENCE_VALIDATION)
}

function assertDimension(dimension: number, action: string): void {
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw codecError(
      `the vector dimension must be a positive integer (received ${String(dimension)}), so the vector cannot be ${action}; check the row's embedding_dimension against the dimension declared by the embedding port.`,
    )
  }
}

function nonFiniteError(position: number, value: number): WfError {
  return codecError(
    `vector value #${position} is ${String(value)}, which is not finite; the stored vector is corrupted or came from a bad source — regenerate that experience's vector and retry (values are never truncated or zero-padded).`,
  )
}

/** 编码为 BLOB 字节：维度必须与数值个数一致，且全部数值有限。 */
export function encodeEmbedding(vector: Float64Array, dimension: number): Buffer {
  assertDimension(dimension, "encoded")
  if (vector.length !== dimension) {
    throw codecError(
      `the vector dimension does not match: dimension=${dimension} was declared but the vector holds ${vector.length} values; encoding never truncates or zero-pads, so regenerate the vector to match embedding_dimension.`,
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
  assertDimension(dimension, "decoded")
  const byteLength = buffer.byteLength
  if (byteLength % BYTES_PER_VALUE !== 0) {
    throw codecError(
      `the vector byte length ${byteLength} is not a multiple of ${BYTES_PER_VALUE}; the BLOB is corrupted or was written with a different precision, so it cannot be decoded (values are never truncated or zero-padded).`,
    )
  }
  const count = byteLength / BYTES_PER_VALUE
  if (count !== dimension) {
    throw codecError(
      `the vector dimension does not match: dimension=${dimension} was declared but the byte length ${byteLength} holds ${count} values; decoding never truncates or zero-pads, so check embedding_dimension against the vector column.`,
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


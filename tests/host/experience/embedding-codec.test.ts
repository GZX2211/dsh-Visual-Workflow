// tests/host/experience/embedding-codec.test.ts
//
// 向量 BLOB 编解码门。
//
// 为什么必须严格到「拒绝」而不是容错：向量列一旦被截断或补零，读到的是**另一条**向量，
// 判重与召回都会给出错误结论，且没有任何症状可被发现。因此维度、字节长度、有限值三项
// 一律硬校验，错误消息给出实际值与期望值。

import { describe, expect, it } from "vitest"
import { ERR_EXPERIENCE_VALIDATION } from "../../../src/host/shared/protocol.js"
import { decodeEmbedding, encodeEmbedding } from "../../../src/host/experience/embedding-codec.js"
import { errorOf } from "./fixtures/assertions.js"

describe("encodeEmbedding / decodeEmbedding 往返", () => {
  it("test_编码解码_往返得到同值向量", () => {
    const vector = new Float64Array([0, 1, -1, 0.5, Number.MIN_VALUE, 1e-12])

    const decoded = decodeEmbedding(encodeEmbedding(vector, 6), 6)

    expect([...decoded]).toEqual([...vector])
  })

  it("test_编码_字节长度等于维度乘 8", () => {
    const buffer = encodeEmbedding(new Float64Array(4), 4)

    expect(buffer.byteLength).toBe(32)
  })
})

describe("encodeEmbedding 非法输入", () => {
  it("test_编码_维度与向量长度不符_拒绝且不补零", async () => {
    const error = await errorOf(() => encodeEmbedding(new Float64Array(3), 4))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("4")).toBe(true)
    expect(error.message.includes("3")).toBe(true)
  })

  it("test_编码_含 NaN_拒绝", async () => {
    const error = await errorOf(() => encodeEmbedding(new Float64Array([1, Number.NaN]), 2))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("NaN")).toBe(true)
  })

  it("test_编码_含 Infinity_拒绝", async () => {
    const error = await errorOf(() => encodeEmbedding(new Float64Array([1, Number.POSITIVE_INFINITY]), 2))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
  })

  it("test_编码_维度为零_拒绝", async () => {
    const error = await errorOf(() => encodeEmbedding(new Float64Array(0), 0))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
  })
})

describe("decodeEmbedding 非法输入", () => {
  it("test_解码_字节长度非 8 的倍数_拒绝", async () => {
    const error = await errorOf(() => decodeEmbedding(Buffer.alloc(12), 2))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("12")).toBe(true)
  })

  it("test_解码_维度与字节长度不符_拒绝且不截断", async () => {
    const buffer = encodeEmbedding(new Float64Array([1, 2, 3]), 3)

    const error = await errorOf(() => decodeEmbedding(buffer, 2))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
    expect(error.message.includes("2")).toBe(true)
  })

  it("test_解码_非有限值_拒绝", async () => {
    const buffer = encodeEmbedding(new Float64Array([1, 2]), 2)
    buffer.writeDoubleLE(Number.NaN, 8)

    const error = await errorOf(() => decodeEmbedding(buffer, 2))

    expect(error.code).toBe(ERR_EXPERIENCE_VALIDATION)
  })
})

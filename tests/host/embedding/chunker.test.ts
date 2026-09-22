// tests/host/embedding/chunker.test.ts
//
// 文本分块纯函数单测（T-025）：窗口/步长/重叠/空白归一化/边界/参数非法 fail-fast。

import { describe, expect, it } from 'vitest'
import { chunkText, normalizeWhitespace } from '../../../src/host/embedding/chunker.js'

describe('chunkText 分块', () => {
  it('空/空白文本 → 空数组', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\t ')).toEqual([])
  })

  it('长度 ≤ chunkSize → 单块（内容归一化）', () => {
    const chunks = chunkText(' 你好   世界 ')
    expect(chunks).toEqual([{ index: 0, text: '你好 世界' }])
  })

  it('长文本按步长切窗：size=10 overlap=4 → step=6，末块保留', () => {
    const text = '0123456789ABCDEFGHIJ' // 20 字符
    const chunks = chunkText(text, 10, 4)
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3])
    expect(chunks[0].text).toBe('0123456789')
    expect(chunks[1].text).toBe('6789ABCDEF')
    expect(chunks[3].text).toBe('IJ')
  })

  it('overlap ≥ chunkSize 抛 RangeError（fail-fast：拒绝步长 ≤ 0 的参数组合）', () => {
    // 旧实现把步长钳为 1，生成数量接近文本长度的巨量块（长文本内存飙升）；
    // 修复后直接抛错，让调用方在源头修正参数（护栏 fail-closed）
    expect(() => chunkText('abcdef', 3, 10)).toThrow(RangeError)
    expect(() => chunkText('abcdef', 3, 3)).toThrow(RangeError)
    expect(() => chunkText('abcdef', 3, 100)).toThrow(/overlap.*必须小于.*chunkSize/)
  })

  it('默认参数：384 字符/重叠 128；1000 字符文本块数正确', () => {
    const text = '测'.repeat(1000)
    const chunks = chunkText(text)
    const step = 384 - 128
    const expected = Math.ceil((1000 - 384) / step) + 1
    expect(chunks.length).toBe(expected)
    expect(chunks[0].text.length).toBe(384)
  })

  it('normalizeWhitespace 折叠连续空白并 trim', () => {
    expect(normalizeWhitespace(' a\n\t b  c ')).toBe('a b c')
  })
})

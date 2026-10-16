// tests/host/prompts/render.test.ts
//
// 提示词模板渲染器的**机制测试**：只覆盖「占位符与可选块如何渲染」的行为，
// 不涉及任何提示词正文内容（正文可随时修改，不应触发测试失败）。

import { describe, expect, it } from 'vitest'
import { flag, renderTemplate } from '../../../src/host/prompts/index.js'

describe('renderTemplate（模板渲染机制）', () => {
  it('变量替换：{{name}} 替换为对应值', () => {
    expect(renderTemplate('A {{x}} B', { x: 'v' })).toBe('A v B')
  })

  it('缺失变量替换为空串（不留占位符）', () => {
    expect(renderTemplate('A{{x}}B', {})).toBe('AB')
  })

  it('可选块：真值保留块体，假值整块消失', () => {
    expect(renderTemplate('A{{#if x}}KEEP{{/if}}B', { x: '1' })).toBe('AKEEPB')
    expect(renderTemplate('A{{#if x}}KEEP{{/if}}B', {})).toBe('AB')
  })

  it('可选块支持嵌套（按最内层先处理配对）', () => {
    const template = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}'
    expect(renderTemplate(template, { a: '1', b: '1' })).toBe('AB')
    expect(renderTemplate(template, { a: '1' })).toBe('A')
    expect(renderTemplate(template, {})).toBe('')
  })

  it('块不配对时抛错（不得静默吞掉）', () => {
    expect(() => renderTemplate('{{#if a}}x', { a: '1' })).toThrow()
  })

  it('渲染后仍有未替换占位符时抛错（变量名写错必须可见）', () => {
    expect(() => renderTemplate('{{未知}}', {})).toThrow()
  })

  it('纯函数：同一入参两次渲染结果相同', () => {
    const template = '{{#if x}}{{v}}{{/if}}'
    const vars = { x: '1', v: '值' }
    expect(renderTemplate(template, vars)).toBe(renderTemplate(template, vars))
  })

  it('flag：真值渲染为 1，假值渲染为空串', () => {
    expect(flag(true)).toBe('1')
    expect(flag(false)).toBe('')
  })
})

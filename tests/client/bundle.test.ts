// tests/client/bundle.test.ts
//
// 导入导出 v2 辅助（T-051）：格式常量；工作流 bundle / 角色模板 bundle 判定；
// 深拷贝消毒（导入数据与源对象无引用共享）。

import { describe, expect, it } from 'vitest'
import { BUNDLE_FORMAT, BUNDLE_VERSION, TEMPLATE_FORMAT, isRoleTemplateBundle, isWorkflowBundle, safeClone } from '../../src/client/lib/bundle.js'

describe('bundle 导入导出 v2 辅助', () => {
  it('格式常量与后端契约一致', () => {
    expect(BUNDLE_FORMAT).toBe('dsh-vw-bundle')
    expect(TEMPLATE_FORMAT).toBe('dsh-vw-template')
    expect(BUNDLE_VERSION).toBe(2)
  })

  it('工作流 bundle 判定：format + workflow 同时存在；缺一为假；非法 JSON 为假', () => {
    expect(isWorkflowBundle(JSON.stringify({ format: 'dsh-vw-bundle', version: 2, mode: 'mode1', workflow: { name: 'x', nodes: [], lines: [] } }))).toBe(true)
    expect(isWorkflowBundle(JSON.stringify({ format: 'dsh-vw-bundle', version: 2 }))).toBe(false)
    expect(isWorkflowBundle(JSON.stringify({ workflow: { name: 'x' } }))).toBe(false)
    expect(isWorkflowBundle('{bad json')).toBe(false)
  })

  it('角色模板 bundle 判定：format + template 同时存在；非法 JSON 为假', () => {
    expect(isRoleTemplateBundle(JSON.stringify({ format: 'dsh-vw-template', version: 2, template: { id: 'r-1', name: '研究员' } }))).toBe(true)
    expect(isRoleTemplateBundle(JSON.stringify({ format: 'dsh-vw-template' }))).toBe(false)
    expect(isRoleTemplateBundle(JSON.stringify({ template: { id: 'r-1' } }))).toBe(false)
    expect(isRoleTemplateBundle('')).toBe(false)
  })

  it('safeClone：深拷贝剥离引用（模板修改不影响导入副本）', () => {
    const source = { nodes: [{ data: { label: 'a' } }] }
    const cloned = safeClone(source)
    expect(cloned).toEqual(source)
    cloned.nodes[0].data.label = 'b'
    expect(source.nodes[0].data.label).toBe('a')
    expect(cloned).not.toBe(source)
  })
})

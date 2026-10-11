// tests/client/lib/bundle.test.ts
//
// 导入导出 v2 辅助（T-051）：角色模板格式常量与角色模板 bundle 判定。

import { describe, expect, it } from 'vitest'
import { TEMPLATE_FORMAT, isRoleTemplateBundle } from '../../../src/client/lib/bundle.js'

describe('bundle 导入导出 v2 辅助', () => {
  it('格式常量与后端契约一致', () => {
    expect(TEMPLATE_FORMAT).toBe('dsh-vw-template')
  })

  it('角色模板 bundle 判定：format + template 同时存在；非法 JSON 为假', () => {
    expect(isRoleTemplateBundle(JSON.stringify({ format: 'dsh-vw-template', version: 2, template: { id: 'r-1', name: '研究员' } }))).toBe(true)
    expect(isRoleTemplateBundle(JSON.stringify({ format: 'dsh-vw-template' }))).toBe(false)
    expect(isRoleTemplateBundle(JSON.stringify({ template: { id: 'r-1' } }))).toBe(false)
    expect(isRoleTemplateBundle('')).toBe(false)
  })
})

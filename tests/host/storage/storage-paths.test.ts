// tests/host/storage/storage-paths.test.ts
//
// 数据目录布局与路径计算测试（T-012 拆分）：目录常量与各资源路径。
// 其中 safeFilePart 是安全关键纯函数（防路径穿越），必须逐类断言。
// 断言依据：src/host/storage/AGENTS.md「状态所有权」。

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DIRS,
  NESTED_DIRS,
  combosPath,
  flowTemplatePath,
  orchestrationPath,
  runsPath,
  safeFilePart,
  servicePath,
  sessionsPath,
  templateDir,
  templatePath,
  workflowPath,
} from '../../../src/host/storage/storage-paths.js'

const ROOT = join('C:', 'data', 'vw')

describe('safeFilePart 文件名消毒', () => {
  it('保留合法字符（字母/数字/点/下划线/连字符）', () => {
    expect(safeFilePart('flow-1_a.b')).toBe('flow-1_a.b')
  })

  it('非法字符替换为下划线', () => {
    expect(safeFilePart('a b')).toBe('a_b')
    // 每个非 [a-zA-Z0-9._-] 字符各替换为一个下划线（「角色@」→ 三个下划线）
    expect(safeFilePart('角色@1')).toBe('___1')
  })

  it('路径分隔符被消除（防路径穿越）', () => {
    expect(safeFilePart('../../etc/passwd')).not.toContain('/')
    expect(safeFilePart('..\\..\\windows')).not.toContain('\\')
    expect(safeFilePart('a/b')).toBe('a_b')
  })

  it('空值与目录占位（. / ..）替换为下划线', () => {
    expect(safeFilePart('')).toBe('_')
    expect(safeFilePart('.')).toBe('_')
    expect(safeFilePart('..')).toBe('_')
  })

  it('非字符串入参经 String 强制转换后消毒（调用方仍须先行校验 id 非空）', () => {
    // 行为说明（非新增契约）：消毒是最后一道防线，仅保证不产生非法文件名或路径分隔符；
    // 空 id 由各 save*/get* 入口显式抛错拦截，不依赖本函数兜底语义。
    expect(safeFilePart(null)).toBe('null')
    expect(safeFilePart(undefined)).toBe('undefined')
    expect(safeFilePart('a/b')).not.toContain('/')
  })
})

describe('目录布局常量', () => {
  it('顶层 DIRS 不含路径片段（嵌套目录由 NESTED_DIRS 表达）', () => {
    for (const dir of DIRS) {
      expect(dir.includes('/'), `顶层目录不应含路径分隔符：${dir}`).toBe(false)
    }
  })

  it('NESTED_DIRS 的父目录属于顶层 DIRS', () => {
    for (const nested of NESTED_DIRS) {
      expect(DIRS).toContain(nested.split('/')[0])
    }
    expect(NESTED_DIRS).toContain('data/files')
  })
})

describe('资源路径计算', () => {
  it('工作流/服务/映射文件路径带 .json 后缀且落在对应目录', () => {
    expect(workflowPath(ROOT, 'f1')).toBe(join(ROOT, 'workflows', 'f1.json'))
    expect(servicePath(ROOT, 'svc1')).toBe(join(ROOT, 'services', 'svc1.json'))
    expect(sessionsPath(ROOT, 'svc1')).toBe(join(ROOT, 'services', 'svc1.sessions.json'))
  })

  it('模板路径按种类分目录（role→roles / group→groups / 其余→data）', () => {
    expect(templateDir('role')).toBe('roles')
    expect(templateDir('group')).toBe('groups')
    expect(templateDir('file')).toBe('data')
    expect(templateDir('database')).toBe('data')
    expect(templatePath(ROOT, 'role', 'r1')).toBe(join(ROOT, 'roles', 'r1.json'))
    expect(templatePath(ROOT, 'database', 'd1')).toBe(join(ROOT, 'data', 'd1.json'))
  })

  it('工作流模板/run/编排事实源/组合文件路径', () => {
    expect(flowTemplatePath(ROOT, 'tpl1')).toBe(join(ROOT, 'flow-templates', 'tpl1.json'))
    expect(runsPath(ROOT, 'run1')).toBe(join(ROOT, 'runs', 'run1.json'))
    expect(orchestrationPath(ROOT, 'run1')).toBe(join(ROOT, 'orchestrations', 'run1.json'))
    expect(combosPath(ROOT)).toBe(join(ROOT, 'combos.json'))
  })

  it('id 一律经消毒后才拼进文件名（穿越尝试不会逃出数据目录）', () => {
    const escaped = workflowPath(ROOT, '../../outside')
    expect(escaped).toBe(join(ROOT, 'workflows', '.._.._outside.json'))
    // 消毒后仍是 ROOT/workflows 下的直接子文件
    expect(escaped.startsWith(join(ROOT, 'workflows'))).toBe(true)
  })
})

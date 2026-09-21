// tests/host/tools/infrastructure/define-tool.test.ts
//
// Tool DSL（define-tool.ts）单测：参数/输出 schema 编译契约、必填与非法 spec 的错误语义、
// timeoutMs 的取值边界。渲染函数用最简 text 块替身，避免依赖具体业务输出。

import { describe, expect, it } from 'vitest'
import { defineTool } from '../../../../src/host/tools/infrastructure/define-tool.js'

/** 最简合法定义（仅 name/description/空参数/常量输出）。 */
function minimal(extra: Record<string, unknown> = {}) {
  return {
    name: 'wf_test',
    description: 'A test tool used only by the DSL unit tests.',
    parameters: {},
    output: { schema: { type: 'string' as const }, render: () => [{ type: 'text' as const, text: 'ok' }] },
    execute: () => 'ok',
    ...extra,
  }
}

describe('defineTool DSL', () => {
  it('name/description 必填：空白值抛 TypeError', () => {
    expect(() => defineTool(minimal({ name: '  ' }) as never)).toThrow('name 必填')
    expect(() => defineTool(minimal({ description: '' }) as never)).toThrow('description 必填')
  })

  it('参数根为隐式开放对象：不设 additionalProperties，内联 required 提取为数组', () => {
    const def = defineTool(minimal({
      parameters: {
        nodeId: { type: 'string', required: true, description: 'id' },
        topK: { type: 'number' },
      },
    }) as never)
    expect(def.parameters.type).toBe('object')
    expect(def.parameters.additionalProperties).toBeUndefined()
    expect(def.parameters.required).toEqual(['nodeId'])
    expect((def.parameters.properties ?? {}).nodeId).toEqual({ type: 'string', description: 'id' })
  })

  it('对象 spec 必须显式声明 additionalProperties：缺失抛 TypeError', () => {
    expect(() =>
      defineTool(minimal({ output: { schema: { type: 'object', properties: {} }, render: () => [] } }) as never),
    ).toThrow('additionalProperties')
  })

  it('无法识别的 spec：抛 TypeError 且错误文本带上 spec 内容', () => {
    expect(() => defineTool(minimal({ output: { schema: { enum: ['a'] }, render: () => [] } }) as never)).toThrow(
      '无法识别的 schema spec',
    )
  })

  it('output.schema 编译：enum 复制为数组、数组 items 递归编译、对象 required 提取', () => {
    const def = defineTool(minimal({
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['ok', 'fail'] as const, required: true },
            hits: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        },
        render: () => [],
      },
    }) as never)
    expect(def.output.schema.additionalProperties).toBe(false)
    expect(def.output.schema.required).toEqual(['status'])
    const status = (def.output.schema.properties ?? {}).status
    expect(status).toMatchObject({ type: 'string', enum: ['ok', 'fail'] })
    // minItems 属非官方子集关键字：仅在显式声明时透传（parameters 不校验）
    expect((def.output.schema.properties ?? {}).hits).toMatchObject({ type: 'array', minItems: 1 })
    expect(((def.output.schema.properties ?? {}).hits?.items as { type?: string }).type).toBe('string')
  })

  it('timeoutMs：仅接受正有限数，其余不写入定义', () => {
    expect(defineTool(minimal({ timeoutMs: 1500 }) as never).timeoutMs).toBe(1500)
    expect(defineTool(minimal({ timeoutMs: 0 }) as never).timeoutMs).toBeUndefined()
    expect(defineTool(minimal({ timeoutMs: Number.NaN }) as never).timeoutMs).toBeUndefined()
  })

  it('execute 与 render 原样挂到定义对象（不额外包装）', async () => {
    const execute = async () => ({ ok: true })
    const render = () => [{ type: 'text' as const, text: 'done' }]
    const def = defineTool(minimal({ execute, output: { schema: { type: 'string' as const }, render } }) as never)
    expect(def.execute).toBe(execute)
    expect(def.output.render).toBe(render)
  })
})

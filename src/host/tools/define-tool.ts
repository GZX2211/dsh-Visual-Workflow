// src/host/tools/define-tool.ts
//
// 本地 defineTool DSL 帮手：把「类型化参数/输出 schema」编译为工具注册对象。
//
// 为什么自研而非 import 官方 @deepseek-ai/dsh-tools：插件遵循零官方包运行时
// 依赖原则——所有 @deepseek-ai/* 仅经 ctx.get() 运行时解析，dependencies 只允许
// 本地嵌入推理库。官方 defineTool 只是「参数 DSL → 注册对象」的纯函数帮手，
// 因此按官方 DSL 语义本地实现等价纯函数：
//   - parameters：隐式开放参数对象根，属性内联 `required: true`；
//   - output.schema：值 schema（对象属性内联 required 编译为 JSON Schema
//     required 数组）；
//   - 产物为纯对象定义（官方工具注册表接受纯定义对象）。
// 这样代码形态与官方一致（可对照取证），同时保持零官方包运行时依赖。
//
// 支持子集：string/number/integer/boolean/null/enum/const/array/object/oneOf；
// 其余原语按需再扩。schema 深度受工具定义自身约束（固定且浅），直接递归安全。

/** JSON Schema 节点（官方支持子集的超集）。 */
export interface JsonSchemaNode {
  type?: string
  additionalProperties?: boolean
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  enum?: unknown[]
  const?: unknown
  oneOf?: JsonSchemaNode[]
  minItems?: number
  maxItems?: number
  description?: string
}

/** 标量类型 spec。 */
export interface ScalarSpec {
  type: string
  /** 枚举约束（仅标量合法）。 */
  enum?: readonly unknown[]
  description?: string
}

/** 常量 spec（只允许精确值）。 */
export interface ConstSpec {
  const: unknown
  description?: string
}

/** 对象 spec：必须显式声明 additionalProperties（与官方 DSL 强制一致）。 */
export interface ObjectSpec {
  type: 'object'
  additionalProperties: boolean
  properties?: Record<string, PropertySpec>
  description?: string
}

/** 数组 spec：items 为元素 spec。 */
export interface ArraySpec {
  type: 'array'
  items: PropertySpec
  minItems?: number
  maxItems?: number
  description?: string
}

/** 互斥联合 spec（exact-one oneOf）。 */
export interface OneOfSpec {
  oneOf: ValueSchemaSpec[]
  description?: string
}

/** 值 schema spec（output.schema 根）。 */
export type ValueSchemaSpec = ScalarSpec | ConstSpec | ObjectSpec | ArraySpec | OneOfSpec

/**
 * 属性 spec：值 spec + 内联 `required: true` + description。
 * 注意：必须为交叉类型而非 interface extends 联合——TS 不允许接口继承联合类型，
 * 且交叉类型能让对象字面量属性（含 type/required）被索引签名接受。
 */
export type PropertySpec = ValueSchemaSpec & {
  /** 内联必填标记（编译时提取进父对象 required 数组）。 */
  required?: boolean
}

/** 工具执行上下文最小形状（官方 ToolExecution 子集：signal/agent 必须）。 */
export interface ToolExecLike {
  /** 调用方持有的取消信号（只读必填）。 */
  readonly signal: AbortSignal
  /** 调用 Agent（会话根或子代理；身份/归属校验用）。 */
  readonly agent?: unknown
  /** 调用唯一标识（日志/审计）。 */
  readonly callId?: string
}

/** 工具定义产物（官方 ToolDefinition 的最小结构适配，供 ctx.tools.register）。 */
export interface ToolDefinitionLike<Args extends Record<string, unknown> = Record<string, unknown>, Value = unknown> {
  name: string
  description: string
  /** 编译后的参数 JSON Schema（隐式开放根：不设 additionalProperties）。 */
  parameters: JsonSchemaNode
  output: {
    schema: JsonSchemaNode
    render: (args: Args, value: Value) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: Args, exec: ToolExecLike) => unknown | Promise<unknown>
  timeoutMs?: number
}

/** 编译单个属性 spec：剥离 required 标记后递归编译值。 */
function compileProperty(spec: PropertySpec): JsonSchemaNode {
  const { required: _required, ...rest } = spec as PropertySpec & { required?: boolean }
  return compileValue(rest as ValueSchemaSpec)
}

/** 编译值 spec（对象属性内联 required 提取为 required 数组）。 */
export function compileValue(spec: ValueSchemaSpec): JsonSchemaNode {
  if (typeof spec !== 'object' || spec === null) {
    throw new TypeError('defineTool: 非法的 schema spec（必须为对象）')
  }
  const desc = (spec as { description?: string }).description
  const withDesc = (node: JsonSchemaNode): JsonSchemaNode =>
    typeof desc === 'string' && desc ? { ...node, description: desc } : node

  if ('oneOf' in spec && Array.isArray(spec.oneOf)) {
    return withDesc({ oneOf: spec.oneOf.map((item) => compileValue(item)) })
  }
  if ('const' in spec) {
    return withDesc({ const: spec.const })
  }
  if ('type' in spec) {
    const type = (spec as { type: string }).type
    if (type === 'object') {
      const objectSpec = spec as ObjectSpec
      if (typeof objectSpec.additionalProperties !== 'boolean') {
        throw new TypeError('defineTool: 对象 spec 必须显式声明 additionalProperties: true | false')
      }
      const node: JsonSchemaNode = {
        type: 'object',
        additionalProperties: objectSpec.additionalProperties,
      }
      if (objectSpec.properties) {
        const properties: Record<string, JsonSchemaNode> = {}
        const required: string[] = []
        for (const [key, prop] of Object.entries(objectSpec.properties)) {
          properties[key] = compileProperty(prop)
          if (prop.required === true) required.push(key)
        }
        node.properties = properties
        if (required.length > 0) node.required = required
      }
      return withDesc(node)
    }
    if (type === 'array') {
      const arraySpec = spec as ArraySpec
      const node: JsonSchemaNode = { type: 'array', items: compileProperty(arraySpec.items) }
      if (arraySpec.minItems !== undefined) node.minItems = arraySpec.minItems
      if (arraySpec.maxItems !== undefined) node.maxItems = arraySpec.maxItems
      return withDesc(node)
    }
    const scalar = spec as ScalarSpec
    const node: JsonSchemaNode = { type: scalar.type }
    if (scalar.enum !== undefined) node.enum = [...scalar.enum]
    return withDesc(node)
  }
  throw new TypeError(`defineTool: 无法识别的 schema spec：${JSON.stringify(spec)}`)
}

/**
 * 定义并编译一个工具（官方 defineTool DSL 语义的本地等价实现）。
 * 参数根为隐式开放对象（不设 additionalProperties，默认开放）。
 */
export function defineTool<Args extends Record<string, unknown> = Record<string, unknown>, Value = unknown>(def: {
  name: string
  description: string
  /** 参数 DSL：属性内联 required: true。 */
  parameters: Record<string, PropertySpec>
  output: {
    /** 值 schema DSL（对象属性内联 required）。 */
    schema: ValueSchemaSpec
    /** 输出渲染：模型可见的稳定紧凑文本（键序稳定，见 text-render）。 */
    render: (args: Args, value: Value) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: Args, exec: ToolExecLike) => unknown | Promise<unknown>
  /** 可选：调用超时毫秒（正有限数；注册表只读元数据，不强制 deadline）。 */
  timeoutMs?: number
}): ToolDefinitionLike<Args, Value> {
  if (!def.name || !def.name.trim()) throw new TypeError('defineTool: name 必填')
  if (!def.description || !def.description.trim()) throw new TypeError('defineTool: description 必填')
  const parameters: Record<string, JsonSchemaNode> = {}
  const required: string[] = []
  for (const [key, prop] of Object.entries(def.parameters ?? {})) {
    parameters[key] = compileProperty(prop)
    if (prop.required === true) required.push(key)
  }
  const out: ToolDefinitionLike<Args, Value> = {
    name: def.name,
    description: def.description,
    parameters: { type: 'object', properties: parameters, ...(required.length > 0 ? { required } : {}) },
    output: {
      schema: compileValue(def.output.schema),
      render: def.output.render,
    },
    execute: def.execute,
  }
  if (typeof def.timeoutMs === 'number' && Number.isFinite(def.timeoutMs) && def.timeoutMs > 0) {
    out.timeoutMs = def.timeoutMs
  }
  return out
}

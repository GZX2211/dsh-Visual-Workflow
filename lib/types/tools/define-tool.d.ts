/** JSON Schema 节点（官方支持子集的超集）。 */
export interface JsonSchemaNode {
    type?: string;
    additionalProperties?: boolean;
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    items?: JsonSchemaNode;
    enum?: unknown[];
    const?: unknown;
    oneOf?: JsonSchemaNode[];
    minItems?: number;
    maxItems?: number;
    description?: string;
}
/** 标量类型 spec。 */
export interface ScalarSpec {
    type: string;
    /** 枚举约束（仅标量合法）。 */
    enum?: readonly unknown[];
    description?: string;
}
/** 常量 spec（只允许精确值）。 */
export interface ConstSpec {
    const: unknown;
    description?: string;
}
/** 对象 spec：必须显式声明 additionalProperties（与官方 DSL 强制一致）。 */
export interface ObjectSpec {
    type: 'object';
    additionalProperties: boolean;
    properties?: Record<string, PropertySpec>;
    description?: string;
}
/** 数组 spec：items 为元素 spec。 */
export interface ArraySpec {
    type: 'array';
    items: PropertySpec;
    minItems?: number;
    maxItems?: number;
    description?: string;
}
/** 互斥联合 spec（exact-one oneOf）。 */
export interface OneOfSpec {
    oneOf: ValueSchemaSpec[];
    description?: string;
}
/** 值 schema spec（output.schema 根）。 */
export type ValueSchemaSpec = ScalarSpec | ConstSpec | ObjectSpec | ArraySpec | OneOfSpec;
/**
 * 属性 spec：值 spec + 内联 `required: true` + description。
 * 注意：必须为交叉类型而非 interface extends 联合——TS 不允许接口继承联合类型，
 * 且交叉类型能让对象字面量属性（含 type/required）被索引签名接受。
 */
export type PropertySpec = ValueSchemaSpec & {
    /** 内联必填标记（编译时提取进父对象 required 数组）。 */
    required?: boolean;
};
/** 工具执行上下文最小形状（官方 ToolExecution 子集：signal/agent 必须）。 */
export interface ToolExecLike {
    /** 调用方持有的取消信号（只读必填）。 */
    readonly signal: AbortSignal;
    /** 调用 Agent（会话根或子代理；身份/归属校验用）。 */
    readonly agent?: unknown;
    /** 调用唯一标识（日志/审计）。 */
    readonly callId?: string;
}
/** 工具定义产物（官方 ToolDefinition 的最小结构适配，供 ctx.tools.register）。 */
export interface ToolDefinitionLike<Args extends Record<string, unknown> = Record<string, unknown>, Value = unknown> {
    name: string;
    description: string;
    /** 编译后的参数 JSON Schema（隐式开放根：不设 additionalProperties）。 */
    parameters: JsonSchemaNode;
    output: {
        schema: JsonSchemaNode;
        render: (args: Args, value: Value) => Array<{
            type: 'text';
            text: string;
        }>;
    };
    execute: (args: Args, exec: ToolExecLike) => unknown | Promise<unknown>;
    timeoutMs?: number;
}
/** 编译值 spec（对象属性内联 required 提取为 required 数组）。 */
export declare function compileValue(spec: ValueSchemaSpec): JsonSchemaNode;
/**
 * 定义并编译一个工具（官方 defineTool DSL 语义的本地等价实现）。
 * 参数根为隐式开放对象（不设 additionalProperties，默认开放）。
 */
export declare function defineTool<Args extends Record<string, unknown> = Record<string, unknown>, Value = unknown>(def: {
    name: string;
    description: string;
    /** 参数 DSL：属性内联 required: true。 */
    parameters: Record<string, PropertySpec>;
    output: {
        /** 值 schema DSL（对象属性内联 required）。 */
        schema: ValueSchemaSpec;
        /** 输出渲染：模型可见的稳定紧凑文本（键序稳定，见 text-render）。 */
        render: (args: Args, value: Value) => Array<{
            type: 'text';
            text: string;
        }>;
    };
    execute: (args: Args, exec: ToolExecLike) => unknown | Promise<unknown>;
    /** 可选：调用超时毫秒（正有限数；注册表只读元数据，不强制 deadline）。 */
    timeoutMs?: number;
}): ToolDefinitionLike<Args, Value>;

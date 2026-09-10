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
/** 编译单个属性 spec：剥离 required 标记后递归编译值。 */
function compileProperty(spec) {
    const { required: _required, ...rest } = spec;
    return compileValue(rest);
}
/** 编译值 spec（对象属性内联 required 提取为 required 数组）。 */
export function compileValue(spec) {
    if (typeof spec !== 'object' || spec === null) {
        throw new TypeError('defineTool: 非法的 schema spec（必须为对象）');
    }
    const desc = spec.description;
    const withDesc = (node) => typeof desc === 'string' && desc ? { ...node, description: desc } : node;
    if ('oneOf' in spec && Array.isArray(spec.oneOf)) {
        return withDesc({ oneOf: spec.oneOf.map((item) => compileValue(item)) });
    }
    if ('const' in spec) {
        return withDesc({ const: spec.const });
    }
    if ('type' in spec) {
        const type = spec.type;
        if (type === 'object') {
            const objectSpec = spec;
            if (typeof objectSpec.additionalProperties !== 'boolean') {
                throw new TypeError('defineTool: 对象 spec 必须显式声明 additionalProperties: true | false');
            }
            const node = {
                type: 'object',
                additionalProperties: objectSpec.additionalProperties,
            };
            if (objectSpec.properties) {
                const properties = {};
                const required = [];
                for (const [key, prop] of Object.entries(objectSpec.properties)) {
                    properties[key] = compileProperty(prop);
                    if (prop.required === true)
                        required.push(key);
                }
                node.properties = properties;
                if (required.length > 0)
                    node.required = required;
            }
            return withDesc(node);
        }
        if (type === 'array') {
            const arraySpec = spec;
            const node = { type: 'array', items: compileProperty(arraySpec.items) };
            // minItems/maxItems 非官方子集关键字：只在显式声明时透传（parameters 不校验；
            // output.schema 若携带会被 ctx.tools.register 的 assertSupportedJsonSchema 拒绝）。
            if (arraySpec.minItems !== undefined)
                node.minItems = arraySpec.minItems;
            if (arraySpec.maxItems !== undefined)
                node.maxItems = arraySpec.maxItems;
            return withDesc(node);
        }
        const scalar = spec;
        const node = { type: scalar.type };
        if (scalar.enum !== undefined)
            node.enum = [...scalar.enum];
        return withDesc(node);
    }
    throw new TypeError(`defineTool: 无法识别的 schema spec：${JSON.stringify(spec)}`);
}
/**
 * 定义并编译一个工具（官方 defineTool DSL 语义的本地等价实现）。
 * 参数根为隐式开放对象（不设 additionalProperties，默认开放）。
 */
export function defineTool(def) {
    if (!def.name || !def.name.trim())
        throw new TypeError('defineTool: name 必填');
    if (!def.description || !def.description.trim())
        throw new TypeError('defineTool: description 必填');
    const parameters = {};
    const required = [];
    for (const [key, prop] of Object.entries(def.parameters ?? {})) {
        parameters[key] = compileProperty(prop);
        if (prop.required === true)
            required.push(key);
    }
    const out = {
        name: def.name,
        description: def.description,
        parameters: { type: 'object', properties: parameters, ...(required.length > 0 ? { required } : {}) },
        output: {
            schema: compileValue(def.output.schema),
            render: def.output.render,
        },
        execute: def.execute,
    };
    if (typeof def.timeoutMs === 'number' && Number.isFinite(def.timeoutMs) && def.timeoutMs > 0) {
        out.timeoutMs = def.timeoutMs;
    }
    return out;
}
//# sourceMappingURL=define-tool.js.map
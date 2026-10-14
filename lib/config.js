// src/host/config.ts
//
// 插件契约声明：稳定标识名（name/inject）与 Host 全部可配置键
// （Config 接口 + schemastery schema；默认值与 cordis.patch.yml 逐字一致）。
// 纯配置声明，不含运行时装配。
import z from '@deepseek-ai/schemastery';
/** 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。 */
export const name = 'dsh-visual-workflow';
// 必需 service 声明为空：宿主插件不声明强依赖官方 service——数据层自持，
// 事件经 ctx.on 订阅，任何缺失的官方能力都在 Service.init 内运行时解析。
export const inject = [];
/** 导出的 Config schema，供 Loader 校验与默认值填充。 */
export const Config = z.object({
    dataDir: z.string().default(''),
    servicePortBase: z.natural().default(7860),
    apiKey: z.union([z.string(), z.const(null)]).default(null),
    maxConcurrentPerService: z.natural().default(50),
    wfAskAgentTtlMs: z.natural().default(120000),
    /** 旧键名（读取兼容；0 表示未设置。resolveConfig 投影到 wfAskAgentTtlMs，禁止新增写入）。 */
    wfAskAgentTimeoutMs: z.natural().default(0),
    runIdleTimeoutMs: z.natural().default(1800000),
    runPollMs: z.natural().default(2000),
    reactIterationLimitDefault: z.natural().default(0),
    retryLimitDefault: z.natural().default(3),
    outputFullLimit: z.natural().default(102400),
    documentTextLimit: z.natural().default(20000),
    embeddingModelDir: z.union([z.string(), z.const(null)]).default(null),
    embeddingEndpoint: z.union([z.string(), z.const(null)]).default(null),
    teamMemberLimit: z.natural().default(8),
});
/**
 * 解析配置并填充 schema 默认值（直接装配路径用；Loader 之外的入口同样走这里）。
 *
 * 为什么需要包装：schemastery 的类型签名要求完整入参，而运行时语义是「缺失键填默认值」。
 * 入口若直接拼一份完整对象，就会在源码里出现第二份默认值清单（改 schema 后两处不一致）。
 * 本函数把「部分入参 → 完整 Config」收敛到唯一一处，默认值来源仍只有上面的 schema。
 *
 * 注意：schema 对「可为 null」的键不填默认（default(null) 视为无默认），而 Config 接口
 * 把这类键声明为必填（`string | null`）。resolveConfig 是唯一的解析入口，故在此显式补齐
 * null——否则调用方拿到的是「接口说必填、运行时缺键」的失真对象，只能各自 `?? null` 兜底。
 */
export function resolveConfig(input) {
    // 旧键读取兼容：早期把「待回复登记 TTL」命名为 wfAskAgentTimeoutMs；只在解析入口投影到
    // 新键（新键优先），既有部署的旧配置继续生效，消费侧只见 wfAskAgentTtlMs。
    const { wfAskAgentTimeoutMs: legacy, ...rest } = input;
    const merged = rest.wfAskAgentTtlMs === undefined && typeof legacy === 'number' && legacy > 0
        ? { ...rest, wfAskAgentTtlMs: legacy }
        : rest;
    const resolved = Config(merged);
    return {
        ...resolved,
        apiKey: resolved.apiKey ?? null,
        embeddingModelDir: resolved.embeddingModelDir ?? null,
        embeddingEndpoint: resolved.embeddingEndpoint ?? null,
    };
}
//# sourceMappingURL=config.js.map
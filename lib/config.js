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
    wfAskAgentTimeoutMs: z.natural().default(120000),
    runIdleTimeoutMs: z.natural().default(1800000),
    runPollMs: z.natural().default(2000),
    reactIterationLimitDefault: z.natural().default(50),
    retryLimitDefault: z.natural().default(3),
    outputFullLimit: z.natural().default(102400),
    documentTextLimit: z.natural().default(20000),
    embeddingModelDir: z.union([z.string(), z.const(null)]).default(null),
    embeddingEndpoint: z.union([z.string(), z.const(null)]).default(null),
});
//# sourceMappingURL=config.js.map
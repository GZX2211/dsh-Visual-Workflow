// src/host/service-runner.ts
//
// 模式二服务进程入口插件（package.json exports["./service-runner"]）。
// 由服务管理器 fork：`dsh --profile headless --patch <serve.patch.yml>
// --visual-workflow-serve <serviceId> --port <n>`。
//
// 装配：解析 cmdlineArgs（权威，flag 覆盖 config）→ 挂载主插件
// VisualWorkflowHost（复用编排/存储/工具全量能力，跳过磁盘对账——服务进程
// 不接管主进程的运行记录）→ 等服务树稳定 → 按 serviceId 加载服务工作流 →
// SessionMap（userId→sessionId）+ OpenAI 兼容 API 注册。
//
// 本文件是包级二级入口：只做装配与协调（参数解析、装配、退出码/stdin 生命周期），
// 进程内实现归各自模块（服务/会话/Agent 能力均从模块公共入口取得）。
//
// 退出协调：失败写 stderr 并 appExit(1)；正常生命周期由主进程 SIGTERM 驱动
// （launcher 的 bounded shutdown 会 dispose 整棵树）。
import z from '@deepseek-ai/schemastery';
import { VisualWorkflowHost } from './index.js';
import { resolveConfig } from './config.js';
import { createOrGetServiceAgent } from './agent/index.js';
import { SessionMap, OpenAiApi, registerOpenAiApi } from './service/index.js';
import { CordisSessionProvider } from './sessions/session-provider.js';
import { sweepWatchdogOnce } from './orchestrator/index.js';
/** 稳定插件名（serve.patch.yml 的 insert 行 name 解析目标）。 */
export const name = 'visual-workflow-service';
/** 核心服务：cmdlineArgs 由 launcher 在树挂载前提供（app 自持参数族）。 */
export const inject = ['cmdlineArgs'];
export const Config = z.object({
    serviceId: z.string().required(),
    dataDir: z.string().required(),
    port: z.natural().required(),
    apiKey: z.union([z.string(), z.const(null)]).default(null),
    maxConcurrent: z.natural().default(50),
});
/** 解析内层参数族：--visual-workflow-serve <serviceId> --port <n>。 */
export function parseServiceArgs(args) {
    let serviceId = '';
    let port = Number.NaN;
    for (let index = 0; index < args.length; index += 1) {
        const token = String(args[index] ?? '');
        if (token === '--visual-workflow-serve' && index + 1 < args.length) {
            serviceId = String(args[index + 1] ?? '').trim();
        }
        else if (token === '--port' && index + 1 < args.length) {
            port = Number(args[index + 1]);
        }
    }
    if (!serviceId || !Number.isInteger(port) || port <= 0)
        return null;
    return { serviceId, port };
}
/** 启动失败报告（stderr + 失败退出码）。 */
function fail(io, error) {
    io.stderr.write(`dsh: visual-workflow-service: ${error instanceof Error ? error.message : String(error)}\n`);
    io.exit(1);
}
/**
 * 服务进程装配（异步；失败经 fail 统一收口）。
 */
async function boot(ctx, config, io) {
    // cmdlineArgs 权威解析（launcher 转交的 app 参数族；缺失时回退 config）。
    // ctx.cmdlineArgs 为注入服务（类型经运行时守卫，避免官方类型依赖）。
    const cmdline = ctx.cmdlineArgs;
    const parsed = parseServiceArgs(cmdline?.get?.() ?? []);
    const serviceId = parsed?.serviceId ?? config.serviceId;
    const port = parsed?.port ?? config.port;
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(serviceId))
        throw new Error(`非法 serviceId：${serviceId}`);
    if (!Number.isInteger(port) || port <= 0)
        throw new Error(`非法端口：${port}`);
    // 主插件全量装配（编排/存储/工具/看护）；skipReconcile：磁盘对账属主进程职责。
    // Service 构造即注册（Cordis 语义），函数 plugin 形式仅承载构造选项。
    // 主插件配置：默认值经 Config schema 解析（唯一来源，禁止在此复制默认值清单）；
    // 服务进程只暴露 4 个可配置键。schema 不为「可为 null」的键填默认（schemastery 视
    // default(null) 为无默认），故显式声明：apiKey 取服务自身配置，嵌入式向量与外部
    // 嵌入端点在服务进程不启用（固定 null）。
    const hostConfig = {
        ...resolveConfig({
            dataDir: config.dataDir,
            servicePortBase: config.port,
            maxConcurrentPerService: config.maxConcurrent,
        }),
        apiKey: config.apiKey,
        embeddingModelDir: null,
        embeddingEndpoint: null,
    };
    ctx.plugin((innerCtx) => {
        new VisualWorkflowHost(innerCtx, hostConfig, { skipReconcile: true });
    });
    // Loader 兄弟行并发挂载：等待整树稳定后再读服务/建会话（headless 同款时序）
    await ctx.get('loader')?.await();
    const host = ctx.get('visualWorkflowHost');
    if (!host)
        throw new Error('visualWorkflowHost 服务未激活');
    const service = await host.store.getServiceById(serviceId);
    if (!service)
        throw new Error(`服务不存在：${serviceId}`);
    const sessions = new SessionMap({ store: host.store, serviceId });
    const api = new OpenAiApi({
        store: host.store,
        orchestrator: host.orchestrator,
        serviceId,
        apiKey: config.apiKey,
        maxConcurrent: config.maxConcurrent,
        resolveSession: (userId) => sessions.resolve(userId),
        // 「服务级新会话」：服务文档 startNewSession=true 时每请求新建会话（cwd=工作区）
        createSession: (options) => new CordisSessionProvider(ctx).createSession(options),
        ensureRootAgent: (sessionId) => createOrGetServiceAgent(ctx, host.store, serviceId, sessionId),
        sweep: () => sweepWatchdogOnce(host.orchestrator),
        logger: { warn: (message) => ctx.logger.warn(message) },
    });
    ctx.effect(() => registerOpenAiApi(ctx, api), 'visualWorkflowService.openai');
    io.stdout.write(`visual-workflow-service: ${serviceId} listening on port ${port} (maxConcurrent=${config.maxConcurrent})\n`);
    if (config.apiKey) {
        io.stdout.write(`visual-workflow-service: REST API 鉴权已启用（Authorization: Bearer <apiKey>）\n`);
    }
    else {
        io.stdout.write(`visual-workflow-service: REST API 鉴权关闭（仅限本机/内网使用）\n`);
    }
    io.stdout.write(`visual-workflow-service: OpenAI 兼容端点：\n`);
    io.stdout.write(`  POST http://127.0.0.1:${port}/v1/chat/completions\n`);
    io.stdout.write(`  GET  http://127.0.0.1:${port}/v1/models\n`);
    io.stdout.write(`  userId 必填（body user_id 或 Header X-User-Id，多用户会话隔离）\n`);
    // 父进程退出/主动停止 → stdin EOF → 优雅退出。
    // 为什么：Windows 下 manager 经 shell 启动（cmd 壳），SIGTERM 无法可靠
    // 透传到 node 服务进程，内存/端口残留。stdin 管道 EOF 是跨平台可靠的
    // 父进程存活信号（manager stop 会主动 end stdin）。
    process.stdin.resume();
    process.stdin.on('end', () => {
        io.stdout.write('visual-workflow-service: 父进程已关闭 stdin，退出服务\n');
        try {
            io.exit(0);
        }
        catch {
            process.exit(0);
        }
    });
}
/**
 * 插件入口：启动异步装配（不阻塞树挂载）。
 * appExit 由 launcher 提供（缺失报错——服务进程必须能请求退出）。
 */
export function apply(ctx, config) {
    const exit = ctx.get('appExit');
    if (typeof exit !== 'function') {
        throw new Error('visual-workflow-service: the launcher must provide ctx.appExit before the tree mounts');
    }
    const io = { stdout: process.stdout, stderr: process.stderr, exit: exit };
    void boot(ctx, config, io).catch((error) => { fail(io, error); });
}
//# sourceMappingURL=service-runner.js.map
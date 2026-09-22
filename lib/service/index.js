// src/host/service/index.ts
//
// 模式二 API Service 模块**唯一公共入口**（barrel）：
//   - 模块外（host 装配 / remote 端点 / 服务进程入口插件及全部测试）一律从本入口
//     导入，不得直接引用模块内部文件（见同目录 AGENTS.md「公共边界」）；
//   - 内部文件之间仍使用相对路径导入；本文件不含任何实现。
//
// 本模块横跨两个进程侧（见同目录 AGENTS.md「进程边界」）：
//   - 主进程侧：服务子进程的生命周期管理、端口池、serve 层渲染；
//   - 服务进程侧：被 fork 的子进程内的 OpenAI 兼容 API、会话映射、HTTP 适配。
// 两侧只通过「磁盘上的服务文档 + serve.patch.yml 产物 + 环境继承」协作，
// 不共享内存，也不得跨侧直接调用。
//
// 刻意**不**在本入口公开的内部实现（它们不是对外契约）：
//   - 进程树终止、serviceId 消毒、apiKey 哈希等内部守卫；
//   - HTTP 适配层的请求体读取、响应写出、错误文案组装、SSE 分块粒度；
//   - 端口探测的内部上限（属探测实现的边界，不是部署契约）；
//   - 服务文档运行字段的读改写细节。
// 若确实需要公开其中某项，先判断它是否表达真实、稳定、可维护的对外契约，
// 再在本文件显式登记——不要为「方便」整体 re-export 内部文件。
// ── 主进程侧：服务进程生命周期（fork / 停止 / 崩溃标记 / 自动恢复）──────────
export { resolveDshCommand, SERVICE_ERR, ServiceManager, ServiceManagerError, STOP_GRACE_MS } from './manager.js';
// ── 主进程侧：端口池 ─────────────────────────────────────────────────────
export { findFreePort, probePort, SERVICE_PORT_BASE } from './port-pool.js';
// ── 主进程侧：serve 层产物渲染（服务子进程的组合挂载）─────────────────────
export { renderServePatch, SERVICE_PLUGIN_ROW_ID, SERVICE_WEBSERVER_ROW_ID } from './serve-patch.js';
// ── 服务进程侧：userId → sessionId 隔离映射 ──────────────────────────────
export { SESSION_ID_PREFIX, SessionMap } from './sessions-map.js';
// ── 服务进程侧：OpenAI 兼容 API 核心 ─────────────────────────────────────
export { CLIENT_CLOSED_CODE, DEFAULT_SSE_TIMEOUT_MS, OPENAI_POLL_MS, OpenAiApi, OpenAiError, parseChatRequest, } from './openai-api.js';
// ── 服务进程侧：HTTP 适配（webServer 路由注册 + SSE 序列化）───────────────
export { completionJson, errorJson, registerOpenAiApi, sseChunk, sseDone, sseError, } from './openai-http.js';
//# sourceMappingURL=index.js.map
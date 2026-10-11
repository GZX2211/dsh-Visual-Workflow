// src/host/api/http.ts
//
// GUI API 传输层基础：HttpError（带状态与稳定 code）、请求体读取（上限 413）、
// JSON 响应写出与请求体上限常量。路由层与端点分发共用。
//
// 读体/写出逻辑本身是宿主级横切契约（../http-io.js，与模式二服务边界共用同一实现）；
// 本文件只提供 GUI 边界的错误形状（HttpError + 413 语义）与默认上限。

import * as EP from '../shared/protocol.js'
import { readRequestBody, sendJsonResponse, type BodyRequest, type JsonResponseSink } from '../http-io.js'

/** 请求体上限（64MB——文件模板 base64 上传需要大体积）。按端点的分级见 GUI_BODY_LIMIT（K2）。 */
const BODY_LIMIT = 64 * 1024 * 1024

/**
 * GUI 请求体上限分级（K2 用户裁决：本 API 仅本机可信，但要按端点收敛资源占用）。
 * 分级体现的是端点载荷形状，不是「统一成一个值」——二进制/导入档必须保留 64MB 既有能力。
 */
export const GUI_BODY_LIMIT = {
  /** 无参端点（端点方法不读 args）：只承载空体或 `{"args":{}}`。 */
  argsFree: 16 * 1024,
  /** 常规端点：id 与短参数。 */
  normal: 2 * 1024 * 1024,
  /** 整份文档端点：工作流/服务/模板/资产文档整体上送。 */
  document: 16 * 1024 * 1024,
  /** 二进制与导入包端点：fileUpload 的 base64 与 bundle JSON。 */
  binary: 64 * 1024 * 1024,
} as const

/** 无参端点（与端点方法签名一一对应；新增无参端点时在此登记）。 */
const ARGS_FREE_ENDPOINTS = new Set<string>([
  EP.EP_PRESETS,
  EP.EP_MODELS,
  EP.EP_TOOL_COMBOS,
  EP.EP_LIST_EXPERIENCES,
  EP.EP_LIST_FLOW_TEMPLATES,
  EP.EP_SCHEDULER_TASKS,
  EP.EP_RUNTIME_CONFIG,
])

/** 整份文档端点（文档随 args 整体上送）。 */
const DOCUMENT_ENDPOINTS = new Set<string>([
  EP.EP_PUT_WORKFLOW,
  EP.EP_PUT_SERVICE,
  EP.EP_PUT_TEMPLATE,
  EP.EP_PUT_FLOW_TEMPLATE,
  EP.EP_SAVE_ASSET_VERSION,
  EP.EP_PREVIEW_ASSET_CASCADE,
])

/** 二进制/导入包端点（64MB 档；未登记端点不得升档）。 */
const BINARY_ENDPOINTS = new Set<string>([
  EP.EP_FILE_UPLOAD,
  EP.EP_IMPORT_WORKFLOW,
  EP.EP_IMPORT_AGENT_TEMPLATE,
])

/** 端点 → 请求体上限（未登记端点按常规档，未知端点亦不会拿到 64MB）。 */
export function guiBodyLimitOf(endpoint: string): number {
  if (BINARY_ENDPOINTS.has(endpoint)) return GUI_BODY_LIMIT.binary
  if (DOCUMENT_ENDPOINTS.has(endpoint)) return GUI_BODY_LIMIT.document
  if (ARGS_FREE_ENDPOINTS.has(endpoint)) return GUI_BODY_LIMIT.argsFree
  return GUI_BODY_LIMIT.normal
}

/** 请求头取值（大小写不敏感；数组取首个）。 */
function headerOf(headers: GuiRequestHeaders | undefined, name: string): string {
  if (!headers) return ''
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name)
  if (key === undefined) return ''
  const value = headers[key]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

/** GUI 请求头最小面（官方 webServer 的 req.headers 收窄）。 */
export type GuiRequestHeaders = Record<string, string | string[] | undefined>

/** 回环主机名（本地开发代理会改写 Host，回环来源仍视为本机可信）。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * 来源校验（K2 用户裁决：GUI API「仅本机可信」，无应用层鉴权、不引入 token）。
 *
 * 只拦「浏览器跨站发起」这一类请求，不改客户端调用方式：
 *   - 有 `Sec-Fetch-Site` 时必须是 `same-origin` / `none`（同站跨端口 = `same-site` 一并拒绝）；
 *   - 无 `Sec-Fetch-Site` 时（非浏览器客户端、旧浏览器）：有 `Origin` 则要求主机与 `Host`
 *     一致，或为回环地址（本地开发代理）；
 *   - 两者都没有（curl/本地脚本）放行——信任边界就是本机进程，本层不承担进程鉴权。
 */
export function guiRequestTrust(headers: GuiRequestHeaders | undefined): { ok: true } | { ok: false; reason: string } {
  const site = headerOf(headers, 'sec-fetch-site').toLowerCase()
  if (site !== '' && site !== 'same-origin' && site !== 'none') {
    return { ok: false, reason: `cross-site request rejected (Sec-Fetch-Site: ${site})` }
  }
  const origin = headerOf(headers, 'origin')
  if (origin === '') return { ok: true }
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return { ok: false, reason: 'cross-site request rejected (invalid Origin)' }
  }
  const requestHost = headerOf(headers, 'host')
  if (requestHost !== '' && host === requestHost) return { ok: true }
  const hostname = host.replace(/:\d+$/, '')
  if (LOOPBACK_HOSTS.has(hostname) || LOOPBACK_HOSTS.has(host)) return { ok: true }
  return { ok: false, reason: `cross-site request rejected (Origin: ${origin})` }
}

/** HTTP 错误（status 供路由层写响应；code 供 client 分支处理）。 */
export class HttpError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code)
}

/** 读取请求体（JSON 文本；超限 413）。请求流异常以 RequestStreamError 拒绝（路由层映射 400）。 */
export function readBody(req: BodyRequest, limit = BODY_LIMIT): Promise<string> {
  return readRequestBody(req, { limit, errorOf: () => httpError(413, 'request body too large') })
}

export function sendJson(res: JsonResponseSink, status: number, payload: unknown): void {
  sendJsonResponse(res, status, payload)
}

import { runtimeManagedPrefix } from "../storage/managed-files.js"
import { basename, isAbsolute, resolve } from "node:path"
import { mainNodeIdOf, nodeById } from "../graph/index.js"
import type { WorkflowDocument } from "../shared/graph-model.js"
import type { JsonValue, RuntimeInputs, RuntimeInputValue, SessionInputFile } from "../shared/runtime-types.js"
import { WfError } from "./errors.js"
import { authorizedInputPath } from "./execution-file-access.js"

function recordOf(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) bad(field, "必须为普通对象")
  return raw as Record<string, unknown>
}
function nameOf(name: string, field: string): void {
  if (!name.trim() || ["__proto__", "prototype", "constructor"].includes(name)) bad(field, "输入名称无效")
}
function bad(field: string, message: string): never { throw new WfError(`${field}: ${message}`, "WF_RUNTIME_INPUT_INVALID", { phase: "node_input", retryable: false, details: [{ field, message }] }) }

/** Public attachment references never include resolved host paths; stored inputs remain intact. */
export function publicRuntimeInputs(inputs: RuntimeInputs | undefined): RuntimeInputs | undefined {
  if (!inputs) return undefined
  const result = structuredClone(inputs)
  for (const slots of [result.workflowInputs, ...Object.values(result.nodeInputs)]) for (const values of Object.values(slots)) {
    for (const value of values) if (value.kind === "file" && value.fileRef.source === "attachment") delete value.fileRef.path
  }
  return result
}
export function jsonValueOf(value: unknown, field: string, depth = 0, ancestors = new Set<unknown>()): JsonValue {
  if (depth > 24) bad(field, "JSON 结构过深")
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (!value || typeof value !== "object" || ancestors.has(value)) bad(field, "必须为有限无循环的 JSON 值")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item, index) => jsonValueOf(item, `${field}[${index}]`, depth + 1, ancestors))
    const result: Record<string, JsonValue> = {}
    for (const [name, part] of Object.entries(recordOf(value, field))) { nameOf(name, field); result[name] = jsonValueOf(part, `${field}.${name}`, depth + 1, ancestors) }
    return result
  } finally { ancestors.delete(value) }
}
export interface InputAccess { sessionId: string; managedRoot: string; files: readonly SessionInputFile[] }
async function inputValueOf(raw: unknown, field: string, access: InputAccess): Promise<RuntimeInputValue> {
  const part = recordOf(raw, field)
  if (part.kind === "text") { if (typeof part.value !== "string") bad(`${field}.value`, "必须为文本"); return { kind: "text", value: part.value, origin: { source: "user" } } }
  if (part.kind === "json") return { kind: "json", value: jsonValueOf(part.value, `${field}.value`), origin: { source: "user" } }
  if (part.kind !== "file") bad(`${field}.kind`, "必须为 text/json/file")
  const ref = recordOf(part.fileRef, `${field}.fileRef`)
  if (ref.source === "attachment") {
    const file = access.files.find((file) => file.attachmentId === ref.attachmentId && file.name === ref.name && file.bytes === ref.bytes)
    if (!file) throw new WfError(`${field}: 附件未获当前会话授权，请通过工作台受控上传或选择`, "WF_INPUT_FILE_UNAUTHORIZED", { phase: "node_input", retryable: false })
    const path = await authorizedInputPath(file.path, undefined, undefined, access.files.map((file) => file.path))
    return { kind: "file", fileRef: { source: "attachment", ...file, path }, origin: { source: "attachment" } }
  }
  if (ref.source !== "managed") bad(`${field}.fileRef.source`, "必须为 managed/attachment")
  if (typeof ref.path !== "string" || !ref.path.trim()) bad(`${field}.fileRef.path`, "必须为明确的受管文件引用")
  const absolute = isAbsolute(ref.path) ? ref.path : resolve(access.managedRoot, ref.path)
  const path = await authorizedInputPath(absolute, undefined, access.managedRoot)
  if (!basename(path).startsWith(runtimeManagedPrefix(access.sessionId))) throw new WfError("受管文件未通过当前会话的运行输入上传；请重新上传或选择当前会话附件", "WF_INPUT_FILE_UNAUTHORIZED")
  return { kind: "file", fileRef: { source: "managed", path }, origin: { source: "managed" } }
}
export async function inputSlotsOf(raw: unknown, field: string, access: InputAccess): Promise<Record<string, RuntimeInputValue[]>> {
  const entries = Object.entries(recordOf(raw, field))
  if (entries.length > 128) bad(field, "输入槽超过 128 项")
  const result: Record<string, RuntimeInputValue[]> = {}
  for (const [name, values] of entries) {
    nameOf(name, field)
    if (!Array.isArray(values) || values.length > 32) bad(`${field}.${name}`, "必须为最多 32 项的输入数组")
    result[name] = await Promise.all(values.map((value, index) => inputValueOf(value, `${field}.${name}[${index}]`, access)))
  }
  return result
}
export async function runtimeInputsOf(raw: unknown, flow: WorkflowDocument, access: InputAccess): Promise<RuntimeInputs> {
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > 262144) bad("runtimeInputs", "输入超过 256 KiB，请改用文件引用")
    const part = recordOf(raw, "runtimeInputs")
    const result: RuntimeInputs = { workflowInputs: await inputSlotsOf(part.workflowInputs ?? {}, "runtimeInputs.workflowInputs", access), nodeInputs: {} }
    for (const [id, slots] of Object.entries(recordOf(part.nodeInputs ?? {}, "runtimeInputs.nodeInputs"))) {
      const canonical = mainNodeIdOf(flow, id) ?? id
      nameOf(canonical, "nodeInputs")
      const node = nodeById(flow, canonical)
      if (!node || node.kind !== "agent") bad(`runtimeInputs.nodeInputs.${id}`, "必须指向可执行节点")
      if (Object.hasOwn(result.nodeInputs, canonical)) bad(`runtimeInputs.nodeInputs.${id}`, "主节点和 proxy 不得重复绑定")
      result.nodeInputs[canonical] = await inputSlotsOf(slots, `runtimeInputs.nodeInputs.${id}`, access)
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 262144) bad("runtimeInputs", "输入超过 256 KiB，请改用文件引用")
    return result
  } catch (error) { if (error instanceof WfError) throw error; bad("runtimeInputs", error instanceof Error ? error.message : "格式无效") }
}

export function handoffPolicyOf(raw: unknown): import("../shared/runtime-types.js").HandoffPolicy {
  if (raw === "explicit" || raw === "auto") return raw
  bad("handoffPolicy", "必须为 explicit/auto")
}

export function validateRequiredInputs(node: import("../shared/graph-model.js").RoleNode, slots: import("../shared/runtime-types.js").InputSlots): void {
  for (const [name, requirement] of Object.entries(node.data.execution?.inputs ?? {})) {
    const values = slots[name] ?? []
    if (requirement.required !== false && !values.length) throw new WfError(`节点 ${node.id} 缺少输入 ${name}；请在工作台保存绑定后重试，“已上传”消息不能代替输入绑定`, "WF_INPUT_REQUIRED")
    if (values.some((value) => value.kind !== requirement.kind)) bad(`${node.id}.${name}`, `需要 ${requirement.kind} 输入`)
  }
}

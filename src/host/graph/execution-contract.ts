import type { NodeExecutionContract } from '../shared/graph-model.js'

/** 纯形状检查；不把自然语言输入/输出说明解释成硬性 schema。 */
export function parseExecutionContract(raw: unknown): { value?: NodeExecutionContract; issue?: string } {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return { issue: 'execution 必须是对象' }
  const data = raw as Record<string, unknown>
  const value: NodeExecutionContract = {}
  if (data.completion !== undefined) {
    if (data.completion !== "output-files" || !Array.isArray(data.outputFiles) || !data.outputFiles.length) return { issue: "completion=output-files 必须声明非空 outputFiles" }
    value.completion = "output-files"
  }
  if (data.retrySafe !== undefined) {
    if (typeof data.retrySafe !== "boolean") return { issue: "retrySafe 必须为布尔值" }
    value.retrySafe = data.retrySafe
  }
  if (data.inputSource !== undefined) {
    if (data.inputSource !== 'ctx' && data.inputSource !== 'workspace' && data.inputSource !== 'runtime') return { issue: 'inputSource 必须为 ctx/workspace/runtime' }
    value.inputSource = data.inputSource
  }
  for (const key of ['requiredFiles', 'requiredTools', 'outputFiles'] as const) {
    if (data[key] === undefined) continue
    if (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string' || !item.trim())) return { issue: `${key} 必须为非空字符串数组` }
    value[key] = [...new Set((data[key] as string[]).map((item) => item.trim()))]
  }
  if (data.inputs !== undefined) {
    if (!data.inputs || typeof data.inputs !== "object" || Array.isArray(data.inputs)) return { issue: "inputs 必须为对象" }
    value.inputs = {}
    for (const [name, raw] of Object.entries(data.inputs)) {
      if (!name.trim() || ["__proto__", "constructor", "prototype"].includes(name) || !raw || typeof raw !== "object" || Array.isArray(raw)) return { issue: "输入声明无效" }
      const requirement = raw as Record<string, unknown>
      if (!["text", "json", "file"].includes(String(requirement.kind)) || requirement.required !== undefined && typeof requirement.required !== "boolean") return { issue: "输入必须声明 text/json/file 类型及可选 required" }
      value.inputs[name] = { kind: requirement.kind as "text" | "json" | "file", ...(requirement.required === undefined ? {} : { required: requirement.required as boolean }) }
    }
  }
  return { value }
}

// src/client/lib/bundle.ts
//
// 导入导出 v2 bundle 客户端辅助（架构文档 §6.4）：格式常量与形状判定，
// 供 Studio 导入/导出（title bar 按钮）与 Inspector 使用。

/** bundle 格式标识（与后端 transfer.ts 逐字一致）。 */
export const BUNDLE_FORMAT = 'dsh-vw-bundle'
/** 角色模板导出标识。 */
export const TEMPLATE_FORMAT = 'dsh-vw-template'
/** bundle 版本。 */
export const BUNDLE_VERSION = 2

/** 判定 JSON 文本是否为工作流/服务 bundle（v2）。 */
export function isWorkflowBundle(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as { format?: unknown; workflow?: unknown }
    return parsed?.format === BUNDLE_FORMAT && parsed?.workflow != null
  } catch {
    return false
  }
}

/** 判定 JSON 文本是否为角色模板导出。 */
export function isRoleTemplateBundle(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as { format?: unknown; template?: unknown }
    return parsed?.format === TEMPLATE_FORMAT && parsed?.template != null
  } catch {
    return false
  }
}

/** 深拷贝（导入数据消毒：剥离意外引用型字段）。 */
export function safeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// src/client/lib/bundle.ts
//
// 导入导出 v2 bundle 客户端辅助（架构文档 §6.4）：格式常量与形状判定，
// 供 Studio 导入/导出（title bar 按钮）与 Inspector 使用。

/** 角色模板导出标识。 */
export const TEMPLATE_FORMAT = 'dsh-vw-template'

/** 判定 JSON 文本是否为角色模板导出。 */
export function isRoleTemplateBundle(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as { format?: unknown; template?: unknown }
    return parsed?.format === TEMPLATE_FORMAT && parsed?.template != null
  } catch {
    return false
  }
}

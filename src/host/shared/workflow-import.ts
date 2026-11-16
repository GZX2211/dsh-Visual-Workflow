/** 外部工作流导入后的兼容状态。 */
export type WorkflowImportStatus = "ready" | "review-required" | "blocked"

/** 导入问题级别：error 会阻止直接运行，warning 要求人工复核。 */
export type WorkflowImportIssueLevel = "warning" | "error"

/** 外部工作流节点或依赖的可定位兼容问题。 */
export interface WorkflowImportIssue {
  code: string
  level: WorkflowImportIssueLevel
  message: string
  nodeId?: string
  sourceType?: string
}

/** 外部依赖只保存身份，不保存来源平台中的密钥。 */
export interface WorkflowImportDependency {
  kind: "model" | "tool" | "knowledge" | "http" | "credential"
  provider?: string
  name?: string
  requiresRebinding: boolean
}

/** 随工作流模板持久化的来源与兼容性报告。 */
export interface WorkflowImportMetadata {
  platform: "dify"
  sourceVersion?: string
  importedAt: string
  status: WorkflowImportStatus
  issues: WorkflowImportIssue[]
  dependencies: WorkflowImportDependency[]
}

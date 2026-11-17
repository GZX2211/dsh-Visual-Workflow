export interface DifyToolUpload {
  name: string
  base64: string
}

export interface DifyToolMigrationPackageResult {
  sourcePath: string
  status: "installed" | "converted" | "skipped" | "duplicate" | "failed"
  packageId?: string
  dshPackageId?: string
  version?: string
  disposition?: string
  tools?: string[]
  credentials?: string[]
  error?: { code: string; message: string }
}

export interface DifyToolMigrationResult {
  uploadName: string
  packages: DifyToolMigrationPackageResult[]
  summary: {
    discovered: number
    installed: number
    converted: number
    skipped: number
    duplicates: number
    failed: number
  }
}

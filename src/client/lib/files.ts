// src/client/lib/files.ts
//
// Client 文件与浏览器工具（照搬旧项目 src/client/lib/files.js，TS 化）：
// 文件读取（文本/Base64）、下载、localStorage 数值/布尔读写。

/** 读取文件为 UTF-8 文本。 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

/** 读取文件为 Base64（DataURL 剥前缀）。 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** 浏览器下载（Blob + 临时 a 标签）。 */
export function download(content: string, fileName: string, mediaType = 'application/json'): void {
  const blob = new Blob([content], { type: mediaType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** localStorage 数值读取（非法回退）。 */
export function storedNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/** localStorage 布尔读取（"1" 为真，缺失回退）。 */
export function storedBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

/** localStorage 写入（尽力而为）。 */
export function keepLayout(key: string, value: string | number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // 忽略（隐私模式等）
  }
}

/** 文本截断（超出加省略号；空值回退 —）。 */
export function truncateText(value: unknown, limit: number): string {
  const text = String(value ?? '').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : (text || '—')
}

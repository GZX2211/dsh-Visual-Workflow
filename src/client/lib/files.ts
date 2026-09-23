// src/client/lib/files.ts
//
// Client 文件与浏览器工具（照搬旧项目 src/client/lib/files.js，TS 化）：
// 文件读取（文本/Base64）与下载。
// localStorage 读写不在此处：界面布局等持久化统一走 lib/storage.ts 的 StorageLike
// 注入面（调用方负责传入具体存储），避免 lib 直接依赖 window。

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

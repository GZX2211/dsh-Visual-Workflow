// src/host/storage/managed-files.ts
//
// 受管文件（<dataDir>/data/files/）：非文本文件模板的受管拷贝入口。
// 为什么归 storage：这是数据目录的布局与写入路径（布局常量见 storage-paths），不是
// HTTP 关注点；写入复用本模块的通用原子原语与进程内锁，不再自建第二套发布协议。
//
// 语义：拷贝为深拷贝解耦——源文件删除后模板仍可用（模板记录 managedPath）。

import { mkdir, readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { atomicReplaceFile, withFileLock } from './atomic.js'
import { managedFilesDir } from './storage-paths.js'

/**
 * 受管文件名消毒：仅剔除路径分隔符与 Windows/会话危险字符，保留中文等
 * Unicode 字符（旧实现把非 ASCII 全部替换为 '_'，导致「任务清单规则.md」
 * 变成「______.md」，卡片显示错乱）。防目录穿越：剥 basename + 去 .. + 去控制字符。
 */
export function safeManagedName(name: string): string {
  const base = basename(String(name ?? '').trim())
  // 去除路径分隔符、通配/危险字符与控制字符；保留中文、字母、数字与 . _ - 空格
  const cleaned = base
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '') // 前置点（隐藏/穿越）
    .slice(0, 120)
  return cleaned || `file-${Date.now().toString(36)}`
}

/** 受管文件绝对路径（data/files/<safeName>）。 */
export function managedFilePath(dataDir: string, name: string): string {
  return join(managedFilesDir(dataDir), safeManagedName(name))
}

/**
 * 受管拷贝：base64 内容或本地源文件 → data/files/<safeName>（原子发布）。
 * 返回受管相对路径（managedPath）与文件名。
 *
 * 并发语义：同一目标的写入先经进程内锁串行化，再交给通用原子原语发布
 * （临时文件 + fsync + rename + 失败清理都由原语负责）。
 */
export async function copyIntoManagedFile(
  dataDir: string,
  input: { name: string; base64?: string; sourcePath?: string },
): Promise<{ managedPath: string; fileName: string }> {
  const fileName = safeManagedName(input.name)
  const target = managedFilePath(dataDir, fileName)
  await mkdir(managedFilesDir(dataDir), { recursive: true })
  let content: Buffer
  if (typeof input.base64 === 'string' && input.base64) {
    content = Buffer.from(input.base64, 'base64')
  } else if (typeof input.sourcePath === 'string' && input.sourcePath) {
    content = await readFile(input.sourcePath)
  } else {
    throw new Error('需要 base64 内容或 sourcePath 源文件路径')
  }
  await withFileLock(target, () => atomicReplaceFile(target, content))
  return { managedPath: join('data', 'files', fileName), fileName }
}

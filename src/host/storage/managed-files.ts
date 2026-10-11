// src/host/storage/managed-files.ts
//
// 受管文件（<dataDir>/data/files/）：非文本文件模板的受管拷贝入口。
// 为什么归 storage：这是数据目录的布局与写入路径（布局常量见 storage-paths），不是
// HTTP 关注点；写入复用本模块的通用原子原语与**组合锁**（磁盘锁在外、进程内锁在内），
// 不再自建第二套发布协议。
//
// 语义：拷贝为深拷贝解耦——源文件删除后模板仍可用（模板记录 managedPath）。

import { mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { atomicReplaceFile, withJsonLock } from './atomic.js'
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
 * 受管拷贝：base64 内容 → data/files/<safeName>（原子发布）。
 * 返回受管相对路径（managedPath）与文件名。
 *
 * 只接受 base64：内容必须来自调用方已持有的字节，不接受路径（否则即为
 * 「读宿主任意路径并落入可下载目录」的越权面）。零消费方的 sourcePath 分支已删除。
 *
 * 并发语义：写入经**组合锁**（磁盘锁在外 + 进程内锁在内，见 atomic 的 withJsonLock）
 * 串行化，再由通用原子原语发布（临时文件 + fsync + rename + 失败清理）。
 * 为什么必须是组合锁而不是进程内锁：受管文件的两个写入者不在同一进程——宿主（GUI 上传）
 * 与 service-runner（服务进程）共享同一 dataDir；只有进程内锁时，两侧各自原子 rename
 * 仍是「后写覆盖先写」，受管副本的深拷贝解耦语义会被破坏。
 * 行为变化（相对仅进程内锁）：同一受管名被并发占用时，后到者按磁盘锁超时（30s）抛
 * DiskLockError，**不再静默覆盖**；成功后锁文件即被释放（不残留）。
 */
export async function copyIntoManagedFile(
  dataDir: string,
  input: { name: string; base64?: string },
): Promise<{ managedPath: string; fileName: string }> {
  const fileName = safeManagedName(input.name)
  const target = managedFilePath(dataDir, fileName)
  await mkdir(managedFilesDir(dataDir), { recursive: true })
  if (typeof input.base64 !== 'string' || !input.base64) {
    throw new Error('需要 base64 内容')
  }
  const content = Buffer.from(input.base64, 'base64')
  await withJsonLock(target, () => atomicReplaceFile(target, content))
  return { managedPath: join('data', 'files', fileName), fileName }
}

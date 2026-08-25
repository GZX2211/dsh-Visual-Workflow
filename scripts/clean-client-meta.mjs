// 脚本：scripts/clean-client-meta.mjs（一次性数据修复，不入测试套件）
// 用途：清理 dataDir 下历史残留的前端快照标记（_draft/_clientMeta）。
// 背景：旧实现把 _draft 随模板/服务/工作流写盘，刷新后已入库对象被误判为
// 本地草稿（本地删除不走后端、保存行为错乱）。本脚本剥除标记并原子回写。

import { readdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('用法：node scripts/clean-client-meta.mjs <dataDir>')
  process.exit(1)
}

const META_KEYS = ['_draft', '_clientMeta']

async function* jsonFiles(dir) {
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name.endsWith('.json')) yield join(dir, name)
  }
}

let cleaned = 0
for (const sub of ['roles', 'data', 'workflows', 'services']) {
  const dir = join(root, sub)
  for await (const file of jsonFiles(dir)) {
    let text = ''
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    let doc
    try {
      doc = JSON.parse(text)
    } catch {
      continue // 非 JSON（如 *.sessions.json 之外的纯文本）跳过
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) continue
    let changed = false
    for (const key of META_KEYS) {
      if (key in doc) {
        delete doc[key]
        changed = true
      }
    }
    if (!changed) continue
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(doc, null, 2), 'utf8')
    await rename(temporary, file)
    cleaned += 1
    console.log(`清理：${file}`)
  }
}
console.log(`完成：清理 ${cleaned} 个文件`)

// docs/插件闭环测试/probe-d04-verify.mjs
//
// D-04 修复验证探针：本地模型不可用（降级）时，原因必须**三通道可见**——
// 引擎的 degradeReason、embed() 的报错文本、宿主日志通道。修复前只有一条不保证落盘的 warn。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-d04-verify.mjs"
import { EmbeddingService } from '../../lib/embedding/engine.js'
import { join } from 'node:path'

const warnings = []
const engine = new EmbeddingService({
  modelDir: join(process.cwd(), '.tmp', 'no-such-model-dir-for-probe'),
  logger: { warn: (m) => warnings.push(m) },
})

const src = await engine.ensureReady()
console.log('① source =', src, '（期望 bm25）')
console.log('② degradeReason =', engine.degradeReason)

let message = ''
try {
  await engine.embed(['探针'])
} catch (error) {
  message = error instanceof Error ? error.message : String(error)
}
console.log('③ embed 报错 =', message)
console.log('④ 日志通道条数 =', warnings.length, '| 首条 =', warnings[0] ?? '(无)')

const reason = String(engine.degradeReason ?? '')
const ok = src === 'bm25'
  && reason.includes('本地嵌入模型资产缺失')
  && message.includes('本地嵌入模型资产缺失')
  && warnings.length === 1
console.log(ok ? '结论：修复生效（降级原因三通道可见：degradeReason / 报错 / 日志）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

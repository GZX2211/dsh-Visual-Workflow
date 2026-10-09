// docs/插件闭环测试/probe-fix-verify.mjs
//
// D-03 修复验证探针（真实代码路径：真实惰性引擎 + 真实 VectorIndex）。
// 修复前：indexer 读到未就绪引擎的 source='bm25' 就跳过向量写入 → file.source='bm25'。
// 修复后：先 ensureReady 再判定 → 真实能力 local → file.source='embedding' 且块带 512 维向量。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-fix-verify.mjs"
import { EmbeddingService } from '../../lib/embedding/engine.js'
import { VectorIndex } from '../../lib/embedding/indexer.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'vw-probe-'))
const engine = new EmbeddingService({ logger: { warn: (m) => console.log('WARN>>', m) } })
console.log('① 就绪前（惰性未加载）：source =', engine.source, '| dimension =', engine.dimension)

const index = new VectorIndex(join(dir, 'idx.json'))
const t0 = Date.now()
const file = await index.rebuild({
  dataId: 'probe',
  records: [
    { text: '数据库 向量 检索 引擎', source: 'probe' },
    { text: '咖啡 拉花 艺术', source: 'probe' },
  ],
  engine,
})
console.log(
  '② rebuild 结果：source =', file.source,
  '| dimension =', file.dimension,
  '| 首块向量维数 =', file.chunks[0]?.vector?.length ?? 0,
  '| 耗时 =', Date.now() - t0, 'ms',
)
console.log('③ 就绪后：source =', engine.source, '| dimension =', engine.dimension)

const res = await index.search('向量 检索', 2, engine)
console.log('④ search：source =', res?.source, '| hits =', res?.hits?.length, '| 首命中 =', res?.hits?.[0]?.text)

await rm(dir, { recursive: true, force: true })
engine.dispose()

const ok = file.source === 'embedding' && (file.chunks[0]?.vector?.length ?? 0) === 512 && res?.source === 'embedding'
console.log(ok ? '结论：修复生效（未预热也能建立并使用向量索引）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

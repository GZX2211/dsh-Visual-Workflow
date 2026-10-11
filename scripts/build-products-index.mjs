// scripts/build-products-index.mjs
// 一次性工具：为指定数据库节点构建本地向量索引，复用插件自身的
// buildIndexForDatabase + EmbeddingService 路径（等价于 GUI 数据库面板「建立索引」）。
// 产出：<dataDir>/data/vector/<nodeId>.json
// 用法：node scripts/build-products-index.mjs <dataDir> <nodeId> [sqlitePath]
//   也可用环境变量 WF_DATA_DIR / WF_NODE_ID / WF_SQLITE_PATH 提供。
//   目标路径必须由调用方给出：本脚本会写入 <dataDir> 下的宿主数据目录，
//   内置任何机器默认值都可能误改他人数据。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEmbeddingEngine } from '../lib/embedding/engine.js'
import { buildIndexForDatabase } from '../lib/tools/wf-db-query/service.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [dataDirArg, nodeIdArg, sqlitePathArg] = process.argv.slice(2)
const dataDir = dataDirArg ?? process.env.WF_DATA_DIR
const nodeId = nodeIdArg ?? process.env.WF_NODE_ID
const sqlitePath = sqlitePathArg ?? process.env.WF_SQLITE_PATH ?? resolve(ROOT, 'assets', 'products.sqlite')

if (!dataDir || !nodeId) {
  console.error('用法：node scripts/build-products-index.mjs <dataDir> <nodeId> [sqlitePath]')
  console.error('  或设置环境变量 WF_DATA_DIR / WF_NODE_ID / WF_SQLITE_PATH')
  process.exit(2)
}

const node = {
  id: nodeId,
  kind: 'database',
  data: {
    label: nodeId,
    description: '本地向量索引构建',
    dbType: 'local',
    dbKind: 'sqlite',
    localPath: sqlitePath,
    vectorSource: 'embedding',
  },
}

const engine = await createEmbeddingEngine({})
console.error('engine source =', engine.source, 'dimension =', engine.dimension)

try {
  const { file, truncated } = await buildIndexForDatabase(dataDir, node, engine)
  console.error('index written:', JSON.stringify({ source: file.source, dimension: file.dimension, chunks: file.chunks.length, chunkSize: file.chunkSize, overlap: file.overlap, truncated, dataId: file.dataId }))
  console.log('INDEX_OK', JSON.stringify({ source: file.source, dimension: file.dimension, chunks: file.chunks.length, truncated }))
} finally {
  engine.dispose()
}

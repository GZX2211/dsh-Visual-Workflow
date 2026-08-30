// 一次性工具：为 workflow 中的数据节点 `database-mtfmuocq-aaun` 构建本地向量索引，
// 复用插件自身的 buildIndexForDatabase + EmbeddingService 路径（等价于 GUI 数据库面板"建立索引"）。
// 产出：<dataDir>/data/vector/database-mtfmuocq-aaun.json
// 用法：node scripts/build-products-index.mjs
import { createEmbeddingEngine } from '../lib/embedding/engine.js'
import { buildIndexForDatabase } from '../lib/tools/data-tools.js'

const dataDir = 'C:\\Users\\GZX\\.dsh\\visual-workflow'
const node = {
  id: 'database-mtfmuocq-aaun',
  kind: 'database',
  data: {
    label: '测试数据库SQlite',
    description: '测试检索',
    dbType: 'local',
    dbKind: 'sqlite',
    localPath: 'D:\\AiCoding-Gzx\\HarnessPlugin\\dsh-visual-workflow\\assets\\products.sqlite',
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

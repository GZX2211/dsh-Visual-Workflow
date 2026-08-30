// 临时验证脚本：本地加载 bge-small-zh-v1.5 语义嵌入模型，确认语义向量路径可用。
// 用法：node scripts/verify-embed-model.mjs
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from '@huggingface/transformers'

const dir = join(process.cwd(), 'assets', 'models', 'bge-small-zh-v1.5')
console.error('modelDir =', dir)
for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
  console.error(`  ${f}: ${existsSync(join(dir, f)) ? 'OK' : 'MISSING'}`)
}

try {
  const extractor = await pipeline('feature-extraction', dir, { dtype: 'q8', local_files_only: true })
  const out = await extractor(['电子产品使用说明', '笔记本电脑'], { pooling: 'cls', normalize: true })
  console.error('dims =', JSON.stringify(out.dims))
  const dim = out.dims?.[1] ?? 0
  console.error('dimension =', dim)
  const row = out.data.subarray(0, dim)
  let norm = 0
  for (let i = 0; i < dim; i += 1) norm += row[i] * row[i]
  console.error('row0 L2 norm (should be ~1) =', Math.sqrt(norm).toFixed(6))
  console.log('EMBED_MODEL_OK dim=' + dim)
} catch (error) {
  console.error('EMBED_MODEL_FAIL:', error && error.message ? error.message : String(error))
  process.exit(1)
}

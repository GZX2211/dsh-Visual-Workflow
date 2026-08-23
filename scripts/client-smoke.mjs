// Visual Workflow —— client bundle 冒烟（T-003，由旧项目 scripts/client-smoke.mjs 改造）。
//
// 断言（构建后冒烟，node 原生运行，不依赖其它框架）：
//   1. lib/client.js 存在；
//   2. 含 window.__ModuleLoader__.load({ 包装（loader 协议，与官方 tsdown.client.ts 一致）；
//   3. 含 style[data-plugin]（CSS 注入机制——全局 CSS loader 注入带 data-plugin 的样式标签）；
//   4. lib/index.js（host 产物）仍存在（client build 未清空 host 输出）；
//   5. lib/client.js.map（sourcemap）存在。
//
// 与旧项目的差异（按新产物形态改造）：
//   - 旧项目用 esbuild + 手写 __ModuleLoader__ 包装 + 自算 client-rev 哈希，并冒烟
//     React UI 组件（VisualWorkflowView/Studio/ComboManager）。
//   - 新项目 client bundle 由 tsdown（复用官方 __ModuleLoader__/style 注入协议）产出，
//     T-003 阶段为空入口（无 React UI 组件），故只做产物形态断言；组件渲染冒烟将在
//     T-041 起 client 入口真实挂载后补回（不可在此引入 React vm 沙箱，避免空入口误报）。
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// 项目根目录（package.json 所在目录）。
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 相对项目根的产物路径。 */
function artifact(rel) {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url))
}

/** 自定义断言报错，统一带产物路径上下文。 */
function fail(msg) {
  assert.fail(`client smoke: ${msg}`)
}

async function main() {
  // 1. lib/client.js 存在。
  const clientPath = artifact('lib/client.js')
  if (!existsSync(clientPath)) fail('lib/client.js 不存在（client bundle 未产出）')
  const code = await readFile(clientPath, 'utf8')

  // 2. __ModuleLoader__ 包装。断言完整 `window.__ModuleLoader__.load({` 形态，
  //    与官方 banner 一致（packages/client/tsdown.client.ts L562）。
  if (!code.includes('window.__ModuleLoader__.load({')) {
    fail('lib/client.js 缺少 window.__ModuleLoader__.load({ 包装（loader 协议）')
  }

  // 3. style[data-plugin] CSS 注入机制。官方 styleInjectionModule 注入的标签带
  //    data-plugin 属性，选择器写为 `style[data-plugin-css=...]`，故断言子串
  //    `style[data-plugin` 即可覆盖注入代码实际命中。
  if (!code.includes('style[data-plugin')) {
    fail('lib/client.js 缺少 style[data-plugin]（CSS 注入机制未命中）')
  }

  // 4. host 产物仍存在（client build 不得清空 lib/ 下 host 输出）。
  if (!existsSync(artifact('lib/index.js'))) {
    fail('lib/index.js（host 产物）不存在（client build 清空了 host 输出）')
  }

  // 5. sourcemap 文件存在。
  if (!existsSync(artifact('lib/client.js.map'))) {
    fail('lib/client.js.map（sourcemap）不存在')
  }

  // 额外：client dts 转发文件存在（exports["./client"].types 真实命中）。
  if (!existsSync(artifact('lib/types/client/index.d.ts'))) {
    fail('lib/types/client/index.d.ts 不存在（exports["./client"].types 无法命中）')
  }

  console.log('client smoke: OK（__ModuleLoader__ 包装 / style[data-plugin] / host 并存 / sourcemap）')
}

main().catch((error) => {
  console.error(error?.message ?? error)
  process.exitCode = 1
})

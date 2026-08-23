// 构建编排（P01 最小可用版，T-003 将扩展）。
//
// 方案 B（类型产物）：tsc 分两次发射（详见下方注释）——
//   1. host tsc 发射 JS → lib/（入口 lib/index.js，声明关闭）；
//   2. host tsc 仅发射声明 → lib/types/（入口 lib/types/index.d.ts）。
// 选择 B 而非单次 emit 的理由：官方仓库（packages/client/*）约定 types 一律
// 落在 lib/types/（package.json 的 "types": "lib/types/index.d.ts"），与架构文档
// §2.1 的 exports 形态逐字一致；单次 emit 会把声明与 JS 混在 lib/ 下，
// 导致 exports 的 types 路径（lib/types/index.d.ts）无法命中真实产物。
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// typescript 编译器入口（直接以 node 执行其 bin 脚本，跨平台且不依赖 shell shim）。
const tscPath = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

/** 以继承 stdio 方式执行 tsc（node 直接 spawn，避免 Windows 下 via-shell 与 pipe 捕获问题）。 */
function runTsc(args) {
  execFileSync(process.execPath, [tscPath, ...args], {
    stdio: 'inherit',
  })
}

// 第一步：host JS 发射（declaration 已由 tsconfig.host.json 关闭）。
runTsc(['-p', 'tsconfig.host.json'])

// 第二步：声明二次发射到 lib/types（--declaration 覆盖 tsconfig 的 declaration:false，
// 配合 --emitDeclarationOnly 仅产出 .d.ts；--outDir 重定位出 lib/types，
// 使 exports["."].types / exports["./client"].types 指向的产物路径真实存在）。
runTsc(['-p', 'tsconfig.host.json', '--declaration', '--emitDeclarationOnly', '--outDir', 'lib/types'])

// TODO(P02/T-003)：client bundle 构建（tsdown，参照官方 tsdown.client.ts 模式——
// __ModuleLoader__ 包装 / CSS 注入 / sourcemap / host-client 产物并存 / 纯度门）。
// 产物 lib/client.js 与 lib/types/client/index.d.ts 将在该阶段由 scripts/build-client.ts 产出，
// exports["./client"] 当前仅为声明占位。

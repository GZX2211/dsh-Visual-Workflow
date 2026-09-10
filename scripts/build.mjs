// 构建编排（T-003 扩展：host tsc 双发射 + client dts 发射 + client tsdown bundle）。
//
// 方案 B（类型产物）：tsc 分次发射——
//   1. host tsc 发射 JS → lib/（入口 lib/index.js，声明关闭）；
//   2. host tsc 仅发射声明 → lib/types/（入口 lib/types/index.d.ts）；
//   3. client tsc 仅发射声明 → lib/types/client/（入口经 forwarding 得到 index.d.ts）；
//   4. client tsdown bundle → lib/client.js（scripts/build-client.ts，__ModuleLoader__ 协议）。
// 选择 B 而非单次 emit 的理由：官方仓库（packages/client/*）约定 types 一律落在
// lib/types/（package.json 的 "types": "lib/types/index.d.ts"），与架构文档 §2.1 的
// exports 形态逐字一致；单次 emit 会把声明与 JS 混在 lib/ 下，导致 exports 的 types
// 路径（lib/types/index.d.ts）无法命中真实产物。
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// typescript 编译器入口（直接以 node 执行其 bin 脚本，跨平台且不依赖 shell shim）。
const tscPath = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

// tsdown CLI 入口（node_modules/tsdown/package.json 的 bin 字段："./dist/run.mjs"）。
// 直接以 node 执行其 bin JS，跨平台且不依赖 shell shim / node_modules/.bin。
const tsdownPath = fileURLToPath(new URL('../node_modules/tsdown/dist/run.mjs', import.meta.url))

/**
 * 以继承 stdio 方式执行一个 node bin（process.execPath 直接 spawn，不捕获 pipe）。
 * 为什么必须 stdio: 'inherit'：Windows 沙箱下 node child_process 以默认 stdio:'pipe'
 * 捕获子进程输出会触发 EPERM（named pipe 被禁）；inherit 让输出直通终端，规避该边界。
 */
function runNodeBin(binPath, args) {
  execFileSync(process.execPath, [binPath, ...args], {
    stdio: 'inherit',
  })
}

/** 以继承 stdio 方式执行 tsc（node 直接 spawn，避免 via-shell 与 pipe 捕获问题）。 */
function runTsc(args) {
  runNodeBin(tscPath, args)
}

// 第零步：清空类型产物目录。
// 为什么必须先清理：tsc 只「发射」不「删除」——源码模块被改名/删除后，lib/types 下的旧
// .d.ts 会作为幽灵产物留在 git 分发包里（历史已出现过 lib/types/client/client/studio/
// SplitWindow.d.ts 这类无源文件的声明）。lib/types 下的内容**全部**由本脚本第二~三步生成，
// 故整体清空是安全且唯一的收敛手段。lib/ 下的 host JS 由 tsc 覆盖发射、lib/client.js 由
// tsdown 覆盖发射，无需清理（且不能整体清空 lib/，否则会连带删掉 client bundle）。
rmSync(fileURLToPath(new URL('../lib/types', import.meta.url)), { recursive: true, force: true })

// 第一步：host JS 发射（declaration 已由 tsconfig.host.json 关闭）。
runTsc(['-p', 'tsconfig.host.json'])

// 第二步：host 声明二次发射到 lib/types（--declaration 覆盖 tsconfig 的 declaration:false，
// 配合 --emitDeclarationOnly 仅产出 .d.ts；--outDir 重定位出 lib/types，
// 使 exports["."].types（lib/types/index.d.ts）指向真实产物）。
runTsc(['-p', 'tsconfig.host.json', '--declaration', '--emitDeclarationOnly', '--outDir', 'lib/types'])

// 第三步：client 声明发射到 lib/types/client（tsconfig.client.emit.json 的 rootDir 为
// src（client + shared 共享契约），产出 lib/types/client/client/entry.d.ts）。
// 随后写入 lib/types/client/index.d.ts 作为转发文件，使 exports["./client"].types
// （lib/types/client/index.d.ts）真实命中。
runTsc(['-p', 'tsconfig.client.emit.json'])
writeFileSync(
  fileURLToPath(new URL('../lib/types/client/index.d.ts', import.meta.url)),
  "export * from './client/entry'\n",
)

// 第四步：client bundle（tsdown）。--config 指定 scripts/build-client.ts；--config-loader
// native 让 node 原生 TS（strip-only）进程内加载配置，规避 tsx/unrun 等需 spawn 子进程
// （进而触发 pipe EPERM）的 loader。stdio inherit 输出直通终端。
runNodeBin(tsdownPath, ['--config', 'scripts/build-client.ts', '--config-loader', 'native'])

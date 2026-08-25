// scripts/watch-host.mjs
//
// 开发期 host watch 构建：tsc --watch 编译 src/host → lib/（含 shared、service-runner）。
// 后端 HMR（@deepseek-ai/cordis-plugin-hmr）监听 lib/ 变化自动重载插件，
// 无需重启 dsh web（见 prompt/hmr热重载.md）。
// 常驻进程；与 `pnpm build` 互斥（两者同写 lib/，勿并行）。
// stdio inherit 规避 Windows 沙箱 spawn pipe EPERM（与 watch-client.mjs 同约定）。
//
// 用法：node scripts/watch-host.mjs

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

// tsconfig.host.json 已配置 outDir: lib（方案 B：tsc 发射 JS 到 lib/）
const child = spawn(process.execPath, [tscBin, '-p', 'tsconfig.host.json', '--watch'], {
  cwd: root,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  console.error(`watch-host: tsc exited with code ${String(code)}`)
  process.exit(code ?? 1)
})

process.once('SIGINT', () => child.kill('SIGINT'))
process.once('SIGTERM', () => child.kill('SIGTERM'))

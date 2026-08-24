// scripts/watch-client.mjs
//
// 开发期 client watch 构建：仅重打包 lib/client.js（tsdown --watch）。
// 浏览器侧经 dsh-client-hmr 订阅 SSE rebuilt 帧自动刷新（见 prompt/hmr热重载.md）。
// 常驻进程；与 `pnpm build` 互斥（两者同写 lib/，勿并行）。
// stdio inherit 规避 Windows 沙箱 spawn pipe EPERM（与 build.mjs 同约定）。

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tsdown = join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs')

const child = spawn(process.execPath, [tsdown, '--config', 'scripts/build-client.ts', '--watch'], {
  cwd: root,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  console.error(`watch-client: tsdown exited with code ${String(code)}`)
  process.exit(code ?? 1)
})

process.once('SIGINT', () => child.kill('SIGINT'))
process.once('SIGTERM', () => child.kill('SIGTERM'))

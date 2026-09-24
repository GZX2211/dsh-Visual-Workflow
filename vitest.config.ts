// vitest 全局配置（测试超时契约的唯一承接点）。
//
// 为什么需要它：本仓库在 `--pool=threads` 下执行 141 个测试文件，其中大量用例带真实副作用
// （真实磁盘锁与 fsync、真实定时器与 5s 宽限期、动态 import、tsdown 构建产物断言、ONNX
// 嵌入模型加载、可选数据库驱动）。默认 testTimeout = 5000ms 与用例内
// `vi.waitFor(..., { timeout: 5000 })` 同为 5s，两者互相竞争：并行负载放大任一等待时，
// 失败信息会退化成 "Test timed out in 5000ms"（指向测试文件顶部，看不出是哪一步），
// 而不是清晰的断言失败。已观测到 host/service/manager.test.ts 的 crashed 回写、
// watchdog 的落盘等待、cordis-patch 的 5s 动态 import 三处偶发此现象。
//
// 口径（重要）：**放宽的是用例整体上限，不是断言强度**。所有用例的等待条件、断言与数据
// 原样保留；只有「单个用例最多跑多久」从 5s 提到 20s，使内部等待（含 vi.waitFor）能先于
// 外层超时给出可读失败。任何真实挂起或逻辑回归仍会失败。
//
// 为什么不在此限制并行 worker 数：vitest 4 的 `UserConfig` 不再暴露
// `maxWorkers`/`minWorkers`（属 resolve 后的内部字段），可行入口是 pool 专属选项或 CLI
// flag——都会与本仓库 `--pool=threads` 的显式声明重复而互相覆盖。对并行负载格外敏感的
// 少数边缘用例改为在用例内显式放宽 `vi.waitFor` 超时（意图就地注释）。

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 单测/集成用例的整体上限（含内部 vi.waitFor 等待）：20s 覆盖并行负载放大，
    // 又远小于「真挂起」应当被发现的尺度。
    testTimeout: 20_000,
    // 钩子（beforeEach/afterEach 的临时目录与 store 清理）同口径放宽。
    hookTimeout: 20_000,
  },
})

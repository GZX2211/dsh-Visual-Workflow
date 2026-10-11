// vitest 全局配置（测试超时与并发契约的唯一承接点）。
//
// 为什么需要它：本仓库在 `--pool=threads` 下执行 `tests/**/*.test.ts{,x}` 的全量测试文件（数量会随开发增减，
// 不是契约；观测值 218 仅供勾稽现状，取证 `pnpm exec vitest list --filesOnly`），
// 其中大量用例带真实副作用（真实磁盘锁与 fsync、真实定时器与 5s 宽限期、动态 import、
// tsdown 构建产物断言、ONNX 嵌入模型加载、可选数据库驱动）。默认 testTimeout = 5000ms 与用例内
// `vi.waitFor(..., { timeout: 5000 })` 同为 5s，两者互相竞争：并行负载放大任一等待时，
// 失败信息会退化成 "Test timed out in 5000ms"（指向测试文件顶部，看不出是哪一步），
// 而不是清晰的断言失败。已观测到 host/service/manager.test.ts 的 crashed 回写、
// watchdog 的落盘等待、cordis-patch 的 5s 动态 import 三处偶发此现象。
// 其中 crashed 回写的上界由磁盘锁获取上限（30s）决定，20s 整体上限覆盖不了，故该用例自带
// 预算与上限（见 tests/host/service/manager.test.ts 的 CRASH_WAIT_MS / CRASH_TEST_TIMEOUT_MS）。
//
// 口径（重要）：**放宽的是用例整体上限，不是断言强度**。所有用例的等待条件、断言与数据
// 原样保留；只有「单个用例最多跑多久」从 5s 提到 60s，使内部等待（含 vi.waitFor）能先于
// 外层超时给出可读失败。任何真实挂起或逻辑回归仍会失败。
//
// 为什么限制并行 worker 数（D12-01）：本治理周期实测「全量并行 `pnpm check` 在文档化机器上
// 确定性 OOM」。**旧注释「vitest 4 的 UserConfig 不再暴露 maxWorkers/minWorkers」已失效**——
// 实测 vitest 4.1.11 的类型定义中 `InlineConfig.maxWorkers?: number | string` 合法可用
// （node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts），`defineConfig` 直接接受它。
// 故此处设保守上限 4：既保留并行收益，又把峰值内存压到机器可承受范围。
// 上限不必与 `--pool=threads` 冲突：pool 决定调度器，maxWorkers 决定并发度。
// 对并行负载格外敏感的少数边缘用例，仍在用例内显式放宽 `vi.waitFor` 超时（意图就地注释）。

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 单测/集成用例的整体上限（含内部 vi.waitFor 等待）：60s 覆盖并行负载放大，
    // 又远小于「真挂起」应当被发现的尺度；瓶颈是 contract 构建用例与其余用例并行时的 CPU 饥饿。
    testTimeout: 60_000,
    // 钩子（beforeEach/afterEach 的临时目录与 store 清理）同口径放宽。
    hookTimeout: 60_000,
    // 并发上限（保守值）：消除「文档化机器上 pnpm check 确定性 OOM」。
    // 4 = 在 13.9GB 机器上留出充足余量；提高前请先用 `pnpm check` 全量实测峰值内存。
    maxWorkers: 4,
  },
})

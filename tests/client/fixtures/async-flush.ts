// tests/client/fixtures/async-flush.ts
//
// 客户端异步等待夹具：把「刷 N 次微任务」这种与实现内部 await 层数硬耦合的写法，
// 收敛为语义化、可复用的等待原语。tests/AGENTS.md 要求「显式等待目标完成，禁止任意 sleep」，
// 裸 `await Promise.resolve()` 是同一问题的微任务版本——实现里多加/少加一次 await 都会让
// 用例以「断言不完整」或「提前通过」的形式失真。
//
// 两种原语的适用面：
//   - waitForCondition：已知要等待的可观察事实（调用次数、dispatch 结果、DOM 文本）时首选；
//   - flushAsync：只等待「当前已排队的异步链全部落定」时使用（在 act 环境内包一层 flush）。
//
// 为什么两者都包 act：客户端用例运行在 IS_REACT_ACT_ENVIRONMENT 下，act 之外的异步更新
// 会让 React 打印「update not wrapped in act」并可能丢失刷新时机。

import { act } from 'react'
import { vi } from 'vitest'

/**
 * 等待某个可观察条件成立（默认 1s 超时，测试超时上限远高于此）。
 * 条件不成立即失败——这正是「实现变化时用例必须转红」的保证。
 */
export async function waitForCondition(assertion: () => void, timeout = 1000): Promise<void> {
  await vi.waitFor(assertion, { timeout })
}

/**
 * 冲刷当前已排队的微任务链（含 React 的异步调度）。
 * 不引入计时器依赖：只推进微任务队列，不产生真实等待。
 */
export async function flushAsync(times = 1): Promise<void> {
  await act(async () => {
    for (let i = 0; i < times; i += 1) await Promise.resolve()
  })
}

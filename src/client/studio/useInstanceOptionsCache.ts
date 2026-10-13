// src/client/studio/useInstanceOptionsCache.ts
//
// 「开启新会话」+ 工作区路径（StudioState.instanceOptions）的落盘接线：写缓存的
// 本体是 instance-options.ts（纯函数 + StorageLike 注入），本 hook 只负责「何时写」。
//
// 为什么不能沿用「effect 依赖 instanceOptions 就同步写」：工作区路径是逐字符 dispatch 的
// 受控输入，逐字符同步写 localStorage 会在打字期间产生连续的同步磁盘写（输入框所在主线程
// 被 IO 拖慢，长路径尤其明显）。与 panel-layout 的口径一致——写入必须由「值的真正变化」
// 或「交互结束」触发，而不是每次按键。
//
// 三条不变量：
//   - 值未变不写：写前与上次已落盘的值（含初始恢复值）按序列化结果比对，相等即跳过；
//   - 连续输入只写一次：改动后等 DEBOUNCE_MS 静默窗口，期间的新改动重新计时；
//   - 不为省写入而丢改动：窗口未结束就卸载时，由卸载清理补写最后一份待落盘的值。
//
// 防抖窗口与卸载补写拆成两个 effect：若把「补写」放在窗口 effect 的清理里，该清理在
// **每次依赖变化**时都会执行（React 先清理再重建），于是每个按键都会立即写一次盘，
// 防抖形同虚设；故窗口 effect 的清理只取消定时器，补写只由「依赖不含 options」的
// 卸载 effect 承担，二者以 pending 标记（而非定时器句柄）交接待落盘状态。

import { useEffect, useRef } from 'react'
import type { InstanceOptions } from './instance-options.js'
import { keepInstanceOptions } from './instance-options.js'
import type { StorageLike } from '../lib/storage.js'

/**
 * 落盘防抖窗口。300ms 与「输入停顿即视为一次编辑」的交互节奏对齐：
 * 用户连打不写盘，停手后一次写入；同时短于用户能感知的「记忆延迟」。
 */
export const INSTANCE_OPTIONS_DEBOUNCE_MS = 300

/** 落盘值口径（与 keepInstanceOptions 的归一化一致），用于「值未变不写」比对。 */
function optionsKeyOf(options: InstanceOptions): string {
  return JSON.stringify({
    newSession: options.newSession === true,
    workspacePath: typeof options.workspacePath === 'string' ? options.workspacePath : '',
  })
}

/** 浏览器守卫：无 window / 取 localStorage 失败（隐私模式）时返回 null，落盘静默降级。 */
function storageOrNull(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * 把 instanceOptions 防抖落盘到注入的存储（浏览器环境默认 localStorage；
 * 初始读取在 useStudioState 初始化工厂完成，本 hook 只写不读）。
 */
export function useInstanceOptionsCache(
  options: InstanceOptions,
  storage: StorageLike | null = storageOrNull(),
): void {
  /** 上次已落盘的值。以初始 state（可能来自缓存恢复）为基准：值未变时不产生任何写入。 */
  const persistedRef = useRef(optionsKeyOf(options))
  /**
   * 最新值的镜像。卸载补写的 effect 依赖只有 storage，其清理闭包停留在首次渲染，
   * 只能经 ref 读到「此刻」的值。
   */
  const latestRef = useRef(options)
  /** 待落盘的定时器句柄：存在即表示静默窗口尚未结束。 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * 是否存在「已改动但尚未落盘」的值。与定时器句柄解耦——窗口 effect 的清理会先清掉句柄，
   * 卸载补写仍须据此判断有无待落盘改动。
   */
  const pendingRef = useRef(false)

  useEffect(() => { latestRef.current = options }, [options])

  useEffect(() => {
    // 与已落盘的值一致 → 无改动可落；若曾改动后又回到该值，同时取消待写窗口，
    // 否则窗口到期会把已落盘的值再写一遍
    if (optionsKeyOf(options) === persistedRef.current) {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
      pendingRef.current = false
      return undefined
    }
    if (!storage) return undefined

    pendingRef.current = true
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      pendingRef.current = false
      keepInstanceOptions(storage, latestRef.current)
      persistedRef.current = optionsKeyOf(latestRef.current)
    }, INSTANCE_OPTIONS_DEBOUNCE_MS)

    // 清理只取消定时器：写盘由窗口到期或卸载补写承担
    return () => {
      if (timerRef.current === null) return
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [options, storage])

  // 卸载补写：防抖只延后写入，不得丢掉用户的记忆（窗口内关面板/刷新前）。
  // 依赖不含 options，故选项变化不会触发它，只在真正卸载时执行一次。
  useEffect(() => () => {
    if (!pendingRef.current) return
    pendingRef.current = false
    if (!storage) return
    keepInstanceOptions(storage, latestRef.current)
    persistedRef.current = optionsKeyOf(latestRef.current)
  }, [storage])
}

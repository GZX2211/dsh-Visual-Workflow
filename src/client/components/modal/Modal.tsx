// src/client/components/modal/Modal.tsx
//
// 弹层原语：backdrop + role="dialog" + aria-modal + Escape 关闭 + 初始聚焦 + 焦点约束。
// 各弹层此前各写一套 backdrop 骨架且无障碍属性不一致（MCP 导入弹层缺 role/aria-modal，
// 全部弹层无 Escape 关闭与焦点约束）；此处收敛为唯一本体，调用方只保留自己的外观类与内容。
//
// 交互语义与收敛前保持一致：背景层不响应点击（各弹层原本即不靠点背景关闭），
// Escape 走调用方传入的关闭请求。

import { useEffect, useRef, type ReactNode } from 'react'

export interface ModalProps {
  /** 弹层容器外观类（各弹层保持既有类名与视觉，原语只追加 wf-modal）。 */
  className: string
  /** 背景层外观类。 */
  backdropClassName: string
  /** 弹层可访问名：取调用方已有的词典标题，读屏据此播报。 */
  label: string
  /** 关闭请求（Escape；关闭按钮仍由调用方自行绑定同一请求）。 */
  onClose(): void
  children: ReactNode
}

/** 打开中的弹层（登记顺序不可作为层级依据，见 isCovered）。 */
const openModals: HTMLElement[] = []

/**
 * 是否有另一个打开中的弹层盖在本弹层之上。
 * 为什么不能只看登记顺序：真嵌套弹层（如组合管理里的「从 mcp.json 导入」）的 effect 是
 * 子先父后执行，登记顺序与视觉层级相反；故同时按 DOM 包含关系判定。
 *   - 本弹层内含的弹层（真嵌套的子弹层）在上；
 *   - 包含本弹层的祖先弹层在下（它是容器，不算覆盖）；
 *   - 互不包含时，后登记（后打开）者在上。
 */
function isCovered(dialog: HTMLElement, index: number): boolean {
  return openModals.some((other, otherIndex) => {
    if (other === dialog) return false
    if (dialog.contains(other)) return true
    if (other.contains(dialog)) return false
    return otherIndex > index
  })
}

/** 可聚焦元素（不含 disabled 与 tabindex="-1"）。 */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ className, backdropClassName, label, onClose, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  // 提交后再镜像最新回调：调用方常传内联箭头函数，若把它作为监听 effect 的依赖，
  // 每次渲染都会重装监听，初始聚焦也会被反复执行而打断用户输入（如导入弹层的文本框）。
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openModals.push(dialog)
    // 初始聚焦落在弹层容器而非首个交互元素：键盘用户有明确落点，且不会误触默认动作。
    // 被上层弹层盖住时不抢焦点（嵌套弹层以子弹层为活动层）。
    if (!isCovered(dialog, openModals.length - 1)) dialog.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isCovered(dialog, openModals.indexOf(dialog))) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusables.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      // 焦点在弹层容器自身或已跑到弹层外（如点过背景）都按「不在可聚焦环内」处理：
      // Node.contains 对自身返回 true，故必须先排除容器本身
      const inside = active !== dialog && dialog.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = openModals.lastIndexOf(dialog)
      if (index >= 0) openModals.splice(index, 1)
      // 关闭后把焦点归还给打开它的元素；触发者可能已随内容卸载，故先校验仍在文档中
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [])

  return (
    <div className={backdropClassName}>
      <div
        ref={dialogRef}
        className={`wf-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

// src/client/lib/service-debug-output.ts
//
// 服务调试流输出的累积器（纯逻辑，归 lib）：把无界的 SSE 增量收敛为**有界**显示文本。
// 为什么需要它：调试流按 token 到达，早期实现把整串 state 反复重拼（O(n²) 字符拷贝），
// 且服务端不封顶时内存与渲染耗时都随输出线性膨胀。本累积器按**逻辑行**组织增量
// （每个数组元素 = 一行，元素内不含换行符），超限时从最前丢行并置「已省略」标记。
//
// 与旧的整串累加保持同一显示文本：正文跨帧原样拼接、错误行前空一行；
// 因此 `format()` 在未超限时与旧口径逐字符一致，只有超限部分不同（旧实现无上限）。
// 省略标记文案由调用方注入（lib 不持有词典，用户可见文案统一走词典）。

/** 显示文本的总字符上限（不含行间换行符；超限即从最前丢行）。 */
export const MAX_SERVICE_DEBUG_CHARS = 200_000

/** 逻辑行数上限（与字符上限共同兜底；先触发者生效）。 */
export const MAX_SERVICE_DEBUG_LINES = 5_000

/** 单行字符上限（防御：一行被无限追加时也要有界；超出即折行，不丢字符）。 */
export const MAX_SERVICE_DEBUG_LINE_CHARS = 20_000

/** 服务调试输出累积器（纯状态机：不读时钟/随机源/DOM）。 */
export class ServiceDebugOutput {
  /** 逻辑行；末尾元素始终是「正在追加的行」。 */
  private lines: string[] = ['']
  /** 各行长度之和（截断判定用；不含行间换行符）。 */
  private chars = 0
  /** 是否发生过截断（置位后持续到 reset）。 */
  private truncated = false
  /** 已丢弃的字符数（省略提示里的数字）。 */
  private droppedChars = 0

  /** 重新开始一轮流（清空文本与截断标记）。 */
  reset(): void {
    this.lines = ['']
    this.chars = 0
    this.truncated = false
    this.droppedChars = 0
  }

  /** 追加正文增量：文本自带的换行符按逻辑行拆分，不插入额外分隔符。 */
  appendContent(text: string): void {
    if (!text) return
    const segments = text.split('\n')
    this.appendToCurrentLine(segments[0] ?? '')
    for (let index = 1; index < segments.length; index += 1) {
      this.lines.push('')
      this.appendToCurrentLine(segments[index] ?? '')
    }
    this.trim()
  }

  /** 追加错误行（自成一行；已有内容时其前留一空行，与旧的整串累加口径一致）。 */
  appendError(prefixedError: string): void {
    if (!prefixedError) return
    if (this.hasContent()) {
      this.lines.push('')
      this.lines.push('')
    }
    this.appendToCurrentLine(prefixedError)
    this.trim()
  }

  /** 显示文本；发生过截断时把省略提示放在最前（用户知道早期输出已丢弃）。 */
  format(omittedLabel = ''): string {
    const body = this.lines.join('\n')
    if (!this.truncated || omittedLabel === '') return body
    return `${omittedLabel}${this.droppedChars}\n${body}`
  }

  /** 有内容即视为「已开始输出」（空串追加不改变该判定）。 */
  private hasContent(): boolean {
    return this.lines.length > 1 || this.lines[0] !== ''
  }

  /** 把一段无换行文本追加到当前行；当前行满则折行继续（不丢字符）。 */
  private appendToCurrentLine(segment: string): void {
    let rest = segment
    while (rest.length > 0) {
      const last = this.lines.length - 1
      const room = MAX_SERVICE_DEBUG_LINE_CHARS - this.lines[last].length
      if (room <= 0) {
        this.lines.push('')
        continue
      }
      const head = rest.slice(0, room)
      this.lines[last] += head
      this.chars += head.length
      rest = rest.slice(head.length)
    }
  }

  /** 丢弃最旧行直到回到上限内（至少保留一行，保证「正在追加的行」始终存在）。 */
  private trim(): void {
    while (this.lines.length > MAX_SERVICE_DEBUG_LINES || (this.chars > MAX_SERVICE_DEBUG_CHARS && this.lines.length > 1)) {
      const removed = this.lines.shift()
      if (removed === undefined) return
      // 行数上限触发时被丢的可能是空行：截断标记不能只看字符数差值
      this.truncated = true
      this.droppedChars += removed.length
      this.chars -= removed.length
    }
  }
}

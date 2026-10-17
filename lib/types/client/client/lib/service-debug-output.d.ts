/** 显示文本的总字符上限（不含行间换行符；超限即从最前丢行）。 */
export declare const MAX_SERVICE_DEBUG_CHARS = 200000;
/** 逻辑行数上限（与字符上限共同兜底；先触发者生效）。 */
export declare const MAX_SERVICE_DEBUG_LINES = 5000;
/** 单行字符上限（防御：一行被无限追加时也要有界；超出即折行，不丢字符）。 */
export declare const MAX_SERVICE_DEBUG_LINE_CHARS = 20000;
/** 服务调试输出累积器（纯状态机：不读时钟/随机源/DOM）。 */
export declare class ServiceDebugOutput {
    /** 逻辑行；末尾元素始终是「正在追加的行」。 */
    private lines;
    /** 各行长度之和（截断判定用；不含行间换行符）。 */
    private chars;
    /** 是否发生过截断（置位后持续到 reset）。 */
    private truncated;
    /** 已丢弃的字符数（省略提示里的数字）。 */
    private droppedChars;
    /** 重新开始一轮流（清空文本与截断标记）。 */
    reset(): void;
    /** 追加正文增量：文本自带的换行符按逻辑行拆分，不插入额外分隔符。 */
    appendContent(text: string): void;
    /** 追加错误行（自成一行；已有内容时其前留一空行，与旧的整串累加口径一致）。 */
    appendError(prefixedError: string): void;
    /** 显示文本；发生过截断时把省略提示放在最前（用户知道早期输出已丢弃）。 */
    format(omittedLabel?: string): string;
    /** 有内容即视为「已开始输出」（空串追加不改变该判定）。 */
    private hasContent;
    /** 把一段无换行文本追加到当前行；当前行满则折行继续（不丢字符）。 */
    private appendToCurrentLine;
    /** 丢弃最旧行直到回到上限内（至少保留一行，保证「正在追加的行」始终存在）。 */
    private trim;
}

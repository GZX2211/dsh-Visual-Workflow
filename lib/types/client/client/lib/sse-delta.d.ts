/**
 * 解析后端 SSE data 行的内容增量（Bug 3）。
 * @returns { content?, error? } 增量文本或错误消息（无匹配返回空对象）。
 */
export declare function parseSseDelta(data: string): {
    content?: string;
    error?: string;
};

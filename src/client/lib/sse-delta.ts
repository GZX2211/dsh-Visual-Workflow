// src/client/lib/sse-delta.ts
//
// 服务调试 SSE 增量解析（纯函数，网络边界解析归 lib）：
// 后端 openai-api 的 sseChunk 把正文放在 choices[0].delta.content；
// 为兼容旧增量格式（delta.content）做回退取值。

/**
 * 解析后端 SSE data 行的内容增量（Bug 3）。
 * @returns { content?, error? } 增量文本或错误消息（无匹配返回空对象）。
 */
export function parseSseDelta(data: string): { content?: string; error?: string } {
  let parsed: {
    choices?: Array<{ delta?: { content?: unknown } }>
    delta?: { content?: unknown }
    error?: { message?: unknown }
  }
  try {
    parsed = JSON.parse(data)
  } catch {
    return {}
  }
  if (parsed.error?.message) return { error: String(parsed.error.message) }
  const content = parsed.choices?.[0]?.delta?.content ?? parsed.delta?.content
  return typeof content === 'string' && content ? { content } : {}
}

// tests/host/experience/fixtures/assertions.ts
//
// Experience 域单测的错误断言辅助。
//
// 为什么单独收口：域层所有可行动错误都以 WfError + 稳定 code 契约对外，用例既要断言 code，
// 也要断言「消息是否符合模型可见面规范」；把「取错误 + 校验契约」收成一个函数，避免每个用例
// 重复 try/catch 样板，也避免用例误把「抛了任意异常」当成契约满足。
//
// 为什么把模型可见面规范直接放进 errorOf：该规范对**每一条**域层错误都成立
// （docs/model-facing-surface-rules §3：`{CODE}: english message`，稳定码必须写进 message
// 文本，error.code 模型看不到）。逐个用例手写这条断言既冗长又必然漏项——上一轮
// 「只扫字面量得出已全英文」的错误结论就是这么来的；绑在唯一出口上，任何新增或改写的错误
// 只要经过 errorOf 就自动被这条契约检查。

import { WfError } from "../../../../src/host/orchestrator/errors.js"

/** CJK 统一表意文字（判定模型可见文本是否含中文的唯一判据）。 */
const CJK_PATTERN = /[\u4e00-\u9fff]/u

/**
 * 引号内的回显片段（`received "…"` 这类）。
 *
 * 为什么判定前要剥掉：错误消息会把**模型自己传入的值**原样回显（字段值、字段名、下标值），
 * 那是数据不是本域文案——数据用什么语言由调用方决定，中文输入被回显不构成文案违规。
 * 该规范约束的是本域撰写的说明文字，因此只对引号之外的散文判定。
 */
const QUOTED_ECHO_PATTERN = /"[^"]*"/gu

/**
 * 模型可见错误的规范偏差（无偏差返回 null）。
 *
 * 只校验**本域自己撰写**的文本：`{CODE}: ` 前缀，以及引号之外的散文不含中文。
 * 被插值进来的底层 cause（如存储层错误）不属于本域文本，其语言由所属模块决定；
 * 因此测试注入的 cause 也必须是英文，否则这条门禁会把他人的文本误判成本域偏差。
 */
export function modelFacingProblemOf(error: WfError): string | null {
  if (!error.message.startsWith(`${error.code}: `)) {
    return `message must start with "${error.code}: " so the model can read the stable code (got: ${error.message})`
  }
  const prose = error.message.replace(QUOTED_ECHO_PATTERN, '""')
  if (CJK_PATTERN.test(prose)) {
    return `model-facing message must be English but its prose contains CJK characters: ${error.message}`
  }
  return null
}

/**
 * 执行动作并返回其抛出的 WfError；未抛错、抛出的不是 WfError、或消息不符合模型可见面规范都失败。
 */
export async function errorOf(action: () => Promise<unknown> | unknown): Promise<WfError> {
  try {
    await action()
  } catch (error) {
    if (!(error instanceof WfError)) throw error
    const problem = modelFacingProblemOf(error)
    if (problem !== null) throw new Error(problem)
    return error
  }
  throw new Error("期望抛出 WfError，但动作成功返回")
}

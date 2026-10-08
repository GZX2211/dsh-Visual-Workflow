// tests/host/experience/fixtures/assertions.ts
//
// Experience 域单测的错误断言辅助。
//
// 为什么单独收口：域层所有可行动错误都以 WfError + 稳定 code 契约对外，用例既要断言 code，
// 也要断言「消息是否直接告诉模型下一步动作」；把「取错误」收成一个函数，避免每个用例重复
// try/catch 样板，也避免用例误把「抛了任意异常」当成契约满足。

import { WfError } from "../../../../src/host/orchestrator/errors.js"

/** 执行动作并返回其抛出的 WfError；未抛错或抛出的不是 WfError 即测试失败。 */
export async function errorOf(action: () => Promise<unknown> | unknown): Promise<WfError> {
  try {
    await action()
  } catch (error) {
    if (error instanceof WfError) return error
    throw error
  }
  throw new Error("期望抛出 WfError，但动作成功返回")
}

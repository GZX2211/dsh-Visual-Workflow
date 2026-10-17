// src/host/prompts/defaults.ts
//
// 语言相关的默认文本投影：存储保持中文规范值，注入/展示时按本次运行语言本地化。
// 只处理「与规范默认值逐字相等」的内容；用户自定义契约原样透传。

import { isEnglishSystemLanguage } from '../system-language.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../shared/protocol.js'
import { DEFAULT_OUTPUT_CONTRACT_EN } from './texts/en/default-output-contract.js'

/** 默认输出契约：中文规范值 / 英文展示值。 */
export function defaultOutputContractOf(systemLanguage: string | undefined): string {
  return isEnglishSystemLanguage(systemLanguage) ? DEFAULT_OUTPUT_CONTRACT_EN : DEFAULT_OUTPUT_CONTRACT_TEXT
}

/**
 * 本地化输出契约文本：与中文规范默认值逐字相等时替换为对应语言默认值；
 * 自定义契约（含用户手写的中文）原样返回。
 */
export function localizeOutputContract(text: string, systemLanguage: string | undefined): string {
  const value = String(text ?? '').trim()
  return value === DEFAULT_OUTPUT_CONTRACT_TEXT ? defaultOutputContractOf(systemLanguage) : value
}

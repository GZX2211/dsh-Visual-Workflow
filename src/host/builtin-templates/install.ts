// src/host/builtin-templates/install.ts
//
// 内置工作流模板的随包种子与一次性播种。
//
// 为什么要由 Host 播种而不是客户端读取包内文件展示：模板是持久化事实，播种后就是一份
// 普通模板（可编辑、可删除、可参与创建实例），与用户自建模板同权；客户端不持有第二份
// 事实源，也不需要在每次打开界面时判断「内置还是用户模板」。
//
// 为什么用「已播种标记」而不是「缺失就补回」：缺一补一会在用户删除预设模板后、下次
// 启动时把它复活，删除动作等于无效；标记文件（builtin-seeds.json，由 storage 持有）
// 记录已经播种过的模板 id，删除后不再写回。同时标记只在首次播种时写入，因此已有数据
// 目录的老用户升级后也能获得一次，之后同样尊重删除与修改。
//
// 为什么失败只由宿主告警：播种是启动辅助动作，失败（磁盘只读、标记损坏等）不应拖垮
// 整个插件；但错误必须可诊断，由宿主日志显式记录，不静默降级。
//
// 中英双语：同一固定 id 提供中英两份种子，首次播种时按界面语言二选一（英文界面注入
// 英文版，其余回退中文）。播种后就是普通模板，之后切换界面语言不会替换已播种内容——
// 那会覆盖用户修改，也与「删除后不复活」的语义冲突。

import type { WorkflowTemplate } from '../shared/graph-model.js'
import { DEFAULT_SYSTEM_LANGUAGE, isEnglishSystemLanguage } from '../system-language.js'
import flowDesignGuideEn from './flow-design-guide.en.json' with { type: 'json' }
import flowDesignGuideZh from './flow-design-guide.zh.json' with { type: 'json' }

/** 预设「流程设计指南」模板 id（固定；中英种子共用，播种标记与「已存在」判定都依赖它稳定）。 */
export const BUILTIN_FLOW_DESIGN_GUIDE_ID = 'tpl-mvciz28k-jvzw9u'

/**
 * 随包内置模板种子（只读）：中文版（默认）与英文版。
 * 写入存储前必须深拷贝：存储层会添加 revision/时间戳，不能让共享种子对象被改写。
 */
export const BUILTIN_FLOW_TEMPLATES_ZH: readonly WorkflowTemplate[] = [
  flowDesignGuideZh as unknown as WorkflowTemplate,
]
export const BUILTIN_FLOW_TEMPLATES_EN: readonly WorkflowTemplate[] = [
  flowDesignGuideEn as unknown as WorkflowTemplate,
]

/**
 * 按界面语言选择种子：只有英文界面注入英文版，其余（未知/缺失）回退中文。
 * 与 DEFAULT_SYSTEM_LANGUAGE 同口径；语言只在首次播种时消费一次。
 */
export function builtinFlowTemplatesFor(systemLanguage: string): readonly WorkflowTemplate[] {
  return isEnglishSystemLanguage(systemLanguage) ? BUILTIN_FLOW_TEMPLATES_EN : BUILTIN_FLOW_TEMPLATES_ZH
}

/**
 * 播种所需的最小存储能力：只取四个方法，既避免安装器依赖 FlowStore 的其余面，
 * 也让测试可以注入替身验证失败路径。
 */
export interface BuiltinFlowTemplateStore {
  getFlowTemplate(templateId: string): Promise<WorkflowTemplate | null>
  saveFlowTemplate(template: WorkflowTemplate): Promise<WorkflowTemplate>
  listAppliedBuiltinSeeds(): Promise<string[]>
  addAppliedBuiltinSeeds(ids: readonly string[]): Promise<void>
}

/**
 * 校验种子最小形状：坏种子必须显式失败，不能把半成品模板写进用户数据目录。
 * 只校验播种必需的身份与图容器字段；更细的图合法性属于验收测试（validateFlow）。
 */
function assertTemplateSeed(template: WorkflowTemplate): void {
  if (typeof template?.id !== 'string' || template.id.trim() === '') {
    throw new Error('内置模板种子缺少 id')
  }
  if (template.mode !== 'mode1' && template.mode !== 'mode2') {
    throw new Error(`内置模板种子 mode 非法：${String((template as { mode?: unknown }).mode)}`)
  }
  if (!Array.isArray(template.nodes) || !Array.isArray(template.lines)) {
    throw new Error(`内置模板种子 ${template.id} 缺少 nodes/lines 数组`)
  }
}

/** 种子深拷贝（JSON 形状，无函数/符号字段）。 */
function cloneTemplate(template: WorkflowTemplate): WorkflowTemplate {
  return JSON.parse(JSON.stringify(template)) as WorkflowTemplate
}

/**
 * 播种内置工作流模板（幂等），返回本次新登记的种子 id。
 *
 * 判定顺序：
 *   1. 标记已含该 id → 跳过（用户此后删除/修改都不会被撤销）；
 *   2. 存储中已有同 id 模板（用户自建、手动导入或历史版本）→ 不覆盖，只补记标记；
 *   3. 都没有 → 按界面语言写入一份对应语言的种子深拷贝。
 *
 * 读取标记失败（损坏/权限）时直接上浮：把「读不到」当成「从未播种」会让已删除的
 * 预设模板复活。调用方（宿主）负责告警并跳过本次播种。
 *
 * @param systemLanguage 界面语言名（如 '中文' / 'English'）；缺省与未知值回退中文。
 */
export async function installBuiltinFlowTemplates(
  store: BuiltinFlowTemplateStore,
  systemLanguage: string = DEFAULT_SYSTEM_LANGUAGE,
): Promise<string[]> {
  const applied = new Set(await store.listAppliedBuiltinSeeds())
  const seeds = builtinFlowTemplatesFor(systemLanguage)
  const newlyApplied: string[] = []
  for (const seed of seeds) {
    assertTemplateSeed(seed)
    if (applied.has(seed.id)) continue
    const existing = await store.getFlowTemplate(seed.id)
    // 已存在即视为用户的内容：内置模板与用户模板同权，首次播种只负责「从未存在过」。
    if (existing === null) await store.saveFlowTemplate(cloneTemplate(seed))
    newlyApplied.push(seed.id)
  }
  // 一次性合并写标记：任一模板保存失败都会抛出，此时不登记标记，下次启动重试且仍不覆盖。
  if (newlyApplied.length > 0) await store.addAppliedBuiltinSeeds(newlyApplied)
  return newlyApplied
}

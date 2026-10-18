// src/client/hooks/useTemplates.ts
//
// 模板列表：四类（role/task/database/group）并行加载 / 本地草稿新建 / 保存 / 删除。
// 数据模型对齐后端（RoleTemplate/TaskTemplate/DatabaseTemplate/GroupTemplate）。

import { useCallback, useMemo } from 'react'
import type { Dispatch } from 'react'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../host/shared/protocol.js'
import type { RoleTemplate, TaskTemplate, DatabaseTemplate, GroupTemplate } from '../../host/shared/types.js'
import type { Drafted, StudioAction, TemplateKind } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export type AnyTemplate = RoleTemplate | TaskTemplate | DatabaseTemplate | GroupTemplate

export interface TemplatesFace {
  /** 全部模板分类并行加载；返回按 kind 聚合的结果（某类失败不影响其他类）。 */
  loadTemplates(): Promise<{ role: AnyTemplate[]; task: AnyTemplate[]; database: AnyTemplate[]; group: AnyTemplate[] }>
  /** 新建本地草稿（id 正式格式；保存落库后 id 不变，画布引用不失效）。name 由调用方从词典注入。 */
  createTemplateDraft(kind: TemplateKind, name: string): AnyTemplate
  saveTemplate(kind: TemplateKind, template: AnyTemplate): Promise<void>
  deleteTemplate(kind: TemplateKind, id: string): Promise<void>
}

function draftOf(kind: TemplateKind, name: string): AnyTemplate {
  const now = new Date().toISOString()
  const id = `${kind === 'role' ? 'role' : kind === 'task' ? 'task' : kind === 'group' ? 'group' : 'db'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  if (kind === 'role') {
    return {
      id, kind: 'agent', name, systemPrompt: '', provider: '', model: '',
      // 输出契约默认文本随新建落盘：界面显示、运行期注入与磁盘同值（清空即无契约）
      presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: DEFAULT_OUTPUT_CONTRACT_TEXT,
      injectSystemPrompt: true, injectToolSections: true, promptFilePath: undefined, createdAt: now, updatedAt: now,
      // 草稿标记：前端 UI 状态，后端 putTemplate 经 stripClientMeta 剥除、绝不落盘
      _draft: true,
    } as Drafted<RoleTemplate>
  }
  if (kind === 'task') {
    return { id, name, content: '', createdAt: now, updatedAt: now, _draft: true } as Drafted<TaskTemplate>
  }
  if (kind === 'group') {
    return { id, name, collabPrompt: '', createdAt: now, updatedAt: now, _draft: true } as Drafted<GroupTemplate>
  }
  return {
    id, kind: 'database', name, description: '', dbType: 'local', dbKind: 'sqlite',
    vectorSource: 'embedding', createdAt: now, updatedAt: now, _draft: true,
  } as Drafted<DatabaseTemplate>
}

/** 模板列表面（远端失败抛错，由调用方 toast）。 */
export function useTemplates(dispatch: Dispatch<StudioAction>, remote: RemoteFace): TemplatesFace {
  const loadTemplates = useCallback(async () => {
    const kinds: TemplateKind[] = ['role', 'task', 'database', 'group']
    // 并行加载必须用 allSettled：某类模板端点失败时其余类型仍正常加载（不得一损俱损）
    const results = await Promise.allSettled(
      kinds.map(async (kind) => {
        const items = await remote.call(EP.EP_LIST_TEMPLATES, { kind })
        return { kind, items: Array.isArray(items) ? (items as AnyTemplate[]) : [] }
      }),
    )
    const aggregated: { role: AnyTemplate[]; task: AnyTemplate[]; database: AnyTemplate[]; group: AnyTemplate[] } = { role: [], task: [], database: [], group: [] }
    for (const result of results) {
      if (result.status !== 'fulfilled') continue // 失败类跳过（下轮加载重试），不影响其他类
      const { kind, items } = result.value
      aggregated[kind] = items
      dispatch({ type: 'TEMPLATES_LOADED', kind, items })
    }
    return aggregated
  }, [dispatch, remote])

  const createTemplateDraft = useCallback((kind: TemplateKind, name: string): AnyTemplate => {
    const template = draftOf(kind, name)
    dispatch({ type: 'TEMPLATE_ADDED', kind, template })
    return template
  }, [dispatch])

  const saveTemplate = useCallback(async (kind: TemplateKind, template: AnyTemplate) => {
    const saved = await remote.call(EP.EP_PUT_TEMPLATE, { kind, template }) as AnyTemplate
    dispatch({ type: 'TEMPLATE_UPDATED', kind, template: saved })
  }, [dispatch, remote])

  const deleteTemplate = useCallback(async (kind: TemplateKind, id: string) => {
    await remote.call(EP.EP_DELETE_TEMPLATE, { kind, id })
    dispatch({ type: 'TEMPLATE_REMOVED', kind, id })
  }, [dispatch, remote])

  // face 引用跨「同一 state 的重渲染」保持恒等（D06-08：装配层据此记忆化派生 props）
  return useMemo(
    () => ({ loadTemplates, createTemplateDraft, saveTemplate, deleteTemplate }),
    [loadTemplates, createTemplateDraft, saveTemplate, deleteTemplate],
  )
}

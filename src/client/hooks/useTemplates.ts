// src/client/hooks/useTemplates.ts
//
// 模板列表：三类（role/file/database）并行加载 / 本地草稿新建 / 保存 / 删除。
// 数据模型对齐后端（RoleTemplate/FileTemplate/DatabaseTemplate）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { RoleTemplate, FileTemplate, DatabaseTemplate } from '../../host/shared/types.js'
import type { Drafted, StudioAction, TemplateKind } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export type AnyTemplate = RoleTemplate | FileTemplate | DatabaseTemplate

export interface TemplatesFace {
  loadTemplates(): Promise<void>
  /** 新建本地草稿（id 正式格式；保存落库后 id 不变，画布引用不失效）。 */
  createTemplateDraft(kind: TemplateKind): AnyTemplate
  saveTemplate(kind: TemplateKind, template: AnyTemplate): Promise<void>
  deleteTemplate(kind: TemplateKind, id: string): Promise<void>
}

function draftOf(kind: TemplateKind): AnyTemplate {
  const now = new Date().toISOString()
  const id = `${kind === 'role' ? 'role' : kind === 'file' ? 'file' : 'db'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  if (kind === 'role') {
    return {
      id, kind: 'agent', name: '新角色模板', systemPrompt: '', provider: '', model: '',
      presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '',
      injectSystemPrompt: true, promptFilePath: undefined, createdAt: now, updatedAt: now,
      // 草稿标记：前端 UI 状态，后端 putTemplate 经 stripClientMeta 剥除、绝不落盘
      _draft: true,
    } as Drafted<RoleTemplate>
  }
  if (kind === 'file') {
    return { id, kind: 'file', name: '新文件模板', fileKind: 'text', content: '', createdAt: now, updatedAt: now, _draft: true } as Drafted<FileTemplate>
  }
  return {
    id, kind: 'database', name: '新数据库模板', description: '', dbType: 'local', dbKind: 'sqlite',
    vectorSource: 'embedding', createdAt: now, updatedAt: now, _draft: true,
  } as Drafted<DatabaseTemplate>
}

/** 模板列表面（远端失败抛错，由调用方 toast）。 */
export function useTemplates(dispatch: Dispatch<StudioAction>, remote: RemoteFace): TemplatesFace {
  const loadTemplates = useCallback(async () => {
    const kinds: TemplateKind[] = ['role', 'file', 'database']
    const results = await Promise.all(
      kinds.map(async (kind) => {
        const items = await remote.call(EP.EP_LIST_TEMPLATES, { kind })
        return { kind, items: Array.isArray(items) ? (items as AnyTemplate[]) : [] }
      }),
    )
    for (const { kind, items } of results) {
      dispatch({ type: 'TEMPLATES_LOADED', kind, items })
    }
  }, [dispatch, remote])

  const createTemplateDraft = useCallback((kind: TemplateKind): AnyTemplate => {
    const template = draftOf(kind)
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

  return { loadTemplates, createTemplateDraft, saveTemplate, deleteTemplate }
}

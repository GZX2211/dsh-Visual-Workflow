// tests/client/components/sidebar/library-model.test.ts
//
// buildLibraryModel 单测（P4 体验与沉淀）：父代理模板卡 pinned=false，
// 不再常驻 is-pinned 高亮。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——library-model 用例归入本文件。

import { describe, expect, it } from 'vitest'
import { buildLibraryModel } from '../../../../src/client/components/sidebar/library-model.js'
import { zh } from '../../../../src/client/i18n.js'

describe('P4 父模板卡高亮修复（buildLibraryModel）', () => {
  it('父代理模板卡 pinned=false（不再常驻 is-pinned 高亮）', () => {
    const model = buildLibraryModel({
      copy: zh,
      libTab: 'role',
      mode: 'mode1',
      workflows: [],
      currentSessionId: 's-1',
      flowTemplates: [],
      parentTemplate: { id: 'tpl-parent', name: 'CEO' } as never,
      roleTemplates: [],
      fileTemplates: [],
      databaseTemplates: [],
      groupTemplates: [],
      stageKinds: [],
      libSelection: null,
      modeName: () => '标准',
      onSelectWorkflow: () => {},
      onSelectFlowTemplate: () => {},
      onSelectLib: () => {},
      onPlaceTemplate: () => {},
      onPlaceTemplateIntoGroup: () => {},
      onPlaceStage: () => {},
      onPlaceGroup: () => {},
      onPlaceGroupFromTemplate: () => {},
      onPlaceParent: () => {},
      onCreateNew: () => {},
    })
    const parent = model.sections.find((section) => section.key === 'parent')
    expect(parent?.cards[0].pinned).toBe(false)
  })
})

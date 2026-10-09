// tests/host/tools/wf-org-catalog/build.test.ts
//
// 索引 / 详情装配纯函数单测：
//   - 索引：组合携带完整工具清单、模型携带思考强度档位、资产条目只给「够不够参考」的判据、
//     规则与 ID 约定同源、三段 ID 约定齐全且不含模版措辞；
//   - 骨架：阶段节点 / 角色 / 协作组 / 虚拟节点 / 数据节点正文 / 连接信息脱敏 / 连线 /
//     可召回内联角色清单 / 角色节点的固定引用版本（roleAssetId + roleVersionId）；
//   - 骨架的字段取舍：角色 systemPrompt 必须缺席（走按需召回），其余不可召回内容必须给全；
//   - 角色 / 内联角色详情：最长字段完整不截断，可选字段缺省时省略。

import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  buildInlineRoleDetail,
  buildRoleDetail,
  buildWorkflowDetail,
  clip,
  DETAIL_HINT,
  maskConnection,
} from '../../../../src/host/tools/wf-org-catalog/build.js'
import { CATALOG_LIMITS, ID_CONVENTION } from '../../../../src/host/tools/wf-org-catalog/types.js'
import { GATE_MARKING_SEMANTICS, PATCH_CONTRACT_TEXT } from '../../../../src/host/tools/infrastructure/graph-op-contract.js'
import { ORG_SOP_DESIGN_METHOD, ORG_SOP_L1_GRAPH_SEMANTICS } from '../../../../src/host/prompts/index.js'
import {
  makeCatalogHost,
  inlineRoleNodeFixture,
  roleAssetDetailFixture,
  roleAssetSummaryFixture,
  workflowAssetDetailFixture,
  workflowAssetSummaryFixture,
} from './fixtures.js'
import type { CatalogIndex, CatalogRoleNodeEntry, CatalogWorkflowDetail } from '../../../../src/host/tools/wf-org-catalog/types.js'
import type { WorkflowAssetSummary } from '../../../../src/host/shared/asset-types.js'

/** 取骨架里的角色节点条目（测试专用窄化）。 */
function roleNodeOf(detail: CatalogWorkflowDetail, id: string): CatalogRoleNodeEntry {
  return detail.nodes.find((node) => node.id === id && (node.kind === 'agent' || node.kind === 'parent')) as CatalogRoleNodeEntry
}

/** 空索引入参（各用例只覆盖自己关心的那一段）。 */
const emptyIndexInput = {
  workflows: [] as WorkflowAssetSummary[],
  roles: [],
  combos: [],
  presets: [],
  models: [],
}

describe('buildIndex（资产索引装配）', () => {
  const hostFixture = makeCatalogHost()

  it('索引只含约定字段（资产分段，不混入经验与其它运行态字段）', () => {
    const index = buildIndex({ ...emptyIndexInput, workflows: [workflowAssetSummaryFixture()] })
    expect(Object.keys(index).sort()).toEqual(
      ['assets', 'combos', 'detailHint', 'idConvention', 'kind', 'models', 'presets', 'rules', 'truncated'].sort(),
    )
    expect(index.kind).toBe('index')
    expect(Object.keys(index.assets).sort()).toEqual(['roles', 'workflows'])
  })

  it('三段 ID 约定齐全：工作流 / 角色 / 内联角色，且不再出现模版与经验措辞', () => {
    const index = buildIndex(emptyIndexInput)
    expect(Object.keys(index.idConvention).sort()).toEqual(['inlineRole', 'role', 'workflow'])
    expect(index.idConvention.workflow).toContain('flow-')
    expect(index.idConvention.role).toContain('role-')
    expect(index.idConvention.inlineRole).toContain('#')
    expect(index.idConvention.inlineRole).toContain('固定引用版本')
    for (const text of Object.values(index.idConvention)) {
      expect(text).not.toContain('tpl-')
      expect(text).not.toContain('模板')
      expect(text).not.toContain('模版')
      expect(text).not.toContain('经验')
    }
  })

  it('召回指引说明「索引只是候选」，并逐条给出三种 id 的取数语义', () => {
    const index = buildIndex(emptyIndexInput)
    expect(index.detailHint).toContain('候选')
    for (const expected of ['flow-xxx', 'role-xxx', 'flow-xxx#node-yyy']) {
      expect(index.detailHint).toContain(expected)
    }
    expect(index.detailHint).not.toContain('ex-')
    expect(index.detailHint).not.toContain('经验')
  })

  it('规则段与提示词基线 / 写图契约的常量同源（不在工具层复制文本）', () => {
    const index = buildIndex(emptyIndexInput)
    expect(index.rules.graphSemantics).toBe(ORG_SOP_L1_GRAPH_SEMANTICS)
    expect(index.rules.designMethod).toBe(ORG_SOP_DESIGN_METHOD)
    expect(index.rules.patchContract).toBe(PATCH_CONTRACT_TEXT)
    expect(index.rules.gateMarking).toBe(GATE_MARKING_SEMANTICS)
    expect(index.idConvention).toEqual(ID_CONVENTION)
    expect(DETAIL_HINT).toBe(index.detailHint)
  })

  it('组合条目携带完整工具清单（不截断：它是节点 presetId 的取值依据）', () => {
    const tools = Array.from({ length: 60 }, (_item, i) => `tool-${i}`)
    const index = buildIndex({
      ...emptyIndexInput,
      combos: [{ id: 'combo-x', name: '大组合', tools, mcpServers: ['srv'] }],
    })
    expect(index.combos[0].tools).toHaveLength(60)
    expect(index.combos[0].mcpServers).toEqual(['srv'])
  })

  it('模型条目携带 provider/model 与思考强度档位；无档位时省略该字段', () => {
    const index = buildIndex({
      ...emptyIndexInput,
      models: [
        { provider: 'deepseek', model: 'chat', efforts: [{ id: 'high', name: '高' }] },
        { provider: 'deepseek', model: 'flash' },
      ],
    })
    expect(index.models[0]).toEqual({ provider: 'deepseek', model: 'chat', efforts: [{ id: 'high', name: '高' }] })
    expect('efforts' in index.models[1]).toBe(false)
  })

  it('工作流资产条目只给 id/name/描述/版本（没有 sourceTemplateId 等模版血缘字段）', () => {
    const index = buildIndex({
      ...emptyIndexInput,
      workflows: [workflowAssetSummaryFixture({ sourceTemplateId: 'tpl-old', sourceFingerprint: 'fp' })],
    })
    expect(Object.keys(index.assets.workflows[0]).sort()).toEqual(['description', 'id', 'name', 'versionId'])
  })

  it('角色资产条目给版本与资产类型，以及资产库产出的摘要（摘要只够判断职责，不带配置字段）', () => {
    const index = buildIndex({
      ...emptyIndexInput,
      roles: [roleAssetSummaryFixture({ roleAssetType: 'shared', summary: '你是分析员，负责拆解问题' })],
    })
    const role = index.assets.roles[0]
    expect(Object.keys(role).sort()).toEqual(['id', 'kind', 'name', 'roleAssetType', 'summary', 'versionId'])
    expect(role).toMatchObject({ id: 'role-1', name: '分析员', kind: 'agent', versionId: 3, roleAssetType: 'shared' })
    expect(role.summary).toBe('你是分析员，负责拆解问题')
  })

  it('角色摘要由资产库截断后原样透传（目录侧不二次截断，避免截断标记叠加）', () => {
    const summary = `${'长'.repeat(CATALOG_LIMITS.roleSummary)}…（已截断）`
    const index = buildIndex({
      ...emptyIndexInput,
      roles: [roleAssetSummaryFixture({ summary })],
    })
    expect(index.assets.roles[0].summary).toBe(summary)
  })

  it('角色资产缺摘要时为空串（不编造职责，完整提示词仍可按 id 召回）', () => {
    const index = buildIndex({ ...emptyIndexInput, roles: [roleAssetSummaryFixture()] })
    expect(index.assets.roles[0].summary).toBe('')
  })

  it('未知的角色资产类型按 standalone 收窄（与资产模块的枚举降级方向一致）', () => {
    const index = buildIndex({
      ...emptyIndexInput,
      roles: [
        roleAssetSummaryFixture({ roleAssetType: 'unknown' as never }),
        roleAssetSummaryFixture({ assetId: 'role-2', roleAssetType: 'inline' }),
      ],
    })
    expect(index.assets.roles[0].roleAssetType).toBe('standalone')
    expect(index.assets.roles[1].roleAssetType).toBe('inline')
  })

  it('缺失名称 / 版本号的资产条目按 id 与 0 兜底（不让空名字进模型上下文）', () => {
    const index = buildIndex({
      ...emptyIndexInput,
      workflows: [workflowAssetSummaryFixture({ name: '', versionId: undefined as never })],
      roles: [roleAssetSummaryFixture({ name: '   ' })],
    })
    expect(index.assets.workflows[0]).toMatchObject({ id: 'flow-1', name: 'flow-1', versionId: 0 })
    expect(index.assets.roles[0].name).toBe('role-1')
  })

  it('资产条目缺 id 被丢弃（无法召回的条目不进索引）', () => {
    const index = buildIndex({
      ...emptyIndexInput,
      workflows: [workflowAssetSummaryFixture({ assetId: '' }), workflowAssetSummaryFixture({ assetId: 'flow-2' })],
    })
    expect(index.assets.workflows.map((entry) => entry.id)).toEqual(['flow-2'])
  })

  it('preset 条目带描述（能看出它能给什么）', () => {
    const index = buildIndex({ ...emptyIndexInput, presets: [{ id: 'standard', name: '标准', description: '官方标准模式' }] })
    expect(index.presets[0]).toEqual({ id: 'standard', name: '标准', description: '官方标准模式' })
  })

  it('资产条目超量：按各自上限截断并置 truncated（不静默丢弃）', () => {
    const workflows = Array.from({ length: CATALOG_LIMITS.workflowAssets + 5 }, (_item, i) =>
      workflowAssetSummaryFixture({ assetId: `flow-${i}` }))
    const roles = Array.from({ length: CATALOG_LIMITS.roleAssets + 5 }, (_item, i) =>
      roleAssetSummaryFixture({ assetId: `role-${i}` }))
    const index = buildIndex({ ...emptyIndexInput, workflows, roles })
    expect(index.assets.workflows).toHaveLength(CATALOG_LIMITS.workflowAssets)
    expect(index.assets.roles).toHaveLength(CATALOG_LIMITS.roleAssets)
    expect(index.truncated).toBe(true)
  })

  it('未超量：truncated=false 且清单原样', () => {
    const index: CatalogIndex = buildIndex({ ...emptyIndexInput, roles: [roleAssetSummaryFixture()] })
    expect(index.truncated).toBe(false)
    expect(index.assets.roles).toHaveLength(1)
  })

  it('宿主 fake 的 preset/模型目录可被工具层取到（装配契约不回归）', async () => {
    const presets = await hostFixture.host.listPresets?.()
    const models = await hostFixture.host.listModels?.()
    expect(presets?.[0].id).toBe('standard')
    expect(models?.[0].efforts?.[0].id).toBe('high')
  })
})

describe('buildWorkflowDetail（骨架自足性）', () => {
  const roleRefOf = (rowId: string): { assetId: string | null; versionId: number } | null =>
    rowId === 'rar-1' ? { assetId: 'role-1', versionId: 3 } : null
  const detail = buildWorkflowDetail(workflowAssetDetailFixture(), roleRefOf)

  it('返回体只含骨架约定字段，并交代自己的资产 id 与版本（meta 存在时才有 meta）', () => {
    expect(Object.keys(detail).sort()).toEqual(
      ['assetId', 'description', 'id', 'inlineRoles', 'lines', 'meta', 'mode', 'name', 'nodes', 'note', 'type', 'versionId'].sort(),
    )
    expect(detail.assetId).toBe('flow-1')
    expect(detail.id).toBe('flow-1')
    expect(detail.versionId).toBe(2)
    expect(detail.meta).toEqual({ nodeMax: 12 })
    const withoutMeta = buildWorkflowDetail(workflowAssetDetailFixture({ meta: undefined }))
    expect('meta' in withoutMeta).toBe(false)
  })

  it('阶段节点（start/pause/end）都在骨架里', () => {
    const kinds = detail.nodes.filter((node) => node.kind === 'start' || node.kind === 'pause' || node.kind === 'end')
    expect(kinds.map((node) => node.id).sort()).toEqual(['e', 'pz', 's'])
  })

  it('角色节点给全不可召回字段，并标注固定引用的角色资产与版本，但**不含 systemPrompt**', () => {
    const role = roleNodeOf(detail, 'a1')
    expect(Object.keys(role).sort()).toEqual(
      ['groupId', 'id', 'inputSchema', 'kind', 'label', 'model', 'outputSchema', 'presetId', 'provider', 'reasoning', 'roleAssetId', 'roleVersionId', 'systemPromptSource'].sort(),
    )
    expect(role.presetId).toBe('combo-1')
    expect(role.reasoning).toBe('high')
    expect(role.groupId).toBe('g1')
    expect(role.systemPromptSource).toBe('角色说明.md')
    expect(role.roleAssetId).toBe('role-1')
    expect(role.roleVersionId).toBe(3)
    expect('systemPrompt' in role).toBe(false)
  })

  it('未提供角色版本回溯 / 回溯不到：只省略 roleAssetId，仍给出钉住的版本号', () => {
    const noResolver = roleNodeOf(buildWorkflowDetail(workflowAssetDetailFixture()), 'a1')
    expect('roleAssetId' in noResolver).toBe(false)
    expect(noResolver.roleVersionId).toBeUndefined()

    const partial = roleNodeOf(buildWorkflowDetail(workflowAssetDetailFixture(), () => ({ assetId: null, versionId: 7 })), 'a1')
    expect('roleAssetId' in partial).toBe(false)
    expect(partial.roleVersionId).toBe(7)
  })

  it('没有角色版本行映射的角色节点：两个引用字段都省略（不影响其余字段）', () => {
    const role = roleNodeOf(buildWorkflowDetail(workflowAssetDetailFixture({ roleVersionIds: [] })), 'a1')
    expect('roleAssetId' in role).toBe(false)
    expect('roleVersionId' in role).toBe(false)
    expect(role.label).toBe('分析员')
  })

  it('协作组节点给全 collabPrompt 与成员清单', () => {
    const group = detail.nodes.find((node) => node.id === 'g1')
    expect(group).toEqual({ id: 'g1', kind: 'group', label: '评审组', collabPrompt: '组员互相评审', memberIds: ['a1'] })
  })

  it('虚拟节点给出引用主节点与闸门角色', () => {
    const proxy = detail.nodes.find((node) => node.id === 'p1')
    expect(proxy).toEqual({ id: 'p1', kind: 'proxy', label: '里程碑复核', proxySourceId: 'a1', role: 'milestone' })
  })

  it('文件节点正文一次性给全（没有二次召回通道）', () => {
    const file = detail.nodes.find((node) => node.id === 'f1')
    expect(file).toMatchObject({ kind: 'file', label: '基线说明', fileKind: 'text', content: '基线正文' })
  })

  it('数据库节点连接信息给全，但密码脱敏', () => {
    const server = detail.nodes.find((node) => node.id === 'db2')
    expect(server).toMatchObject({ kind: 'database', dbType: 'server', dbKind: 'postgresql' })
    expect((server as { conn: Record<string, unknown> }).conn).toEqual({
      host: 'db.internal',
      port: 5432,
      user: 'reader',
      password: '**',
      db: 'shop',
    })
  })

  it('连线给全（含条件类型）', () => {
    expect(detail.lines).toHaveLength(4)
    expect(detail.lines.find((line) => line.id === 'l3')?.condition).toEqual({ type: 'fail' })
    expect(detail.lines.find((line) => line.id === 'l2')).toMatchObject({ sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
  })

  it('inlineRoles 列出可召回的复合 id（仅角色节点，容器是资产 id）', () => {
    expect(detail.inlineRoles).toEqual(['flow-1#a1'])
    expect(detail.note).toContain('systemPrompt')
    expect(detail.note).toContain('roleVersionId')
  })
})

describe('buildRoleDetail / buildInlineRoleDetail（最长字段完整召回）', () => {
  it('角色资产：systemPrompt 不截断，资产类型与版本随详情给出，缺省字段省略', () => {
    const long = '提'.repeat(5000)
    const detail = buildRoleDetail(roleAssetDetailFixture({ systemPrompt: long }))
    expect(detail.type).toBe('role')
    expect(detail.id).toBe('role-1')
    expect(detail.assetId).toBe('role-1')
    expect(detail.versionId).toBe(3)
    expect(detail.roleAssetType).toBe('standalone')
    expect(detail.systemPrompt).toHaveLength(5000)
    expect(detail.reasoning).toBe('high')
    expect(detail.systemPromptSource).toBe('分析员.md')
    expect(detail.presetId).toBe('combo-1')

    const withoutOptional = buildRoleDetail(roleAssetDetailFixture({
      name: '',
      reasoning: undefined,
      systemPromptSource: undefined,
      presetId: null,
    }))
    expect(withoutOptional.name).toBe('role-1')
    expect('reasoning' in withoutOptional).toBe(false)
    expect('systemPromptSource' in withoutOptional).toBe(false)
    expect(withoutOptional.presetId).toBeNull()
  })

  it('内联角色：标明所属工作流与节点、固定引用的角色资产与版本，systemPrompt 完整', () => {
    const detail = buildInlineRoleDetail({
      containerId: 'flow-1',
      node: inlineRoleNodeFixture(),
      roleAssetId: 'role-1',
      roleVersionId: 3,
    })
    expect(detail.type).toBe('inlineRole')
    expect(detail.id).toBe('flow-1#a1')
    expect(detail.containerId).toBe('flow-1')
    expect(detail.nodeId).toBe('a1')
    expect(detail.roleAssetId).toBe('role-1')
    expect(detail.roleVersionId).toBe(3)
    expect(detail.label).toBe('分析员')
    expect(detail.systemPrompt).toBe('你是分析员')
    expect(detail.groupId).toBe('g1')
    expect(detail.systemPromptSource).toBe('角色说明.md')
  })

  it('内联角色：角色版本不可回溯时两个引用字段都省略（其余内容照常给全）', () => {
    const detail = buildInlineRoleDetail({ containerId: 'flow-1', node: inlineRoleNodeFixture() })
    expect('roleAssetId' in detail).toBe(false)
    expect('roleVersionId' in detail).toBe(false)
    expect(detail.systemPrompt).toBe('你是分析员')
  })
})

describe('maskConnection / clip（辅助纯函数）', () => {
  it('只有密钥字段被替换，其余字段原样保留', () => {
    expect(maskConnection({ host: 'h', password: 'p', token: 't' })).toEqual({ host: 'h', password: '**', token: 't' })
  })

  it('非对象 / 空值 → undefined（调用方据此省略字段）', () => {
    expect(maskConnection(null)).toBeUndefined()
    expect(maskConnection('x')).toBeUndefined()
    expect(maskConnection([1, 2])).toBeUndefined()
  })

  it('clip：空白压缩 + 超限标注', () => {
    expect(clip('  a\n\nb  ', 10)).toBe('a b')
    expect(clip('x'.repeat(20), 5)).toBe('xxxxx…（已截断）')
  })
})

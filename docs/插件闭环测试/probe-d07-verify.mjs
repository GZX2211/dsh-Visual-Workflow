// docs/插件闭环测试/probe-d07-verify.mjs
//
// D-07 修复验证探针（真实图补丁内核）：写图只产**文本型**文件节点。
// 受管形态（fileKind='file' / managedPath / files）会被归一化为文本型，并经结果显式报告
// （工具层据此出 `fileNodeTextOnly` warning），从而支持「未来要产出的交付文件」这类规划。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-d07-verify.mjs"
import { applyGraphOps } from '../../lib/tools/wf-graph-patch/apply.js'

const base = { id: 'probe', sessionId: 'probe', mode: 'mode1', name: 'probe', description: '', revision: 1, nodes: [], lines: [] }
const nodeOf = (doc, id) => (doc.nodes ?? []).find((node) => node.id === id)

// ① 编排期写「未来要产出的交付文件」（受管形态）
const wanted = applyGraphOps({
  doc: base,
  ops: [{
    op: 'create_node',
    node: {
      id: 'f1',
      kind: 'file',
      data: { label: '交付文件：实验报告', fileKind: 'file', managedPath: 'data/files/尚不存在.md' },
    },
  }],
})
console.log('① 受管意图写入后落盘 data =', JSON.stringify(nodeOf(wanted.doc, 'f1').data))
console.log('② 归一化报告 =', JSON.stringify(wanted.fileNodeTextOnlyIds))

// ③ 对照：显式文本型不受影响、也不产生归一化报告
const plain = applyGraphOps({
  doc: base,
  ops: [{ op: 'create_node', node: { id: 'f2', kind: 'file', data: { label: '任务书', fileKind: 'text', content: '正文' } } }],
})
console.log('③ 文本型节点 data =', JSON.stringify(nodeOf(plain.doc, 'f2').data))
console.log('④ 归一化报告 =', JSON.stringify(plain.fileNodeTextOnlyIds))

// ⑤ 对照：仅改名称不得抹掉既有受管配置（保护画布手工配置）
const withManaged = {
  ...base,
  nodes: [{ id: 'f3', kind: 'file', position: { x: 0, y: 0 }, data: { label: '旧件', fileKind: 'file', managedPath: 'data/files/旧件.md' } }],
}
const renamed = applyGraphOps({ doc: withManaged, ops: [{ op: 'update_node_data', nodeId: 'f3', data: { label: '改名' } }] })
console.log('⑤ 仅改名称后 data =', JSON.stringify(nodeOf(renamed.doc, 'f3').data))

const ok = nodeOf(wanted.doc, 'f1').data.fileKind === 'text'
  && nodeOf(wanted.doc, 'f1').data.managedPath === undefined
  && wanted.fileNodeTextOnlyIds.length === 1
  && plain.fileNodeTextOnlyIds.length === 0
  && nodeOf(renamed.doc, 'f3').data.fileKind === 'file'
  && nodeOf(renamed.doc, 'f3').data.managedPath === 'data/files/旧件.md'
console.log(ok ? '结论：修复生效（写图只产文本型；受管意图被显式报告；既有受管配置不被抹掉）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

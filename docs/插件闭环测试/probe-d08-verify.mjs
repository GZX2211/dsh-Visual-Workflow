// docs/插件闭环测试/probe-d08-verify.mjs
//
// D-08 修复验证探针（真实检查器）：取消 file 节点的「完整性」校验，保留 database 分支。
// 依据：checkGraphInvariants 在生产上只被 wf_graph_patch 调用（origin 恒为 'agent'），
// 而写图只产文本型 file 节点（D-07）→ 受管形态在代理路径上不可达；画布路径不经本检查器。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-d08-verify.mjs"
import { checkGraphInvariants } from '../../lib/graph/index.js'

const role = (id) => ({
  id,
  kind: 'agent',
  position: { x: 0, y: 0 },
  data: {
    label: id, systemPrompt: '探针角色', provider: '', model: '', presetId: 'combo-probe',
    retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
  },
})
const stage = (id, kind) => ({ id, kind, position: { x: 0, y: 0 }, data: { label: kind === 'start' ? '启动' : '结束' } })
const dbNode = (id) => ({
  id, kind: 'database', position: { x: 0, y: 0 },
  data: { label: id, description: '', dbType: 'local', dbKind: 'sqlite' }, // 故意不给 localPath / conn
})
const managedFile = (id) => ({
  id, kind: 'file', position: { x: 0, y: 0 },
  data: { label: id, fileKind: 'file' }, // 受管形态但未选文件（画布路径才可能产生的形态）
})
const doc = (nodes, lines) => ({ id: 'probe', sessionId: 'probe', mode: 'mode1', name: 'probe', description: '', nodes, lines })
const l = (id, source, target, sourceHandle, targetHandle) => ({ id, source, target, sourceHandle, targetHandle })
const has = (issues, code) => issues.some((i) => i.code === code)

// ① 受管文件节点未选文件：不再阻断
const fileCase = doc(
  [stage('s', 'start'), role('a1'), managedFile('f1'), stage('e', 'end')],
  [l('l1', 's', 'a1', 'flow-out', 'flow-in'), l('l2', 'a1', 'e', 'flow-out', 'flow-in'), l('c1', 'f1', 'a1', 'ctx-out', 'ctx-in')],
)
const fileIssues = checkGraphInvariants({ flow: fileCase, origin: 'agent' })
console.log('① 受管文件未选文件 → dataNodeIncomplete：', has(fileIssues, 'dataNodeIncomplete'))
console.log('   该图 error 级问题：', JSON.stringify(fileIssues.filter((i) => i.level === 'error').map((i) => i.code)))

// ② 数据库无路径且无连接：仍然阻断（保留分支）
const dbCase = doc(
  [stage('s', 'start'), role('a1'), dbNode('d1'), stage('e', 'end')],
  [l('l1', 's', 'a1', 'flow-out', 'flow-in'), l('l2', 'a1', 'e', 'flow-out', 'flow-in'), l('c1', 'd1', 'a1', 'db-out', 'db-in')],
)
const dbIssues = checkGraphInvariants({ flow: dbCase, origin: 'agent' })
console.log('② 数据库无路径无连接 → dataNodeIncomplete：', has(dbIssues, 'dataNodeIncomplete'))

const ok = !has(fileIssues, 'dataNodeIncomplete')
  && fileIssues.every((i) => i.level !== 'error')
  && has(dbIssues, 'dataNodeIncomplete')
console.log(ok ? '结论：修复生效（file 节点不再校验；database 分支保留）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

// docs/插件闭环测试/probe-d01-verify.mjs
//
// D-01 修复验证探针（真实检查器实现，不依赖 harness 进程是否重启）。
// 语义依据（用户裁决）：db 出线只能连到**角色节点**的数据库入点；连其它类型才应被拦。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-d01-verify.mjs"
import { checkGraphInvariants } from '../../lib/graph/index.js'

const role = (id, kind = 'agent') => ({
  id,
  kind,
  position: { x: 0, y: 0 },
  data: {
    label: id, systemPrompt: '探针角色', provider: '', model: '', presetId: 'combo-probe',
    retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
  },
})
const stage = (id, kind) => ({ id, kind, position: { x: 0, y: 0 }, data: { label: kind === 'start' ? '启动' : '结束' } })
const dbNode = (id) => ({
  id, kind: 'database', position: { x: 0, y: 0 },
  data: { label: id, description: '', dbType: 'local', dbKind: 'sqlite', localPath: 'probe.db' },
})
const fileNode = (id) => ({ id, kind: 'file', position: { x: 0, y: 0 }, data: { label: id, fileKind: 'text', content: 'x' } })
const doc = (nodes, lines) => ({ id: 'probe', sessionId: 'probe', mode: 'mode1', name: 'probe', description: '', nodes, lines })
const l = (id, source, target, sourceHandle, targetHandle) => ({ id, source, target, sourceHandle, targetHandle })

const legal = doc(
  [stage('s', 'start'), role('a1'), dbNode('d1'), stage('e', 'end')],
  [l('l1', 's', 'a1', 'flow-out', 'flow-in'), l('l2', 'a1', 'e', 'flow-out', 'flow-in'), l('c1', 'd1', 'a1', 'db-out', 'db-in')],
)
const illegal = doc(
  [stage('s', 'start'), role('a1'), fileNode('f1'), dbNode('d1'), stage('e', 'end')],
  [l('l1', 's', 'a1', 'flow-out', 'flow-in'), l('l2', 'a1', 'e', 'flow-out', 'flow-in'), l('c1', 'd1', 'f1', 'db-out', 'db-in')],
)

const has = (issues, code) => issues.some((i) => i.code === code)
const a = checkGraphInvariants({ flow: legal, origin: 'agent' })
const b = checkGraphInvariants({ flow: illegal, origin: 'agent' })

console.log('① 合法（database → 角色节点 db-in）被误报 dbLineTargetInvalid：', has(a, 'dbLineTargetInvalid'))
console.log('   合法图 error 级问题：', JSON.stringify(a.filter((i) => i.level === 'error').map((i) => i.code)))
console.log('② 非法（database → 文件节点 db-in）被拦 dbLineTargetInvalid：', has(b, 'dbLineTargetInvalid'))

const ok = !has(a, 'dbLineTargetInvalid') && a.every((i) => i.level !== 'error') && has(b, 'dbLineTargetInvalid')
console.log(ok ? '结论：修复生效（db 线可连角色节点；非角色节点目标被拦）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

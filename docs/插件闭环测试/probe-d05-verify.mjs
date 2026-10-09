// docs/插件闭环测试/probe-d05-verify.mjs
//
// D-05 修复验证探针（真实实现，端到端复现用户遇到的原场景）：
//   规划期没有任何运行中的编排，但已用 wf_graph_patch 改过图 —— 此时应当允许提交编排经验。
// 判定链：GraphPatchLogStore（真实持久化）→ 会话索引 → ExperienceRuntimePort.hasGraphPatch
//         → resolveExperienceSubject（真实职责判定）。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-d05-verify.mjs"
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphPatchLogStore } from '../../lib/storage/graph-patch-log.js'
import { resolveExperienceSubject } from '../../lib/experience/subject.js'

const root = await mkdtemp(join(tmpdir(), 'vw-d05-'))
await mkdir(join(root, 'graph-patches'), { recursive: true })
const log = new GraphPatchLogStore(root)

// 规划期场景：没有运行实例，只有一次成功的图结构补丁
const record = await log.record({ sessionId: 'session-planner', targetId: 'tpl-23aa312795b8', scope: 'template' })
console.log('① 记录改图事实：', JSON.stringify(record))
const patched = new Set(await log.listSessionIds())
console.log('② 宿主启动装载的会话索引 =', JSON.stringify([...patched]))

// 与宿主 experienceRuntimePort 同形的适配（无任何运行中的编排）
const runtime = {
  activeRunForSession: () => null,
  runForChild: () => null,
  hasTeamInCurrentRun: () => false,
  hasActiveRun: () => false,
  hasGraphPatch: (sessionId) => patched.has(sessionId),
  modelForCaller: () => '',
}

let subject = null
try {
  subject = resolveExperienceSubject({
    caller: { isChild: false, sessionId: 'session-planner' },
    type: 'orchestrator',
    runtime,
  })
} catch (error) {
  console.log('③ 改过图的会话提交编排经验 → 仍被拒绝：', error.message)
}
if (subject) console.log(`③ 改过图的会话提交编排经验 → 允许（sourceRunId="${subject.sourceRunId}"）`)

let rejected = ''
try {
  resolveExperienceSubject({ caller: { isChild: false, sessionId: 'session-fresh' }, type: 'orchestrator', runtime })
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error)
}
console.log('④ 未改图的会话提交编排经验 →', rejected ? '拒绝（符合预期）' : '错误：竟然被允许')
if (rejected) console.log('   拒绝原因：', rejected)

await rm(root, { recursive: true, force: true })

const ok = subject !== null && subject.sourceRunId === '' && rejected.includes('也没有改过工作流图')
console.log(ok ? '结论：修复生效（改过图即可提交编排经验；未改图仍被拒绝）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

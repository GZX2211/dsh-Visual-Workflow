// docs/插件闭环测试/probe-d09-verify.mjs
//
// D-09 修复验证探针（真实主体解析）：读取侧不施加职责门禁，写入侧保持；文案按操作区分。
// 依据（用户裁决 2026-10-10）：写入侧的类型表达「经验属于谁」（客观归属），读取侧若要求表达
// 「我此刻是谁」（主观身份），会因职责随会话进程变化而自锁。
//
// 用法（仓库根）：node "docs\插件闭环测试\probe-d09-verify.mjs"
import { resolveExperienceReaderSubject, resolveExperienceSubject } from '../../lib/experience/subject.js'

// 与宿主 experienceRuntimePort 同形：会话既无运行实例、也未启动协作组，但已改过图
const patched = 'session-patched'
const runtime = {
  activeRunForSession: () => null,
  runForChild: () => null,
  hasTeamInCurrentRun: () => false,
  hasActiveRun: () => false,
  hasGraphPatch: (sessionId) => sessionId === patched,
  modelForCaller: () => '',
}
const caller = { isChild: false, sessionId: patched }

// ① 写入侧：改过图 → 只允许 orchestrator，提交 agent 应被拒
let writeRejected = ''
try {
  resolveExperienceSubject({ caller, type: 'agent', runtime })
} catch (error) {
  writeRejected = error instanceof Error ? error.message : String(error)
}
console.log('① 写入侧提交 agent →', writeRejected ? '拒绝（符合预期）' : '错误：竟然允许')

// ② 读取侧：同一身份召回 agent 经验应被放行（改图前正是这里被自身身份挡住）
let readSubject = null
try {
  readSubject = resolveExperienceReaderSubject({ caller, type: 'agent', runtime })
} catch (error) {
  console.log('② 读取侧召回 agent → 仍被拒：', error instanceof Error ? error.message : String(error))
}
if (readSubject) {
  console.log(`② 读取侧召回 agent → 允许（subjectId="${readSubject.subjectId}"，sourceRunId="${readSubject.sourceRunId}"）`)
}

// ③ 读取侧：未启动协作组也能解析 team 读取主体（协作组上下文在启动前查询）
const teamSubject = resolveExperienceReaderSubject({ caller, type: 'team', runtime })
console.log('③ 读取侧召回 team →', teamSubject.experienceType === 'team' ? '允许（符合预期）' : '错误')

// ④ 文案按操作区分：非法类型在两侧给出不同措辞
let writeTail = ''
let readTail = ''
try {
  resolveExperienceSubject({ caller, type: 'junk', runtime })
} catch (error) {
  writeTail = error instanceof Error ? error.message : String(error)
}
try {
  resolveExperienceReaderSubject({ caller, type: 'junk', runtime })
} catch (error) {
  readTail = error instanceof Error ? error.message : String(error)
}
console.log('④ 写入侧文案结尾 =', writeTail.slice(-6), '| 读取侧文案结尾 =', readTail.slice(-6))

// ⑤ 子代理读取编排经验：应明确拒绝（而不是静默回退到 agent 池）
let childRejected = ''
try {
  resolveExperienceReaderSubject({
    caller: { isChild: true, sessionId: 'session-child', childId: 'child-1' },
    type: 'orchestrator',
    runtime: {
      ...runtime,
      runForChild: () => ({ runId: 'run-child', flowId: 'flow-1', sessionId: 'session-child', nodeId: 'node-1' }),
    },
  })
} catch (error) {
  childRejected = error instanceof Error ? error.message : String(error)
}
console.log('⑤ 子代理召回编排经验 →', childRejected ? '明确拒绝（符合预期）' : '错误：竟然放行')

const ok = writeRejected.includes('不能提交 agent 经验')
  && readSubject !== null && readSubject.sourceRunId === ''
  && teamSubject.experienceType === 'team'
  && writeTail.includes('重新提交') && readTail.includes('重新召回')
  && childRejected.includes('只能召回 agent 经验')
console.log(ok ? '结论：修复生效（读取侧放开；写入侧保持；子代理边界明确；文案按操作区分）' : '结论：修复未生效，需要排查')
process.exit(ok ? 0 : 2)

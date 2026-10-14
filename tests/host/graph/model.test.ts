// tests/host/graph/model.test.ts
//
// 图模型运行时测试（原 tests/host/graph-model.test.ts 拆分）：
//   - 连接点兼容矩阵与拓扑查询助手（入口解析、出/入边、流程线判定、虚拟节点、协作组成员）。
// 校验与归一化（validate.ts）见 ./validate.test.ts；元参数见 ./org-meta.test.ts。
// 断言依据：架构文档 §4.2 + 需求文档 §4.2/§4.3/§4.2.5。

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HANDLE_PAIRING,
  NODE_HANDLES,
  NODE_KINDS,
  autoContextSourceIds,
  ctxInEdges,
  dbInEdges,
  entryNodes,
  flowOutEdges,
  flowInEdges,
  isFlowLine,
  isGroupMember,
  newDatabaseNode,
  newFileNode,
  newGroupNode,
  newLine,
  newProxyNode,
  newRoleNode,
  newStageNode,
  nodeHasFlowIn,
  nodeParticipatesInFlow,
  pairingTargetOf,
  proxiesOf,
} from '../../../src/host/graph/index.js'
import type { Handle } from '../../../src/host/shared/graph-model.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../src/host/shared/protocol.js'
import { makeFlow } from './fixtures/flow-fixture.js'

describe('连接点兼容矩阵（NODE_HANDLES）', () => {
  it('9 类节点矩阵齐全且与需求连接点定义一致', () => {
    expect(NODE_KINDS).toHaveLength(9)
    expect(NODE_HANDLES.parent.inputs).toEqual(['flow-in', 'ctx-in', 'db-in'])
    expect(NODE_HANDLES.parent.outputs).toEqual(['flow-out', 'ctx-out'])
    expect(NODE_HANDLES.file).toEqual({ inputs: [], outputs: ['ctx-out'] })
    expect(NODE_HANDLES.database).toEqual({ inputs: [], outputs: ['db-out'] })
    expect(NODE_HANDLES.start).toEqual({ inputs: [], outputs: ['flow-out', 'ctx-out'] })
    expect(NODE_HANDLES.end.outputs).toEqual([])
    expect(NODE_HANDLES.pause).toEqual({ inputs: ['flow-in'], outputs: ['flow-out'] })
    expect(NODE_HANDLES.group).toEqual({ inputs: ['flow-in'], outputs: ['flow-out'] })
    expect(NODE_HANDLES.proxy).toEqual(NODE_HANDLES.agent)
  })
})

describe('拓扑助手（连线查询）', () => {
  it('flowOutEdges/ctxInEdges/dbInEdges 正确', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const c = newRoleNode('agent', 'c')
    const db = newDatabaseNode('local', 'db')
    const f = newFileNode('text', 'f')
    const lines = [
      newLine(a.id, b.id, 'flow-out', 'flow-in'),
      newLine(f.id, c.id, 'ctx-out', 'ctx-in'),
      newLine(a.id, c.id, 'ctx-out', 'ctx-in'),
      newLine(db.id, c.id, 'db-out', 'db-in'),
    ]
    const flow = makeFlow([a, b, c, db, f], lines)
    expect(flowOutEdges(flow, a.id).map((l) => l.target)).toEqual([b.id])
    expect(ctxInEdges(flow, c.id).map((l) => l.source).sort()).toEqual([a.id, f.id].sort())
    expect(dbInEdges(flow, c.id).map((l) => l.source)).toEqual([db.id])
  })
})

// ---------------------------------------------------------------------------
// 自动上下文来源枚举（autoContextSourceIds）
// ---------------------------------------------------------------------------
// 语义：下游节点自动接收**直接流程前驱**的最终产出；无产出的阶段节点（pause）被跳过；
// 协作组与上下游解耦（不作来源也不回溯）；虚拟节点流程线归属主节点。

describe('自动上下文来源枚举（autoContextSourceIds）', () => {
  it('无流程入边：返回空（含组内成员这类没有流程线的节点）', () => {
    const a = newRoleNode('agent', 'a')
    expect(autoContextSourceIds(makeFlow([a]), a.id)).toEqual([])
  })

  it('单前驱：返回直接流程前驱（角色节点之间的 ctx 连线不算流程前驱）', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow([a, b], [newLine(a.id, b.id, 'flow-out', 'flow-in'), newLine(a.id, b.id, 'ctx-out', 'ctx-in')])
    expect(autoContextSourceIds(flow, b.id)).toEqual([a.id])
  })

  it('多前驱：按流程线声明顺序返回（保序）', () => {
    const a1 = newRoleNode('agent', 'a1')
    const a2 = newRoleNode('agent', 'a2')
    const a3 = newRoleNode('agent', 'a3')
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow(
      [a1, a2, a3, b],
      [
        newLine(a2.id, b.id, 'flow-out', 'flow-in'),
        newLine(a1.id, b.id, 'flow-out', 'flow-in'),
        newLine(a3.id, b.id, 'flow-out', 'flow-in'),
      ],
    )
    expect(autoContextSourceIds(flow, b.id)).toEqual([a2.id, a1.id, a3.id])
  })

  it('重复流程线（同源同目标）：去重', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow([a, b], [newLine(a.id, b.id, 'flow-out', 'flow-in'), newLine(a.id, b.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, b.id)).toEqual([a.id])
  })

  it('暂停节点无产出：跳过它继续向前找', () => {
    const a = newRoleNode('agent', 'a')
    const p = newStageNode('pause', 'mode1')
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow([a, p, b], [newLine(a.id, p.id, 'flow-out', 'flow-in'), newLine(p.id, b.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, b.id)).toEqual([a.id])
  })

  it('协作组解耦：协作组卡片既不作来源也不回溯到组的上游', () => {
    const a = newRoleNode('agent', 'a')
    const g = newGroupNode('g')
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow([a, g, b], [newLine(a.id, g.id, 'flow-out', 'flow-in'), newLine(g.id, b.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, b.id)).toEqual([])
  })

  it('虚拟节点前驱：解析为引用的主节点（快照按主节点记账）', () => {
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow([main, proxy, b], [newLine(proxy.id, b.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, b.id)).toEqual([main.id])
  })

  it('虚拟节点归属：流程线接在虚拟节点上时，主节点同样获得其上游来源', () => {
    const a = newRoleNode('agent', 'a')
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const flow = makeFlow([a, main, proxy], [newLine(a.id, proxy.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, main.id)).toEqual([a.id])
  })

  it('模式二输入节点（start）是合法来源；模式一启动节点也返回（由消费方按产出过滤）', () => {
    const s = newStageNode('start', 'mode1')
    const a = newRoleNode('agent', 'a')
    const flow = makeFlow([s, a], [newLine(s.id, a.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, a.id)).toEqual([s.id])
  })

  it('纯函数：同一图两次枚举结果相同', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const flow = makeFlow([a, b], [newLine(a.id, b.id, 'flow-out', 'flow-in')])
    expect(autoContextSourceIds(flow, b.id)).toEqual(autoContextSourceIds(flow, b.id))
  })
})

describe('角色节点工厂默认值（newRoleNode）', () => {
  it('agent 节点默认落盘输出契约文本；输入契约为空（默认配置即磁盘真值）', () => {
    const node = newRoleNode('agent', '新角色')
    expect(node.data.outputSchema).toBe(DEFAULT_OUTPUT_CONTRACT_TEXT)
    expect(node.data.inputSchema).toBe('')
  })

  it('parent 节点不落默认输出契约（父代理不参与节点交接）', () => {
    expect(newRoleNode('parent', '父代理').data.outputSchema).toBe('')
  })
})

describe('入口解析与节点归属判定', () => {  it('entryNodes：start 即显式入口；缺失时为空（§4.2 入口解析）', () => {
    const s = newStageNode('start', 'mode1')
    const a = newRoleNode('agent', 'a')
    expect(entryNodes(makeFlow([s, a])).map((n) => n.id)).toEqual([s.id])
    expect(entryNodes(makeFlow([a]))).toEqual([])
  })

  it('proxiesOf/isGroupMember 正确', () => {
    const main = newRoleNode('agent', 'main')
    const proxy = newProxyNode(main.id)
    const g = newGroupNode('g')
    const member = newRoleNode('agent', 'm')
    member.data.groupId = g.id
    const flow = makeFlow([main, proxy, g, member])
    expect(proxiesOf(flow, main.id).map((n) => n.id)).toEqual([proxy.id])
    expect(isGroupMember(flow, member.id)).toBe(true)
    expect(isGroupMember(flow, main.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 流程线判定与流程参与度（三通道互斥；编排清单判定依据）
// ---------------------------------------------------------------------------

describe('流程线判定（isFlowLine）与流程参与度', () => {
  it('仅 flow-out → flow-in 是流程线；ctx / db 通道不参与流程', () => {
    const a = newRoleNode('agent', 'a')
    const b = newRoleNode('agent', 'b')
    const db = newDatabaseNode('local', 'db')
    const f = newFileNode('text', 'f')
    expect(isFlowLine(newLine(a.id, b.id, 'flow-out', 'flow-in'))).toBe(true)
    expect(isFlowLine(newLine(f.id, b.id, 'ctx-out', 'ctx-in'))).toBe(false)
    expect(isFlowLine(newLine(db.id, b.id, 'db-out', 'db-in'))).toBe(false)
  })

  it('幽灵线（单侧命中流程通道）不算流程线，也不让节点「参与流程」', () => {
    // 历史/手改数据可能出现 ctx-out → flow-in 这类非法线：通道互斥，它不在流程
    // 子图中，因此不能被算作「参与流程」（否则编排清单会多出无效节点）。
    const a = newRoleNode('agent', 'a')
    const ghost = newRoleNode('agent', 'ghost')
    const ghostLine = newLine(a.id, ghost.id, 'ctx-out', 'flow-in')
    const flow = makeFlow([a, ghost], [ghostLine])
    expect(isFlowLine(ghostLine)).toBe(false)
    expect(nodeParticipatesInFlow(flow, ghost.id)).toBe(false)
    expect(nodeHasFlowIn(flow, ghost.id)).toBe(false)
    // 流程边查询与判定同源：幽灵线不出现在流程出/入边列表里
    expect(flowOutEdges(flow, a.id)).toEqual([])
    expect(flowInEdges(flow, ghost.id)).toEqual([])
  })

  it('nodeParticipatesInFlow：主节点或其虚拟节点被流程线触及即算参与', () => {
    const main = newRoleNode('agent', 'main')
    const other = newRoleNode('agent', 'other')
    const proxy = newProxyNode(main.id)
    const flow = makeFlow([main, other, proxy], [newLine(other.id, proxy.id, 'flow-out', 'flow-in')])
    expect(nodeParticipatesInFlow(flow, main.id)).toBe(true)
    expect(nodeParticipatesInFlow(flow, other.id)).toBe(true)
    // 只有流程出、没有流程入 → 参与流程，但未被驱动
    expect(nodeHasFlowIn(flow, other.id)).toBe(false)
    expect(nodeHasFlowIn(flow, main.id)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 通道配对查询：只以输出连接点为源
// ---------------------------------------------------------------------------

describe('通道配对查询（pairingTargetOf）', () => {
  it('三个输出连接点各映射到对应入点；未登记的源回退为自身', () => {
    expect(pairingTargetOf('flow-out')).toBe('flow-in')
    expect(pairingTargetOf('ctx-out')).toBe('ctx-in')
    expect(pairingTargetOf('db-out')).toBe('db-in')
    // 入点不是合法查询源；回退为自身，供调用方按「通道不匹配」报错而不是抛类型错误
    expect(pairingTargetOf('flow-in' as Handle)).toBe('flow-in')
  })

  it('查询契约与矩阵本体一致（validate 与 graph_patch 共用同一入口）', () => {
    const outputs: Handle[] = ['flow-out', 'ctx-out', 'db-out']
    for (const source of outputs) {
      expect(pairingTargetOf(source)).toBe(HANDLE_PAIRING[source])
    }
  })
})

// ---------------------------------------------------------------------------
// 通道本体：连接点名只允许一处定义（消除「矩阵 vs 规则硬编码」两套口径）
// ---------------------------------------------------------------------------

/**
 * 去掉注释只留代码（`//` 与块注释；字符串与模板字符串原样保留，行结构不变）。
 * 为什么需要：通道名出现在解释性注释里是说明文字，不是判定口径；口径只认代码。
 */
function codeOnly(source: string): string {
  let out = ''
  let quote: string | null = null
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (quote !== null) {
      if (char === '\\') {
        out += char + (next ?? '')
        index += 1
        continue
      }
      if (char === quote) quote = null
      out += char
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') out += '\n'
        index += 1
      }
      index += 1
      continue
    }
    out += char
  }
  return out
}

describe('通道本体（HANDLE_CHANNELS）', () => {
  it('连接点名裸字面量只允许出现在 model.ts：其余文件一律经通道本体查询', () => {
    const graphDir = fileURLToPath(new URL('../../../src/host/graph/', import.meta.url))
    const files = readdirSync(graphDir).filter((name) => name.endsWith('.ts') && name !== 'model.ts')
    expect(files.length, '至少应扫到若干图模块文件，否则断言在空集上假通过').toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      const code = codeOnly(readFileSync(join(graphDir, file), 'utf8'))
      for (const match of code.matchAll(/'(flow|ctx|db)-(in|out)'/g)) offenders.push(`${file}: ${match[0]}`)
    }
    expect(offenders, `以下文件仍硬编码通道名（应改用 HANDLE_CHANNELS/channelIn/channelOut 查询）：${offenders.join(', ')}`).toEqual([])
  })

  it('配对矩阵是通道本体的投影：每个通道 out→in 成对且入点恒等', () => {
    // 本体与矩阵必须同源——本用例锁定「矩阵不是第二份口径」
    expect(pairingTargetOf('flow-out')).toBe('flow-in')
    expect(pairingTargetOf('ctx-out')).toBe('ctx-in')
    expect(pairingTargetOf('db-out')).toBe('db-in')
    expect(HANDLE_PAIRING['flow-in']).toBe('flow-in')
    expect(HANDLE_PAIRING['ctx-in']).toBe('ctx-in')
    expect(HANDLE_PAIRING['db-in']).toBe('db-in')
  })
})

// tests/host/tools/fixtures/db-fixture.ts
//
// wf_db_query 相关测试的数据库夹具（非测试文件，vitest 不收集）：
//   - 带数据的临时 SQLite 库（可写模式建库，测后由 tempDir 清理）；
//   - 含数据库节点与 db-in 连线的标准流程。

import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import { role, stage } from './tool-harness.js'

/** 创建带数据的临时 SQLite 库（products 3 行 + notes 2 行）。 */
export async function makeSqliteDb(dir: string, name = 'test.db'): Promise<string> {
  const file = join(dir, name)
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)')
  db.exec("INSERT INTO products (name, price) VALUES ('苹果', 5.5), ('香蕉', 3.2), ('汽车', 200000)")
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)')
  db.exec("INSERT INTO notes (content) VALUES ('数据库 向量 检索'), ('BM25 降级 方案')")
  db.close()
  return file
}

/** 标准流程：start → a1(db-in) + a2(无连线) + p1(db-in) → end，数据节点 d1 指向给定库文件。 */
export function makeDbFlow(dbFile: string): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '数据流程',
    description: '',
    revision: 1,
    nodes: [
      stage('n-start', 'start'),
      {
        id: 'd1',
        kind: 'database',
        position: { x: 0, y: 0 },
        data: { label: '本地库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: dbFile },
      },
      role('a1', 'agent', '查询代理'),
      role('a2', 'agent', '无连线代理'),
      role('p1', 'parent', '父代理'),
      stage('n-end', 'end'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'd1', target: 'a1', sourceHandle: 'db-out', targetHandle: 'db-in' },
      { id: 'l4', source: 'd1', target: 'p1', sourceHandle: 'db-out', targetHandle: 'db-in' },
    ],
  }
}

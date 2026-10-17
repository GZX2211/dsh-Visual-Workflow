// tests/host/assets/concurrency.test.ts
//
// 资产库的并发事务语义：`AssetDb` 的进程内串行队列（SerialQueue）与 `withTx` 的配合。
//
// 为什么单独成文件：这是「读改写不出事务」「失败不留半成品」两条硬规则的**唯一**机制承载物
// （src/host/assets/db.ts 顶部注释自述：不加队列会让两笔并发写事务交错，一方回滚会连带回滚
// 另一方已完成的写入）。本文件以 Promise.all / Promise.allSettled 并发驱动同一条写路径，
// 把该保证锁进断言：交错、吞并或回滚连带一旦发生，下列不变量即失败。
//
// 三个不变量：
//   1. 并发写入互不吞并（每笔事务的行都完整存在）；
//   2. 一笔事务回滚不被另一笔的失败连带（失败方不留半成品）；
//   3. 临界区严格串行（后到者的任务在先到者离开临界区后才开始执行，读写不丢更新）。
// 另有一类必须显式失败的输入：事务内再开事务（重入）——同一连接上的队列不可重入，
// 不检测就会自排队尾并 await 自己（永久挂起），故以「立即抛错 + 队列可继续使用」锁定。

import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExperienceDuplicateJudge } from "../../../src/host/shared/asset-types.js"
import { AssetDb } from "../../../src/host/assets/db.js"
import { experienceRow, keepAllJudge, makeStore, removeTempRoot } from "./fixtures/asset-fixture.js"

/** 待回收资源（本文件同时用 AssetStore 与裸 AssetDb 两种装配）。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

describe("并发经验写入（AssetStore.insertChecked）", () => {
  it("test_并发写入_多路insertChecked全部成功_每笔各自的写入都完整存在", async () => {
    const { store, root } = await makeStore()
    cleanups.push(async () => {
      store.close()
      await removeTempRoot(root)
    })
    const ids = Array.from({ length: 8 }, (_, index) => `ex-${index}`)

    const results = await Promise.all(
      ids.map((id) => store.insertChecked({ rows: [experienceRow(id)], duplicateOf: keepAllJudge })),
    )

    // 无丢失更新：8 笔各自都提交成功，没有一笔被另一笔的提交吞掉或卡住。
    for (const result of results) {
      expect(result.skipped).toEqual([])
      expect(result.inserted).toHaveLength(1)
    }
    const rows = await store.listRows(50)
    expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort())
  })

  it("test_并发写入_一路判重抛错整笔回滚_另一路已提交的行不被连带回滚", async () => {
    const { store, root } = await makeStore()
    cleanups.push(async () => {
      store.close()
      await removeTempRoot(root)
    })
    const throwingJudge: ExperienceDuplicateJudge = (candidate) => {
      if (candidate.decisionRetrievalText === "触发判重失败") throw new Error("判重服务不可用")
      return { duplicate: false }
    }

    // 两笔并发写事务：先登记的必然失败（批内判重抛错 → ROLLBACK），后一笔必须正常落盘。
    // 失败批刻意放两行——判重闭包只对「已存在的同类型活跃行」调用（空库首行不判重），
    // 这样才真正走到抛错分支并让整批回滚（含批内已写入的第一行）。
    // 本用例锁定结果层不变量：失败事务不留半成品，也不带走另一笔已提交的行（库内恰为 ex-ok）；
    // 串行队列本身是否生效由本文件下一组的 enter/exit 序列观测，此处不对它下断言。
    const failing = store.insertChecked({
      rows: [experienceRow("ex-bad-1"), experienceRow("ex-bad-2", { decisionRetrievalText: "触发判重失败" })],
      duplicateOf: throwingJudge,
    })
    const succeeding = store.insertChecked({ rows: [experienceRow("ex-ok")], duplicateOf: keepAllJudge })

    await expect(failing).rejects.toThrow("判重服务不可用")
    const okResult = await succeeding
    expect(okResult.skipped).toEqual([])
    expect(okResult.inserted.map((entry) => entry.id)).toEqual(["ex-ok"])
    // 失败事务不留半成品，成功事务的行仍在：库内恰好只有 ex-ok。
    expect((await store.listRows(50)).map((row) => row.id)).toEqual(["ex-ok"])
  })
})

describe("事务临界区串行化（AssetDb.withTx）", () => {
  it("test_并发事务_临界区严格串行_读改写不丢更新", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-assets-concurrency-"))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const db = new AssetDb(root)
    cleanups.push(async () => db.close())
    await db.open()
    await db.withTx((tx) => {
      tx.exec("CREATE TABLE counter (n INTEGER NOT NULL)")
      tx.run("INSERT INTO counter (n) VALUES (0)")
    })

    const entered: string[] = []
    let release!: () => void
    // 可控门闩（不是 sleep）：先到者进入临界区后阻塞，用来观察后到者是否被队列挡住。
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const bump = (name: string): Promise<void> =>
      db.withTx(async (tx) => {
        entered.push(`${name}:enter`)
        const current = Number(tx.get("SELECT n FROM counter")?.n ?? 0)
        await gate
        tx.run("UPDATE counter SET n = ?", [current + 1])
        entered.push(`${name}:exit`)
      })

    const first = bump("a")
    const second = bump("b")
    // 让后到者的任务有机会被调度：串行队列生效时它必须还在排队（未进入临界区）。
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(entered).toEqual(["a:enter"])

    release()
    await Promise.all([first, second])
    // 临界区严格串行：不存在 enter/enter/exit/exit 的交错。
    expect(entered).toEqual(["a:enter", "a:exit", "b:enter", "b:exit"])
    // 读改写在同一临界区内完成：两次 +1 的结果必然是 2（无丢更新）。
    const final = await db.withTx((tx) => tx.get("SELECT n FROM counter"))
    expect(Number(final?.n)).toBe(2)
  })
})

describe("事务重入检测（AssetDb 事务不可嵌套）", () => {
  it("test_withTx回调内再调withTx_立即抛错_外层整笔回滚且队列可继续使用", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-assets-reentry-"))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const db = new AssetDb(root)
    cleanups.push(async () => db.close())
    await db.open()
    await db.withTx((tx) => tx.exec("CREATE TABLE t (n INTEGER NOT NULL)"))

    // 不检测重入时：内层 withTx 排在队尾并等待外层让出临界区，而外层正 await 内层 → 永久挂起。
    await expect(
      db.withTx(async (tx) => {
        tx.run("INSERT INTO t (n) VALUES (1)")
        await db.withTx((inner) => inner.get("SELECT 1"))
      }),
    ).rejects.toThrow(/不可重入/)
    // 外层回调抛错 → 整笔回滚，不留半成品
    expect(await db.withTx((tx) => tx.all("SELECT n FROM t"))).toEqual([])
    // 队列未被占用（内层从未入队）：后续事务照常执行
    await db.withTx((tx) => tx.run("INSERT INTO t (n) VALUES (2)"))
    expect(await db.withTx((tx) => tx.all("SELECT n FROM t"))).toHaveLength(1)
  })

  it("test_withTx回调内调withRead_同样立即抛错_读事务与外层共用同一队列", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-assets-reentry-read-"))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const db = new AssetDb(root)
    cleanups.push(async () => db.close())
    await db.open()
    await db.withTx((tx) => tx.exec("CREATE TABLE t (n INTEGER NOT NULL)"))

    await expect(db.withTx(() => db.withRead((tx) => tx.get("SELECT 1")))).rejects.toThrow(/不可重入/)
    // 失败路径不留未复位的连接状态：读写都能照常继续
    await db.withTx((tx) => tx.run("INSERT INTO t (n) VALUES (3)"))
    expect(Number((await db.withRead((tx) => tx.get("SELECT n FROM t")))?.n)).toBe(3)
  })

  it("test_跨句柄嵌套_不算重入（各连接独立队列，不误报）", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "dsh-assets-handle-a-"))
    const rootB = await mkdtemp(join(tmpdir(), "dsh-assets-handle-b-"))
    cleanups.push(() => rm(rootA, { recursive: true, force: true }))
    cleanups.push(() => rm(rootB, { recursive: true, force: true }))
    const first = new AssetDb(rootA)
    const second = new AssetDb(rootB)
    cleanups.push(async () => {
      first.close()
      second.close()
    })
    await first.open()
    await second.open()

    // 同一进程可能存在多个句柄（只读句柄/测试夹具）：各有独立串行队列，跨句柄嵌套不会自等
    await first.withTx(async (tx) => {
      tx.exec("CREATE TABLE a (n INTEGER NOT NULL)")
      await second.withTx((other) => other.exec("CREATE TABLE b (n INTEGER NOT NULL)"))
    })

    expect(await first.withTx((tx) => tx.all("SELECT name FROM sqlite_master WHERE name = 'a'"))).toHaveLength(1)
    expect(await second.withTx((tx) => tx.all("SELECT name FROM sqlite_master WHERE name = 'b'"))).toHaveLength(1)
  })
})

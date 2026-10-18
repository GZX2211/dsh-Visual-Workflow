// src/host/experience/retirement-sweep.ts
//
// 退役扫描的编排：读活跃经验的判定事实 → 纯函数判定 → 条件归档。
//
// 为什么扫描与纯判定分开：判定要能被离线复现（不读时钟、不碰数据库），而扫描必须承担
// 「单条失败不拖垮整轮」的运行语义。两者混在一起后，任何一个 IO 异常都会让判定测试
// 不得不构造数据库；分开后，判定公式与重试/告警边界各自独立可验证。
//
// 失败语义：读取事实失败向上抛（整轮没有可判定的输入，宿主记录后等下一轮）；
// 单条归档失败只告警并继续（其余经验仍应被治理，下一轮扫描会重试该条）。

import { messageOf } from "../orchestrator/errors.js"
import type {
  ExperienceAutoRetirementReason,
  ExperienceRetirementFacts,
} from "../shared/asset-types.js"
import type { ExperienceStorePort } from "./ports.js"
import { decideExperienceRetirement } from "./retirement.js"

/** 扫描只依赖读事实与条件归档两个端口能力（便于单测注入最小 fake）。 */
export interface ExperienceRetirementSweepDeps {
  store: Pick<ExperienceStorePort, "listRetirementFacts" | "retireForPolicy">
  logger?: { warn(message: string): void }
}

/** 一轮扫描结果：处理了多少条活跃经验、其中哪些真正被归档。 */
export interface ExperienceRetirementSweepResult {
  scanned: number
  retired: Array<{ experienceId: string; reason: ExperienceAutoRetirementReason }>
}

/**
 * 执行一轮退役扫描。
 *
 * `scanned` 是活跃经验条数而不是归档条数：它让调用方能区分「没有候选」与「有候选但都不该归档」。
 * 只有 `retireForPolicy` 返回 true（确实从活跃变为归档）才计入 `retired`：
 * 扫描与手动恢复/归档并发时，条件更新可能返回 false，那表示另一条路径已经处理过这条经验，
 * 不是失败，也不该重复上报。
 */
export async function sweepExperienceRetirements(
  deps: ExperienceRetirementSweepDeps,
): Promise<ExperienceRetirementSweepResult> {
  const facts: ExperienceRetirementFacts[] = await deps.store.listRetirementFacts()
  const retired: ExperienceRetirementSweepResult["retired"] = []

  for (const fact of facts) {
    const decision = decideExperienceRetirement(fact)
    if (!decision.retire) continue
    try {
      const changed = await deps.store.retireForPolicy(fact.experienceId, decision.reason)
      if (changed) retired.push({ experienceId: fact.experienceId, reason: decision.reason })
    } catch (error) {
      deps.logger?.warn(
        `[visual-workflow] 经验自动归档失败（experience=${fact.experienceId} reason=${decision.reason}）：`
          + `${messageOf(error)}；下一轮扫描会重试。`,
      )
    }
  }

  return { scanned: facts.length, retired }
}

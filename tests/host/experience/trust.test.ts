// tests/host/experience/trust.test.ts
//
// 质量信号与信任度门（§14）。
//
// 为什么单独锁这两条公式：召回修正只消费 qualitySignal（中心化，可正可负），界面展示消费
// trust（正区间，0.5 表示证据不足）。两者混用会让「证据不足」被当成「一半可信」，因此
// 必须分别验证取值域与符号语义。

import { describe, expect, it } from "vitest"
import { calculateQualitySignal, calculateTrust } from "../../../src/host/experience/trust.js"

describe("calculateQualitySignal（§14 value × evidence × (0.5 + 0.5 × stability)）", () => {
  it("test_三条输入确定_命中公式乘积", () => {
    const quality = calculateQualitySignal({ empiricalValue: 0.25, evidenceStrength: 0.5, stability: 0 })

    expect(quality).toBeCloseTo(0.0625, 12)
  })

  it("test_稳定性为 0_价值与证据之外再打对折", () => {
    const low = calculateQualitySignal({ empiricalValue: 0.4, evidenceStrength: 1, stability: 0 })
    const high = calculateQualitySignal({ empiricalValue: 0.4, evidenceStrength: 1, stability: 1 })

    expect(low).toBeCloseTo(0.2, 12)
    expect(high).toBeCloseTo(0.4, 12)
  })

  it("test_冷启动无证据_质量信号为 0", () => {
    expect(calculateQualitySignal({ empiricalValue: 0, evidenceStrength: 0, stability: 1 })).toBe(0)
  })

  it("test_有害经验_质量信号为负", () => {
    expect(calculateQualitySignal({ empiricalValue: -0.5, evidenceStrength: 0.9, stability: 1 })).toBeLessThan(0)
  })
})

describe("calculateTrust（§14 trust = 0.5 + 0.45 × quality_signal ∈ [0.05, 0.95]）", () => {
  it("test_无证据_保持中性 0.5", () => {
    expect(calculateTrust(0)).toBe(0.5)
  })

  it("test_质量信号取极值_信任度贴住上下界", () => {
    expect(calculateTrust(1)).toBeCloseTo(0.95, 12)
    expect(calculateTrust(-1)).toBeCloseTo(0.05, 12)
  })

  it("test_数值舍入越界_仍被夹回声明取值域", () => {
    // 下界由 0.5 - 0.45 得出，IEEE-754 下为 0.04999999999999999（与 0.05 相差 1e-17 量级）
    expect(calculateTrust(1.0000000000000002)).toBe(0.95)
    expect(calculateTrust(-1.0000000000000002)).toBeCloseTo(0.05, 12)
  })
})

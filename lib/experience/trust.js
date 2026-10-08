// src/host/experience/trust.ts
//
// 统计投影 → 中心化质量信号 → 展示用信任度（§14）。
//
// 为什么必须分成两个值而不是只存 trust：召回修正需要中心化信号（可正可负，中性为 0），
// 否则「证据不足」与「价值为正」在乘法修正里无法区分；而界面展示需要一个正区间的可信度，
// 0.5 表示「证据不足，保持中性」而不是「50% 概率正确」。两者语义不同，因此各自独立成函数。
import { STABILITY_SIGNAL_BASE, STABILITY_SIGNAL_SPAN, TRUST_AMPLITUDE, TRUST_CENTER } from "./constants.js";
/**
 * 中心化质量信号（§14）：`quality_signal = empirical_value × evidence_strength × (0.5 + 0.5 × stability)`。
 *
 * 语义：价值、证据与稳定性三者缺一不可——没有证据的价值（一次偶然高分）与正负剧烈冲突的价值
 * 都不会被当成可信信号。
 */
export function calculateQualitySignal(input) {
    return input.empiricalValue
        * input.evidenceStrength
        * (STABILITY_SIGNAL_BASE + STABILITY_SIGNAL_SPAN * input.stability);
}
/**
 * 展示用信任度（§14）：`trust = 0.5 + 0.45 × quality_signal`，落在 [0.05, 0.95]。
 *
 * 为什么夹取：0.5 是「证据不足」这一语义值，越界会把它挤成「确定正确/确定错误」；
 * 浮点舍入可能让极值略微越过边界，因此按声明取值域夹回。
 */
export function calculateTrust(qualitySignal) {
    const trust = TRUST_CENTER + TRUST_AMPLITUDE * qualitySignal;
    return Math.min(TRUST_CENTER + TRUST_AMPLITUDE, Math.max(TRUST_CENTER - TRUST_AMPLITUDE, trust));
}
//# sourceMappingURL=trust.js.map
/** 质量信号入参（全部来自统计投影，不重新聚合评价历史）。 */
export interface QualitySignalInput {
    empiricalValue: number;
    evidenceStrength: number;
    stability: number;
}
/**
 * 中心化质量信号（§14）：`quality_signal = empirical_value × evidence_strength × (0.5 + 0.5 × stability)`。
 *
 * 语义：价值、证据与稳定性三者缺一不可——没有证据的价值（一次偶然高分）与正负剧烈冲突的价值
 * 都不会被当成可信信号。
 */
export declare function calculateQualitySignal(input: QualitySignalInput): number;
/**
 * 展示用信任度（§14）：`trust = 0.5 + 0.45 × quality_signal`，落在 [0.05, 0.95]。
 *
 * 为什么夹取：0.5 是「证据不足」这一语义值，越界会把它挤成「确定正确/确定错误」；
 * 浮点舍入可能让极值略微越过边界，因此按声明取值域夹回。
 */
export declare function calculateTrust(qualitySignal: number): number;

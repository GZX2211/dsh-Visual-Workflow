import type { ExperienceDecisionEffectAnchor, ExperienceScoreAnchor } from "../shared/asset-types.js";
import type { EvaluationScoreField } from "./scoring.js";
/**
 * 评分维度。
 *
 * 为什么写成 `EvaluationScoreField` 的别名而不重写一遍联合：两者是同一个概念，
 * 重写一遍就多了一处可漂移的本体（只能靠运行期测试发现漂移，别名把漂移提前到编译期）。
 */
export type EvaluationDimension = EvaluationScoreField;
/** 单级锚点：取值 + 该取值在行为上的统一定义。 */
export interface AnchorDefinition {
    value: ExperienceScoreAnchor | ExperienceDecisionEffectAnchor;
    definition: string;
}
/** 单个维度的定义：模型侧参数名、所回答的问题与该维度的全部锚点。 */
export interface EvaluationDimensionDefinition {
    dimension: EvaluationDimension;
    /** 模型侧参数名（snake_case；与工具入参逐字一致）。 */
    parameter: string;
    /** 该维度回答的问题（§5 各小节的问题原义）。 */
    question: string;
    anchors: readonly AnchorDefinition[];
}
/**
 * 四维锚点定义（唯一本体）。
 *
 * 每一级都必须是一个可判定的行为描述，而不是「较低 / 中等 / 较高」这类相对措辞：
 * 相对措辞会让评分随评分者的心情漂移，行为描述才能让同一个情形得到同一个评分。
 */
export declare const EVALUATION_DIMENSION_DEFINITIONS: readonly EvaluationDimensionDefinition[];
/**
 * 渲染模型可见的锚点表（工具 description 的唯一来源）。
 *
 * 每级固定渲染为 `<值> = <行为定义>` 并由 `; ` 分隔：这是评分者按行为而非按数字打分的判据，
 * 因此格式本身也是契约（测试逐级断言它被完整注入）。
 */
export declare function renderAnchorGlossary(): string;

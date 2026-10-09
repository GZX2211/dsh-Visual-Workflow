// src/host/experience/anchor-definitions.ts
//
// 四维评分的五级语义锚点定义本体（§5）。
//
// 为什么锚点定义必须随代码发布、并进入运行期可见面：锚点的作用是让评分者按「行为」而不是按
// 「数字」打分（§4.1）。如果运行期只给出一份合法取值清单（0 / 0.25 / …），模型仍会在 0.75 与
// 1.0 之间凭感觉挑一个数字——锚点就退化成装饰，§36「所有评分维度拥有明确行为锚点」不成立。
// 因此本文件是锚点语义的唯一本体：工具 description 由 renderAnchorGlossary() 渲染，不另写一份。
//
// 语言口径：模型可见面（工具 description）用英文，与既有工具一致；本文件不重复维护中文释义，
// 校验层的中文错误消息只列出合法取值与维度名，不复制这里的定义文本。
import { DECISION_EFFECT_ANCHORS, SCORE_ANCHORS } from "./constants.js";
/**
 * 四维锚点定义（唯一本体）。
 *
 * 每一级都必须是一个可判定的行为描述，而不是「较低 / 中等 / 较高」这类相对措辞：
 * 相对措辞会让评分随评分者的心情漂移，行为描述才能让同一个情形得到同一个评分。
 */
export const EVALUATION_DIMENSION_DEFINITIONS = [
    {
        dimension: "fitScore",
        parameter: "fit",
        question: "Does this experience really apply to the current situation?",
        anchors: [
            { value: 0, definition: "Key conditions do not hold; basically not applicable" },
            { value: 0.25, definition: "Only locally related; key applicability conditions insufficient" },
            { value: 0.5, definition: "Partially applicable; usable only after clear adjustments" },
            { value: 0.75, definition: "Most key conditions hold; can be referenced directly" },
            { value: 1, definition: "Closely matches this decision situation; its judgement transfers directly" },
        ],
    },
    {
        dimension: "decisionEffect",
        parameter: "decision_effect",
        question: "Compared with not using it, how much did the decision or outcome actually change?",
        anchors: [
            { value: -1, definition: "Clearly pushed the decision the wrong way; major risk, rework or loss" },
            { value: -0.5, definition: "Clearly harmed the decision, without severe consequences" },
            { value: 0, definition: "No attributable substantive difference versus not using it" },
            { value: 0.5, definition: "Clearly helped: less risk, cost or rework, or a better result" },
            { value: 1, definition: "Decisive for a key outcome; without it the decision would very likely have been clearly worse" },
        ],
    },
    {
        dimension: "informationGain",
        parameter: "information_gain",
        question: "How much genuinely discriminating decision information did this experience provide here?",
        anchors: [
            { value: 0, definition: "Almost common sense or an empty truism; no extra decision information" },
            { value: 0.25, definition: "Very small supplementary information" },
            { value: 0.5, definition: "A useful but weak discriminating condition" },
            { value: 0.75, definition: "Clearly changed the decision boundary or the chosen action" },
            { value: 1, definition: "A key, non-obvious, strongly discriminating decision rule" },
        ],
    },
    {
        dimension: "causalConfidence",
        parameter: "causal_confidence",
        question: "How confident are you that the effect came from this experience, not from your own actions, external systems or chance?",
        anchors: [
            { value: 0, definition: "Cannot tell whether the experience caused it" },
            { value: 0.25, definition: "Only a very weak subjective guess" },
            { value: 0.5, definition: "Some evidence, but clear confounding factors" },
            { value: 0.75, definition: "Strong evidence that it actually influenced the decision" },
            { value: 1, definition: "Direct attribution or explicit counterfactual evidence" },
        ],
    },
];
/** 锚点取值域文本（与常量本体同源，不在渲染处再写一遍数字）。 */
function anchorDomainText(dimension) {
    const anchors = dimension === "decisionEffect" ? DECISION_EFFECT_ANCHORS : SCORE_ANCHORS;
    return anchors.join(" / ");
}
/**
 * 渲染模型可见的锚点表（工具 description 的唯一来源）。
 *
 * 每级固定渲染为 `<值> = <行为定义>` 并由 `; ` 分隔：这是评分者按行为而非按数字打分的判据，
 * 因此格式本身也是契约（测试逐级断言它被完整注入）。
 */
export function renderAnchorGlossary() {
    return EVALUATION_DIMENSION_DEFINITIONS.map((definition) => {
        const levels = definition.anchors.map((anchor) => `${anchor.value} = ${anchor.definition}`).join("; ");
        return `${definition.parameter} (${anchorDomainText(definition.dimension)}) — ${definition.question} ${levels}`;
    }).join("\n");
}
//# sourceMappingURL=anchor-definitions.js.map
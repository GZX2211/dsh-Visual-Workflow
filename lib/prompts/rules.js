// src/host/prompts/rules.ts
//
// 规则文本出口：图语义 / 设计方法（wf_org_catalog 索引返回的 rules 段）
// 与运行期【编排变更】通知。正文分别在 texts/ 下对应文件。
import { isEnglishSystemLanguage } from '../system-language.js';
import { ORCH_CHANGE_MARKER, ORCH_CHANGE_TEXT } from './texts/notice-orchestration-change.js';
import { ORCH_CHANGE_MARKER_EN, ORCH_CHANGE_TEXT_EN } from './texts/en/notice-orchestration-change.js';
import { RULE_DESIGN_METHOD } from './texts/rule-design-method.js';
import { RULE_GRAPH_SEMANTICS } from './texts/rule-graph-semantics.js';
export { ORCH_CHANGE_MARKER, ORCH_CHANGE_TEXT, ORCH_CHANGE_MARKER_EN, ORCH_CHANGE_TEXT_EN };
/** 运行期【编排变更】通知正文：按本次运行语言选择（无变量）。 */
export function orchestrationChangeTextOf(systemLanguage) {
    return isEnglishSystemLanguage(systemLanguage) ? ORCH_CHANGE_TEXT_EN : ORCH_CHANGE_TEXT;
}
/** L1 图语义段（wf_org_catalog 的 rules.graphSemantics）。 */
export const ORG_SOP_L1_GRAPH_SEMANTICS = RULE_GRAPH_SEMANTICS;
/** 设计方法段（wf_org_catalog 的 rules.designMethod）。 */
export const ORG_SOP_DESIGN_METHOD = RULE_DESIGN_METHOD;
//# sourceMappingURL=rules.js.map
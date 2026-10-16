import type { OrchestrationDirectiveParams } from './orchestration.js';
import type { NodeTaskBlockParams } from './node-task.js';
import type { ParentExecutorPromptParams, ParentTaskSpecParams } from './executor.js';
import type { CollabBlockParams } from './collab.js';
import type { OrchestrationChangeParams } from './orchestration-change.js';
import type { OrgBudget } from '../shared/types.js';
export declare const EN_PROMPT_MARKERS: {
    readonly head: "# Mandatory constraints";
    readonly mid: "## Workflow context";
    readonly tail: "# Dynamic state";
    readonly restate: "## Restated constraints";
};
export declare const EN_ORCH_CONSTRAINTS: {
    readonly dispatchOnly: "Orchestration only: schedule child agents; do not perform node tasks yourself";
    readonly executorRole: "Execution and orchestration: perform only your own node task, then schedule child agents";
    readonly nodeSettledSignal: "A node is complete only after its settlement notification (Background subagent … finished …) arrives";
    readonly finishIdempotent: "Call wf_finish once when finishing (idempotent; releases the run lock)";
    readonly failureSemantics: "Never silently skip a failed node";
    readonly conditionSemantics: "Evaluate conditional branches semantically using the actual upstream outputs";
};
export declare const EN_DEFAULT_OUTPUT_CONTRACT = "Conclusion / Output file paths / Key decisions / Open questions";
export declare const EN_EXECUTOR_FINISH_RULE = "After completing the node task, call wf_finish once to end this run (idempotent)";
/** Parent orchestration and hybrid variants share the same scheduling rules. */
export declare function buildEnglishOrchestration(params: OrchestrationDirectiveParams, hybrid?: boolean): string;
/** Child instructions preserve all user-supplied input and output contracts. */
export declare function buildEnglishNodeTask({ facts: f }: NodeTaskBlockParams): string;
export declare function buildEnglishParentTask({ facts, runContextText }: ParentTaskSpecParams): string;
export declare function buildEnglishExecutor(p: ParentExecutorPromptParams): string;
export declare function buildEnglishCollab(p: CollabBlockParams): string;
export declare function buildEnglishBudget(b: OrgBudget): string;
export declare function buildEnglishChange(p: OrchestrationChangeParams): string;
/** Planning uses the same language while retaining the graph-editing contracts. */
export declare function buildEnglishPlan({ facts: f, dynamic: d }: import('./org-plan.js').OrgPlanPromptParams): string;

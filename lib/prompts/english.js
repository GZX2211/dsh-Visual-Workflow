// src/host/prompts/english.ts
//
// English counterparts of the generated workflow instructions. User-authored content
// is interpolated verbatim; only plugin-owned instructions and headings are translated.
import { languageRuleLine } from './prompt-rules.js';
export const EN_PROMPT_MARKERS = {
    head: '# Mandatory constraints', mid: '## Workflow context',
    tail: '# Dynamic state', restate: '## Restated constraints',
};
export const EN_ORCH_CONSTRAINTS = {
    dispatchOnly: 'Orchestration only: schedule child agents; do not perform node tasks yourself',
    executorRole: 'Execution and orchestration: perform only your own node task, then schedule child agents',
    nodeSettledSignal: 'A node is complete only after its settlement notification (Background subagent … finished …) arrives',
    finishIdempotent: 'Call wf_finish once when finishing (idempotent; releases the run lock)',
    failureSemantics: 'Never silently skip a failed node',
    conditionSemantics: 'Evaluate conditional branches semantically using the actual upstream outputs',
};
export const EN_DEFAULT_OUTPUT_CONTRACT = 'Conclusion / Output file paths / Key decisions / Open questions';
export const EN_EXECUTOR_FINISH_RULE = 'After completing the node task, call wf_finish once to end this run (idempotent)';
const EN_COLLAB_ASK = 'Use wf_ask_agent (ask / reply) for all collaboration messages within the group';
const EN_COLLAB_SEND = 'Use send_message for all messages to teammates and the Lead (target is the member name; use "lead" for the Lead)';
/** Parent orchestration and hybrid variants share the same scheduling rules. */
export function buildEnglishOrchestration(params, hybrid = false) {
    const { facts: f, dynamic: d } = params;
    const c = EN_ORCH_CONSTRAINTS;
    const m = EN_PROMPT_MARKERS;
    const language = languageRuleLine(f.systemLanguage);
    const parent = hybrid && f.parentNode ? ` Also execute your own node "${f.parentNode.nodeLabel}" (id=${f.parentNode.nodeId}).` : '';
    const head = [m.head, '', `You are the parent orchestrator of workflow "${f.workflowName}".${parent}`, '',
        `1. ${hybrid ? c.executorRole : c.dispatchOnly}.`,
        `2. ${c.nodeSettledSignal}; do not advance downstream or finish before it arrives.`,
        `3. ${c.finishIdempotent}.`,
        `4. ${c.failureSemantics}; retry once, then ask the user if it still fails. Terminate the run if orchestration is out of control or cannot continue.`,
        `5. ${c.conditionSemantics}.`, ...(language ? [`6. ${language}`] : []),
    ];
    const mid = [m.mid, '', `Workflow source of truth: ${f.definitionPath} (read-only JSON containing nodes and edge semantics). Read it before the first dispatch. Read it again only after an [Orchestration changed] notification or after you modify the graph with wf_graph_patch; do not reread it every turn.`];
    if (f.workflowGoal.trim())
        mid.push('', `Workflow goal: ${f.workflowGoal.trim()}`);
    if (f.collabGroups.length) {
        const official = f.collabChannel === 'official';
        mid.push('', official ? 'Collaboration groups (official teams):' : 'Collaboration groups (parallel members):');
        for (const g of f.collabGroups)
            mid.push(official
                ? `- ${g.groupId} (${g.label}): call wf_run_node("${g.groupId}") to start the group; the plugin creates official teammates for member node IDs [${g.memberIds.join(', ')}]`
                : `- ${g.groupId} (${g.label}): start members [${g.memberIds.join(', ')}] in parallel`);
        if (official)
            mid.push('', 'The plugin creates members from the canvas configuration; do not call spawn_teammate to create members yourself.');
    }
    const tail = [m.tail, '', m.restate, `- ${c.finishIdempotent}.`, `- ${c.failureSemantics}.`,
        ...(language ? [`- ${language}`] : []), '', 'Current run state:'];
    if (d.isResume)
        tail.push(`- Resuming a previous run (resumedFromRunId: ${d.resumedFromRunId ?? '(unknown)'}).`, `- Do not rerun nodes already marked ok; continue from node ${d.resumeFromNodeId ?? '(unspecified)'} using checkpoint outputs as ctx.`);
    else
        tail.push('- New run; no checkpoint to restore.');
    tail.push(d.pauseNodeIds?.length
        ? `- Pause nodes: [${d.pauseNodeIds.join(', ')}]. Pause and persist a checkpoint; later resume from their flow-out.`
        : '- This workflow has no pause nodes.');
    tail.push(`- Run parameters: ${d.runParamsText?.trim() || '(none)'}`);
    if (d.question)
        tail.push(`- User question (service mode): ${d.question}`);
    if (d.orgBudgetText)
        tail.push('', d.orgBudgetText);
    if (d.parentTaskBlock)
        tail.push('', '[Your node task] (perform this yourself; do not delegate):', d.parentTaskBlock);
    return `${head.join('\n')}\n\n${mid.join('\n')}\n\n${tail.join('\n')}\n`;
}
function englishContext(f) {
    const parts = f.upstreamContext.length ? ['Upstream outputs:', ...f.upstreamContext.map(e => `- ${e.source}: ${e.content}`)] : ['Upstream outputs: (none)'];
    if (f.filePaths.length)
        parts.push('', 'File paths (read them yourself):', ...f.filePaths.map(p => `- ${p}`));
    if (f.dbToolHint.trim())
        parts.push('', `Database tool instructions: ${f.dbToolHint.trim()}`);
    return parts;
}
/** Child instructions preserve all user-supplied input and output contracts. */
export function buildEnglishNodeTask({ facts: f }) {
    const m = EN_PROMPT_MARKERS;
    const language = languageRuleLine(f.systemLanguage);
    const collab = f.collabChannel === 'official' ? EN_COLLAB_SEND : EN_COLLAB_ASK;
    const head = [m.head, '', `You are executing node "${f.nodeLabel}".`, '',
        ...(language ? [`1. ${language}`] : []), ...(f.isGroupMember ? [`${language ? 2 : 1}. ${collab}.`] : [])];
    const mid = [m.mid, '', '', ...englishContext(f)];
    if (f.inputContract.trim())
        mid.push('', 'Input structure (the input you should receive):', f.inputContract.trim());
    const restate = f.isGroupMember ? [`- ${collab}.`] : [];
    if (f.outputContract.trim())
        restate.push(f.outputContractDefaulted
            ? `- Downstream nodes read your final reply directly. Use this default handoff format: ${EN_DEFAULT_OUTPUT_CONTRACT}.`
            : `- Downstream nodes read your final reply directly. It must include: ${f.outputContract.trim()}.`);
    const tail = [m.tail, '', ...(restate.length ? [m.restate, ...restate] : [])];
    return `${head.join('\n')}\n\n${mid.join('\n')}\n\n${tail.join('\n')}\n`;
}
export function buildEnglishParentTask({ facts, runContextText }) {
    return [`Perform node "${facts.nodeLabel}" strictly according to its specification.`, ...englishContext(facts),
        ...(runContextText?.trim() ? ['', `Run context: ${runContextText.trim()}`] : [])].join('\n');
}
export function buildEnglishExecutor(p) {
    const m = EN_PROMPT_MARKERS;
    const language = languageRuleLine(p.systemLanguage);
    const head = [m.head, '', `You are execution node "${p.facts.nodeLabel}" of workflow "${p.workflowName}".`, '',
        `1. ${EN_EXECUTOR_FINISH_RULE}.`, '2. Perform this node strictly according to its specification.',
        ...(p.facts.isGroupMember ? [`3. ${EN_COLLAB_ASK}; do not simulate conversations in ordinary text or bypass the tool.`] : []),
        ...(language ? [`${p.facts.isGroupMember ? 4 : 3}. ${language}`] : [])];
    const tail = [m.tail, '', m.restate, `- ${EN_EXECUTOR_FINISH_RULE}.`,
        ...(p.facts.isGroupMember ? [`- ${EN_COLLAB_ASK}.`] : []), ...(language ? [`- ${language}`] : []),
        '', 'Current execution state:', `- Run context: ${p.runContextText.trim() || '(none)'}`];
    return `${head.join('\n')}\n\n${[m.mid, '', ...englishContext(p.facts)].join('\n')}\n\n${tail.join('\n')}\n`;
}
export function buildEnglishCollab(p) {
    const official = p.channel === 'official';
    const members = Array.isArray(p.members) ? p.members : [];
    const lines = ['You are a member of a collaboration group. Group members:',
        ...(members.length ? members.map(m => `- ${m.label?.trim() || m.id} (${official && m.target?.trim() ? `member name: ${m.target.trim()}` : `id: ${m.id}`})`) : ['- (no other members)']),
        official ? 'Use send_message to communicate with members, setting target to the member name; use target="lead" for Lead decisions or summaries.'
            : 'Use wf_ask_agent to communicate with members, setting targetChildId to the recipient member ID.'];
    if (p.custom.trim())
        lines.push('', 'Group instructions:', p.custom.trim());
    return lines.join('\n');
}
export function buildEnglishBudget(b) {
    const remaining = (n) => n === null ? 'unlimited' : String(n);
    const lines = ['Current organization budget:',
        `- Executable nodes ${b.nodeUsed}/${b.nodeMax || 'unlimited'} (remaining ${remaining(b.nodeRemaining)})`,
        b.groupMax > 0 ? `- Collaboration groups ${b.groupUsed}/${b.groupMax} (remaining ${remaining(b.groupRemaining)}); members per group: ${b.membersMax || 'unlimited'}`
            : `- Collaboration groups ${b.groupUsed}/unlimited; members per group: ${b.membersMax || 'unlimited'}`,
        `- Parent gates ${b.milestoneUsed}/${b.milestoneMax || 'unlimited'} (remaining ${remaining(b.milestoneRemaining)})`,
        `- Graph patch limit per round ${b.patchOpsMax || 'unlimited'} op (remaining ${remaining(b.patchOpsRemaining)})`];
    if (b.parallelBranchMax > 0)
        lines.push(`- Parallel branch limit per column ${b.parallelBranchMax}`);
    lines.push(`- Forbidden topologies: ${b.forbiddenShapes.join(' / ') || 'none'}`);
    if (b.namingConvention)
        lines.push(`- Naming convention: ${b.namingConvention}`);
    return lines.join('\n');
}
export function buildEnglishChange(p) {
    return [`[Orchestration changed] The user saved the running workflow "${p.workflowName}"; its orchestration definition has changed.`, '',
        'This is a runtime system notification, not a new user instruction or task. Do not repeat reports or restart completed steps.', '',
        `Latest source of truth: ${p.definitionPath}`, 'Read this file again for the latest nodes and edge semantics, then adjust subsequent scheduling:',
        '- Use the latest topology and configuration for pending work.', '- Do not rerun or reschedule completed nodes.',
        '- Skip a pending branch if the latest topology removed it.', ...(p.systemLanguage?.trim() ? ['', languageRuleLine(p.systemLanguage)] : [])].join('\n');
}
/** Planning uses the same language while retaining the graph-editing contracts. */
export function buildEnglishPlan({ facts: f, dynamic: d }) {
    const m = EN_PROMPT_MARKERS;
    const grammar = f.target === 'create'
        ? "Create a template with scope='template' and create={name, description?, mode?}; the returned targetId is the new template ID"
        : "Use scope='template' to edit a template or scope='instance' to edit an instance; include targetId and expectRevision";
    const rule = 'Plan templates only: do not create instances or start runs at this stage; the user decides whether to deploy';
    const language = languageRuleLine(f.systemLanguage ?? '');
    const target = f.targetName?.trim() || f.targetId?.trim() || 'new workflow template';
    const head = [m.head, '', `You are the organization planner for ${f.target} "${target}"${f.targetId ? ` (id=${f.targetId})` : ''}.`, '',
        `1. ${grammar}.`, `2. ${rule}.`,
        '3. Call wf_org_catalog without ids first to retrieve orchestration rules and reusable assets; inspect workspace files, technology and conventions before submitting a graph patch.',
        '4. wf_org_catalog and wf_graph_patch are enabled by default. If either is unavailable, ask the user to enable it in tool combination management and retry; do not edit the graph through another route.',
        ...(language ? [`5. ${language}`] : [])];
    const mid = [m.mid, '', f.target === 'instance'
            ? 'Updates to the target instance immediately refresh its runtime source of truth and canvas.'
            : 'Save the plan as a template snapshot; the user decides when to create and run an instance.', '',
        'wf_org_catalog supplies graph semantics, design methods and graph-editing contracts. Call it without ids to retrieve the full rules and asset index before editing.'];
    const tail = [m.tail, '', m.restate, `- ${grammar}.`, `- ${rule}.`, ...(language ? [`- ${language}`] : []), '',
        'Before submitting, confirm every item:', '- Each deliverable has a node, without duplicate responsibilities.',
        '- Each deliverable specifies its file path and consumer; terminal outputs without consumers do not need ctx edges.',
        '- Every downstream node knows where to read its upstream outputs, through ctx edges or documented file paths.',
        '- Every agent node has a systemPrompt and a non-empty presetId (tool combination).', '', 'Current planning task:',
        `- User intent: ${d.userIntent.trim() || '(not provided; ask the user to clarify the goal first)'}`];
    if (d.userSop?.trim())
        tail.push('', '[User SOP] (user-editable instructions; highest priority):', d.userSop.trim());
    if (d.orgBudgetText?.trim())
        tail.push('', d.orgBudgetText.trim());
    return `${head.join('\n')}\n\n${mid.join('\n')}\n\n${tail.join('\n')}\n`;
}
//# sourceMappingURL=english.js.map
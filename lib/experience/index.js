// src/host/experience/index.ts
//
// Experience 域公共入口：宿主装配、工具层与 API 边界只从这里取类型与实现，不触达内部文件。
export { CAUSAL_WEIGHT_FLOOR, CAUSAL_WEIGHT_SPAN, CANDIDATE_POOL_SIZE, DECISION_EFFECT_ANCHORS, DEFAULT_RECALL_TOP_K, DUPLICATE_SIMILARITY_THRESHOLD, EFFECT_INFO_BASE, EFFECT_INFO_SPAN, EVALUATION_EVIDENCE_LIMIT, EVIDENCE_STRENGTH_SCALE, EXPERIENCE_TYPES, FIELD_LIMITS, MAX_CANDIDATES_PER_CALL, MAX_EVALUATIONS_PER_CALL, MAX_INITIALIZED_SESSIONS, MAX_RECALL_TOP_K, MMR_DIVERSITY_WEIGHT, MMR_RELEVANCE_WEIGHT, NEUTRAL_STATS, PRIOR_STRENGTH, SCORE_ANCHORS, SCORE_ANCHOR_TOLERANCE, SEMANTIC_FLOOR, STABILITY_SIGNAL_BASE, STABILITY_SIGNAL_SPAN, TRUST_ADJUSTMENT_BETA, TRUST_AMPLITUDE, TRUST_CENTER, isDecisionEffectAnchor, isExperienceType, isScoreAnchor, normalizeWhitespace, } from "./constants.js";
export { validateExperienceCandidates, validateExperiencePatch } from "./validation.js";
export { PROJECTION_EMPTY_VALUE, PROJECTION_LIST_SEPARATOR, buildDecisionRetrievalText, buildRecallSummary, buildRetrievalProjection, buildTaskRetrievalText, } from "./projection.js";
export { decodeEmbedding, encodeEmbedding } from "./embedding-codec.js";
export { bm25Scores, normalizeTopK, rankByBm25, rankByEmbedding, recallActiveHits, tokenizeForLexical, } from "./retrieval.js";
export { allowedExperienceTypes, resolveExperienceSubject } from "./subject.js";
export { EVALUATION_DIMENSION_DEFINITIONS, renderAnchorGlossary } from "./anchor-definitions.js";
export { EVALUATION_SCORE_FIELDS, calculateEffectiveEffect, calculateEvaluationWeight, validateEvaluationScores, } from "./scoring.js";
export { aggregateExperienceStats, buildEvaluationSamples, calculateEffectiveSampleCount, calculateEmpiricalValue, calculateEvidenceStrength, calculateFitMean, calculateHarmCount, calculateHarmRate, calculateHarmSeverity, calculateStability, calculateVariance, } from "./statistics.js";
export { calculateQualitySignal, calculateTrust } from "./trust.js";
export { boundedTrustRerank, calculateRecallAdjustment, normalizeSimilarity, pairSimilarity, rankRecallCandidates, selectByMmr, } from "./retrieval-ranking.js";
export { FEEDBACK_ADMISSION_REJECTED_REASON, submitExperienceFeedback } from "./feedback.js";
export { rebuildExperienceStats } from "./rebuild.js";
export { ExperienceExecutionState } from "./execution-state.js";
export { TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST, TEAM_EXPERIENCE_CONTEXT_HEADING, TEAM_EXPERIENCE_CONTEXT_INTRO, TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER, TEAM_EXPERIENCE_CONTEXT_LIST_SEPARATOR, renderTeamExperienceContext, } from "./team-context.js";
export { ExperienceService } from "./service.js";
//# sourceMappingURL=index.js.map
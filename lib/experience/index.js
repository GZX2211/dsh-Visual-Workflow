// src/host/experience/index.ts
//
// Experience 域公共入口：宿主装配、工具层与 API 边界只从这里取类型与实现，不触达内部文件。
export { DEFAULT_RECALL_TOP_K, DUPLICATE_SIMILARITY_THRESHOLD, EXPERIENCE_TYPES, FIELD_LIMITS, MAX_CANDIDATES_PER_CALL, MAX_INITIALIZED_SESSIONS, MAX_RECALL_TOP_K, isExperienceType, normalizeWhitespace, } from "./constants.js";
export { validateExperienceCandidates, validateExperiencePatch } from "./validation.js";
export { PROJECTION_EMPTY_VALUE, PROJECTION_LIST_SEPARATOR, buildDecisionRetrievalText, buildRecallSummary, buildRetrievalProjection, buildTaskRetrievalText, } from "./projection.js";
export { decodeEmbedding, encodeEmbedding } from "./embedding-codec.js";
export { bm25Scores, normalizeTopK, rankByBm25, rankByEmbedding, recallActiveHits, tokenizeForLexical, } from "./retrieval.js";
export { allowedExperienceTypes, resolveExperienceSubject } from "./subject.js";
export { ExperienceExecutionState } from "./execution-state.js";
export { TEAM_EXPERIENCE_CONTEXT_EMPTY_LIST, TEAM_EXPERIENCE_CONTEXT_HEADING, TEAM_EXPERIENCE_CONTEXT_INTRO, TEAM_EXPERIENCE_CONTEXT_ITEM_MARKER, TEAM_EXPERIENCE_CONTEXT_LIST_SEPARATOR, renderTeamExperienceContext, } from "./team-context.js";
export { ExperienceService } from "./service.js";
//# sourceMappingURL=index.js.map
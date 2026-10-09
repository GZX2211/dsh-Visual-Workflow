import { type RenderTextBlock } from '../infrastructure/text-render.js';
import type { ExperienceEntry, ExperienceRecallHit } from '../../shared/asset-types.js';
import type { RecallCandidatesResult, RecallDetailsResult } from './types.js';
/**
 * 候选阶段装配：只投影契约字段（检索层的内部文本不进入模型上下文），
 * 顺序、得分、摘要与通道标记一律原样透传。
 */
export declare function candidateResultOf(hits: ExperienceRecallHit[], source: 'semantic' | 'bm25'): RecallCandidatesResult;
/** 详情阶段装配：经验本体就是完整条目，不截断、不重排、不补默认值。 */
export declare function detailsResultOf(entries: ExperienceEntry[]): RecallDetailsResult;
/**
 * 输出渲染入口：序列化只有一处实现（基础设施的稳定文本序列化，键序稳定以保前缀缓存），
 * 此处把它留在装配层，使 tool.ts 只承担注册与适配。
 */
export declare function renderRecallResult(args: Record<string, unknown>, value: unknown): RenderTextBlock[];

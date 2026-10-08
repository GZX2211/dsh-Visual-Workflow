import type { ExperienceEntry, ExperienceGenerationPromptEntry, ExperienceRecallHit, ExperienceType } from '../../shared/asset-types.js';
/**
 * 工具层所需经验能力缝（宿主组合根装配真实实现；单测 fake）。
 *
 * 为什么传入调用方身份而不是会话 id：经验属于「主体」，主体解析需要区分子代理与父代理、
 * 并用子代理会话 id 定位其所属运行——这些事实只有调用方现场知道，由工具层随调用传入。
 * 为什么 candidates 是 unknown：候选形状与长度约束的校验归 domain（工具层只把模型侧的
 * snake_case 字段映射成草稿形状），这样未知字段才能被 domain 拒绝而不是在工具层被吞掉。
 */
export interface WfExperienceHost {
    experience: {
        initializePrompt(input: {
            caller: {
                isChild: boolean;
                sessionId: string;
                childId?: string;
            };
            type: ExperienceType;
        }): Promise<{
            prompt: ExperienceGenerationPromptEntry;
        }>;
        submit(input: {
            caller: {
                isChild: boolean;
                sessionId: string;
                childId?: string;
            };
            type: ExperienceType;
            candidates: unknown;
        }): Promise<{
            inserted: ExperienceEntry[];
            skipped: Array<{
                reason: string;
                decisionRetrievalText: string;
            }>;
        }>;
        recall(input: {
            caller: {
                isChild: boolean;
                sessionId: string;
                childId?: string;
            };
            type: ExperienceType;
            query?: string;
            ids?: string[];
            topK?: number;
        }): Promise<{
            kind: 'candidates';
            hits: ExperienceRecallHit[];
            source: 'semantic' | 'bm25';
        } | {
            kind: 'details';
            entries: ExperienceEntry[];
        }>;
    };
}
/** 解析并收窄模型侧 type 参数；未知取值抛 WF_EXPERIENCE_BAD_ARGS（消息给出合法取值）。 */
export declare function parseExperienceType(raw: unknown): ExperienceType;
/**
 * 主体类型归属校验。
 *
 * 为什么只有「子代理只能是 agent」这一条在工具层：调用方是不是子代理是工具层独有的事实
 * （来自官方会话 header），而父代理是否正在承担编排/Team 职责需要运行事实，由 domain 的
 * 主体解析裁决——工具层不复制那部分判断，避免同一规则两处维护后不一致。
 */
export declare function assertExperienceTypeOwnership(caller: {
    isChild: boolean;
    sessionId: string;
    childId?: string;
}, type: ExperienceType): void;

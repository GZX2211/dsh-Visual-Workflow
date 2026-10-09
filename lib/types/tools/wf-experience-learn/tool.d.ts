import { type WfExperienceHost } from '../infrastructure/experience-contract.js';
/**
 * 注册 wf_experience_learn（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfExperienceLearn(ctx: {
    get(name: string): unknown;
}, host: WfExperienceHost): () => void;

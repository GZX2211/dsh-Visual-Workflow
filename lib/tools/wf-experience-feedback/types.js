// src/host/tools/wf-experience-feedback/types.ts
//
// wf_experience_feedback 的模型可见返回体。
//
// 为什么只暴露评分而不暴露写入行：评价行的 id / runId / createdAt 与评分者身份（evaluator_*）
// 是系统 provenance，模型既不能控制也不能据此行动；把它们回显进上下文只会让模型误以为
// 「评价可以被编辑或引用」，而评价是不可变历史（§7：不允许 update / delete）。
export {};
//# sourceMappingURL=types.js.map
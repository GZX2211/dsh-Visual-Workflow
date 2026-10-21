import type { WorkflowTemplate } from '../shared/graph-model.js';
/** 预设「流程设计指南」模板 id（固定；中英种子共用，播种标记与「已存在」判定都依赖它稳定）。 */
export declare const BUILTIN_FLOW_DESIGN_GUIDE_ID = "tpl-mvciz28k-jvzw9u";
/**
 * 随包内置模板种子（只读）：中文版（默认）与英文版。
 * 写入存储前必须深拷贝：存储层会添加 revision/时间戳，不能让共享种子对象被改写。
 */
export declare const BUILTIN_FLOW_TEMPLATES_ZH: readonly WorkflowTemplate[];
export declare const BUILTIN_FLOW_TEMPLATES_EN: readonly WorkflowTemplate[];
/**
 * 按界面语言选择种子：只有英文界面注入英文版，其余（未知/缺失）回退中文。
 * 与 DEFAULT_SYSTEM_LANGUAGE 同口径；语言只在首次播种时消费一次。
 */
export declare function builtinFlowTemplatesFor(systemLanguage: string): readonly WorkflowTemplate[];
/**
 * 播种所需的最小存储能力：只取四个方法，既避免安装器依赖 FlowStore 的其余面，
 * 也让测试可以注入替身验证失败路径。
 */
export interface BuiltinFlowTemplateStore {
    getFlowTemplate(templateId: string): Promise<WorkflowTemplate | null>;
    saveFlowTemplate(template: WorkflowTemplate): Promise<WorkflowTemplate>;
    listAppliedBuiltinSeeds(): Promise<string[]>;
    addAppliedBuiltinSeeds(ids: readonly string[]): Promise<void>;
}
/**
 * 播种内置工作流模板（幂等），返回本次新登记的种子 id。
 *
 * 判定顺序：
 *   1. 标记已含该 id → 跳过（用户此后删除/修改都不会被撤销）；
 *   2. 存储中已有同 id 模板（用户自建、手动导入或历史版本）→ 不覆盖，只补记标记；
 *   3. 都没有 → 按界面语言写入一份对应语言的种子深拷贝。
 *
 * 读取标记失败（损坏/权限）时直接上浮：把「读不到」当成「从未播种」会让已删除的
 * 预设模板复活。调用方（宿主）负责告警并跳过本次播种。
 *
 * @param systemLanguage 界面语言名（如 '中文' / 'English'）；缺省与未知值回退中文。
 */
export declare function installBuiltinFlowTemplates(store: BuiltinFlowTemplateStore, systemLanguage?: string): Promise<string[]>;

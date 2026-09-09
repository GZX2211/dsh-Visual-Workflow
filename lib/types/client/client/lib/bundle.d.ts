/** bundle 格式标识（与后端 transfer.ts 逐字一致）。 */
export declare const BUNDLE_FORMAT = "dsh-vw-bundle";
/** 角色模板导出标识。 */
export declare const TEMPLATE_FORMAT = "dsh-vw-template";
/** bundle 版本。 */
export declare const BUNDLE_VERSION = 2;
/** 判定 JSON 文本是否为工作流/服务 bundle（v2）。 */
export declare function isWorkflowBundle(json: string): boolean;
/** 判定 JSON 文本是否为角色模板导出。 */
export declare function isRoleTemplateBundle(json: string): boolean;
/** 深拷贝（导入数据消毒：剥离意外引用型字段）。 */
export declare function safeClone<T>(value: T): T;

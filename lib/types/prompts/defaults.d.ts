/** 默认输出契约：中文规范值 / 英文展示值。 */
export declare function defaultOutputContractOf(systemLanguage: string | undefined): string;
/**
 * 本地化输出契约文本：与中文规范默认值逐字相等时替换为对应语言默认值；
 * 自定义契约（含用户手写的中文）原样返回。
 */
export declare function localizeOutputContract(text: string, systemLanguage: string | undefined): string;

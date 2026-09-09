/** 读取文件为 UTF-8 文本。 */
export declare function readFileAsText(file: File): Promise<string>;
/** 读取文件为 Base64（DataURL 剥前缀）。 */
export declare function readFileAsBase64(file: File): Promise<string>;
/** 浏览器下载（Blob + 临时 a 标签）。 */
export declare function download(content: string, fileName: string, mediaType?: string): void;
/** localStorage 数值读取（非法回退）。 */
export declare function storedNumber(key: string, fallback: number): number;
/** localStorage 布尔读取（"1" 为真，缺失回退）。 */
export declare function storedBoolean(key: string, fallback: boolean): boolean;
/** localStorage 写入（尽力而为）。 */
export declare function keepLayout(key: string, value: string | number): void;
/** 文本截断（超出加省略号；空值回退 —）。 */
export declare function truncateText(value: unknown, limit: number): string;

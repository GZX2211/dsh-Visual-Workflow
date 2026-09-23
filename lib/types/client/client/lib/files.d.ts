/** 读取文件为 UTF-8 文本。 */
export declare function readFileAsText(file: File): Promise<string>;
/** 读取文件为 Base64（DataURL 剥前缀）。 */
export declare function readFileAsBase64(file: File): Promise<string>;
/** 浏览器下载（Blob + 临时 a 标签）。 */
export declare function download(content: string, fileName: string, mediaType?: string): void;

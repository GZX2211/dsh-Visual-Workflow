/** 文件路径解析器（宿主接入后向业务层暴露的最小接口）。 */
export type FilePathResolver = (file: File) => string;
/** 官方桌面桥给出的绝对路径；桥缺失/漂移/调用失败返回 null（由调用方降级）。 */
export declare function hostFilePathOf(file: File): string | null;
/** 旧 Electron 的 File.path 回退；最后回退文件名（浏览器下只能拿到文件名）。 */
export declare function legacyFilePathOf(file: File): string;
/**
 * 构造文件路径解析器：桌面端官方桥优先，其次旧 File.path，最后文件名。
 * 每次调用实时读取全局桥（官方 preload 可能晚于插件激活）。
 */
export declare function createFilePathResolver(): FilePathResolver;

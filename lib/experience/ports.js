// src/host/experience/ports.ts
//
// Experience 域对外依赖的最小缝与调用方身份本体。
//
// 为什么域层不直接使用资产库与编排器：经验域需要的是「读写经验行的语义」与「当前运行事实」，
// 而不是某个实现。宿主在组合根把资产库与编排器适配为这里的端口，域层因此可在单测中以
// 受控 fake 运行，也不会出现「域层摸编排器内部 Map」这类反向依赖。
//
// 行形状与判重判据一律复用共享契约（../shared/asset-types.js），本文件不重新定义一份。
export {};
//# sourceMappingURL=ports.js.map
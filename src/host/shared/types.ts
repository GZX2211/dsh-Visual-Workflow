// Host + Client 共享契约（纯类型，零运行时 import）。
//
// 说明：本文件为 P01 占位骨架；T-014 将在此填充共享契约纯类型——Graph/Run/
// Service 结构与 GUI API 端点契约、工具名常量与可见性元数据（工具名常量属
// 纯类型/值常量而非运行时逻辑，须保持双 tsconfig 均通过且 client 侧零运行时
// import）。此目录被 tsconfig.host.json 与 tsconfig.client.json 共同 include，
// 是两 program 的共享层（架构文档 §2.3 / §3 的 src/host/shared/）。
export {}

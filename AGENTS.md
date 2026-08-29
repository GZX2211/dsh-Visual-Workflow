# AGENTS.md

## 项目概述

dsh-visual-workflow 是 DeepSeek Harness（dsh）生态的 **host + client 双面可视化多 Agent 工作流设计器插件**

- **需求文档**：`docs/需求文档.md`
- **架构文档**：`docs/架构文档.md`
- 审查时**必须逐条对照上述两份文档**，任何偏离均视为 BUG。

### 文档索引（用 read(offset, limit) 按任务需求读取片段，不要读取整个文件）

**架构文档**：

- 1. 架构总览 - 起始行号：L10
- 2. 插件契约 - 起始行号：L27 
   定义包名、入口、exports、挂载配置与 peer 依赖等 
- 3. 目录结构（本项目） - 起始行号：L96  **不要读**
- 4. Host 半区模块设计 - 起始行号：L100
- 5. 关键协议与时序 - 起始行号：L277 
   运行启动、暂停与断点续跑、wf_ask_agent通信、协作组并行、模式二请求流 
- 6. 数据与模型资产 - 起始行号：L337
   run 快照、服务状态、模板、导入导出 v2 bundle、本地嵌入模型与向量索引   
- 7. 模式二 serve 层（serve.patch.yml 模板） - 起始行号：L421  
- 8. 官方源码引用索引（核心功能 -> 官方源码位置） - 起始行号：L443  
- 9. 安全、权限与边界 - 起始行号：L474
   API 暴露面、多租户隔离、数据库只读、文件路径注入、命令参数消毒及插件卸载清理
- 10. Client 半区设计（由旧项目迁移；P11 起入口改版） - 起始行号：L485  
- 11. 测试与验证矩阵 - 起始行号：L498  **必读**
- 12. 风险与实现时验证项 - 起始行号：L510 
- 13. 编码与提示词工程规范（横切，所有任务必须遵守） - 起始行号：L522  **必读**

**需求文档**：

- 1. 产品背景  - 起始行号：L9  
- 2. 术语与缩写定义  - L27  **必读**
- 3. 核心流程  - L55  
  - 3.1 模式一：编排执行模式  - L57  
    流程：拖拽配置→运行→暂停/续跑，断点续跑与双向同步  
  - 3.2 模式二：后台服务模式  - L76  
    服务启动、API请求、多用户隔离及流式响应
- 4. 功能需求  - L96  
  - 4.1 双模式架构模块  - L98  
  - 4.2 节点管理模块  - L189  
  - 4.3 连线管理模块  - L469  
  - 4.4 工具扩展模块  - L512  
  - 4.5 UI 交互模块  - L581 
  - 4.6 组合管理模块  - L641  
  - 4.7 运行历史与断点恢复  - L661  
- 5. 非功能需求  - L686  
- 6. 开放问题清单  - L718  
- 8. 设计约束  - L739  **必读**
- 9. 复用与差异清单（旧项目 → 新项目）  - L753 ~ 803

## 开发环境

| 工具 | 版本 | 备注 |
|------|------|------|
| node | v24.17.0 | |
| pnpm | 11.22.0 | 包管理器（不要用 npm/yarn） |
| git | 2.53.0.windows.2 | 仓库主分支 main |
| dsh CLI | 0.1.1-rc.2 | 全局安装 `@deepseek-ai/dsh@0.1.1-rc.2`；Windows 路径 `C:\Users\GZX\AppData\Roaming\npm\dsh.ps1` |

### 版本镜像约定

与官方仓库 devDependencies 对齐：

| 包 | 版本 | 用途 |
|----|------|------|
| typescript | ^6.0.3 | 双 program 编译（官方同款） |
| tsdown | ^0.22.2 | client bundle 构建（复用官方 tsdown.client.ts 模式） |
| vitest | ^4.1.8 | host/client 单测 |
| jsdom | 29.1.1 | client 单测环境 |
| @huggingface/transformers | 架构文档指定 | 唯一第三方**运行时**依赖（本地嵌入推理） |

- react / react-dom 仅为 **devDependencies**：client bundle 由官方平台模块表提供，构建期从 `lib/` 找回资源。

## 构建与测试命令

```bash
pnpm typecheck      # tsc 双 program 类型检查（host + client + test）
pnpm build          # node scripts/build.mjs（tsc 发射 JS + tsdown 构建 client bundle）
pnpm test           # vitest run --pool=threads
pnpm client-smoke   # node scripts/client-smoke.mjs
pnpm check          # typecheck + test + build + client-smoke（推荐合并命令）
pnpm verify         # typecheck + build + test + client-smoke
```

- 构建产物在 `lib/`；`lib/types/` 存放声明文件。

## 目录结构与双 program

- `src/host/shared/` **禁止任何 import，禁止运行时值**（函数/常量一律不放）。client 经 `import type` 零风险引用。
- 双 program 完全隔离：`tsconfig.host.json`（nodenext + node types）与 `tsconfig.client.json`（bundler + dom types）互不 include。

## 硬性架构约束（违反即 BUG）

1. **零官方包运行时依赖**：`@deepseek-ai/*` 仅经 `ctx.get()` 运行时解析，工具以纯对象 `defineTool` 定义注册。唯一允许的第三方运行时依赖是 `@huggingface/transformers`（本地嵌入推理）。`@deepseek-ai/schemastery` 仅 devDependency。
2. **不得修改 dsh 底层核心框架**，全部基于非侵入式扩展（patch 层、事件观察、ctx service）。
3. **节点 JSON 即事实源**：模板与画布节点深拷贝解耦，节点数据全量内联，无 `templateId` 引用。
4. **双模式解耦**：模式二服务进程 = fork 独立无头 DSH 实例，崩溃不得影响主进程。
5. **提示词工程**（架构文档 §13）：
   - 前缀稳定：系统提示/工具 schema 顺序固定，动态值**仅注入末段**（`TAIL_MARKER` 之后）。
   - 关键约束双位：首段 + 末段重申（`HEAD_MARKER` / `TAIL_RESTATE_MARKER`）。
   - 提示词模板构建器均为**纯函数**，不读 `Date.now`/随机源。
   - 工具 `description` 用官方标准英文（≤120 tokens）；代码注释、JSDoc、README 用中文。

## 代码风格

- TypeScript strict 模式，`verbatimModuleSyntax: true`（type 导入必须用 `import type`）。
- React + 函数组件 + hooks；状态管理使用 `useReducer`（reducer 在 `studio/studio-state.ts`），所有变更经 `dispatch(action)` 单向流转。
- 纯函数优先：图模型操作、提示词构建器、连线校验、BM25 打分等核心逻辑不依赖全局状态、不读时钟/随机源（便于单测）。
- 依赖注入缝：运行时服务（`ctx.get`）通过接口最小化后注入，便于 fake 测试。
- 错误处理：后端 `WfError` 带稳定 code（`WF_*`）；前端 `useToast` 统一展示。
- 原子写协议：所有持久化经 `withJsonLock` + `atomicWriteJson`（临时文件 + fsync + rename），不得绕过直接写文件。

## 其他约定

- git 提交规则：提交信息使用中文，**流程**：任务执行完成 → 提交 git → 写日志 logs.md（无需再次提交）
- 文档更新：修改 `shared/protocol.ts`（端点名）、`shared/types.ts`（数据结构）、`shared/graph-model.ts`（节点/连线模型）后，**必须同步更新 `docs/架构文档.md`** 对应章节，保持文档与代码零漂移
- 修改核心引擎（orchestrator/agent/tools）后必须运行 `pnpm test`；修改前后端契约（shared/protocol.ts、shared/types.ts、shared/graph-model.ts）后必须运行 `pnpm typecheck` 并检查前端编译
- 不允许阅读项目根目录下 prompt/ 文件夹内的任何文件（除我指定之外）
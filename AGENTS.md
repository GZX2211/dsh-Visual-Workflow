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
- 3. 目录结构（本项目） - 起始行号：L95  **不要读**
- 4. Host 半区模块设计 - 起始行号：L133  
- 5. 关键协议与时序 - 起始行号：L273  
   运行启动、暂停与断点续跑、wf_ask_agent通信、协作组并行、模式二请求流 
- 6. 数据与模型资产 - 起始行号：L333
   run 快照、服务状态、模板、导入导出 v2 bundle、本地嵌入模型与向量索引   
- 7. 模式二 serve 层（serve.patch.yml 模板） - 起始行号：L403  
- 8. 官方源码引用索引（核心功能 -> 官方源码位置） - 起始行号：L425  
- 9. 安全、权限与边界 - 起始行号：L456
   API 暴露面、多租户隔离、数据库只读、文件路径注入、命令参数消毒及插件卸载清理
- 10. Client 半区设计（由旧项目迁移；P11 起入口改版） - 起始行号：L467  
- 11. 测试与验证矩阵 - 起始行号：L480  **必读**
- 12. 风险与实现时验证项 - 起始行号：L492  
- 13. 编码与提示词工程规范（横切，所有任务必须遵守） - 起始行号：L504  **必读**

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
  - 4.3 连线管理模块  - L459  
  - 4.4 工具扩展模块  - L502  
  - 4.5 UI 交互模块  - L569  
  - 4.6 组合管理模块  - L628  
  - 4.7 运行历史与断点恢复  - L648  
- 5. 非功能需求  - L673  
  - 5.1 兼容性需求  - L687    
  - 5.2 可扩展性需求  - L694  
- 6. 开放问题清单  - L705  
- 8. 设计约束  - L726  **必读**
- 9. 复用与差异清单（旧项目 → 新项目）  - L740 ~ 790

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

```
dsh-visual-workflow/
├── docs/
│   ├── 需求文档.md              # 双模式功能与业务规则（审查基准）
│   └── 架构文档.md              # 模块设计/协议（审查基准）
├── logs.md                     # AI 开发日志
├── package.json                 # 依赖/scripts/DSH 挂载配置（pnpm 管理）
├── tsconfig.host.json           # host program（nodenext + node types）
├── tsconfig.client.json         # client program（bundler + dom types）
├── cordis.patch.yml             # Web profile 插件挂载层
├── scripts/                     # 构建脚本
├── tests/                       # 测试文件（host/client/integration 三层）
├── assets/models/bge-small-zh-v1.5     # 向量模型
│
└── src/
    ├── host/                    # ── 后端 Node.js 运行面 ──
    │   ├── index.ts             # 插件入口：装配全部服务、注册事件/工具/看护/路由
    │   ├── service-runner.ts    # 模式二服务进程入口：OpenAI API + SessionMap
    │   ├── events.d.ts          # cordis Events 本地类型声明（subagent/end 等）
    │   │
    │   ├── shared/              # 纯类型/常量层（零 import，client 可引用）
    │   │   ├── graph-model.ts   #   节点/连线/工作流判别联合类型
    │   │   ├── protocol.ts      #   EP_* 端点名 + WF_* 工具名 + 状态枚举常量
    │   │   └── types.ts         #   RunSnapshot/ServiceState/模板/BundleV2 类型
    │   │
    │   ├── storage/             # 数据持久化
    │   │   ├── atomic.ts        #   原子写/读/磁盘锁/临时文件清理原语
    │   │   └── flow-store.ts    #   FlowStore：workflows/services/templates/runs CRUD
    │   │
    │   ├── graph/               # 图模型运行时
    │   │   ├── model.ts         #   连接点矩阵、节点工厂、拓扑查询助手
    │   │   └── validate.ts      #   全量校验（唯一性/连线/协作组/模式差异）+归一化
    │   │
    │   ├── orchestrator/        # ★ 编排运行时核心
    │   │   ├── runtime.ts       #   运行状态机/锁/wf_run_node/wf_finish/wf_ask_agent
    │   │   ├── snapshot.ts      #   运行快照纯函数（创建/更新/终态化/截断）
    │   │   ├── resume.ts        #   断点续跑（继承快照构建）
    │   │   └── watchdog.ts      #   空闲看护 + 宿主重启对账（interrupted）
    │   │
    │   ├── agent/               # 子代理管理
    │   │   ├── runner.ts        #   NodeAgentRunner：创建/复用/工具白名单解析
    │   │   ├── guards.ts        #   ReAct 软截停护栏（pre-step + tools.guard）
    │   │   ├── prompt-setup.ts  #   系统提示词注入
    │   │   └── model-selection.ts # 思考强度注入（installModelSelection 移植）
    │   │
    │   ├── tools/               # wf_* 工具注册
    │   │   ├── define-tool.ts   #   本地 defineTool DSL（schema 编译）
    │   │   ├── text-render.ts   #   工具输出稳定渲染（键序排序）
    │   │   ├── wf-tools.ts      #   wf_run_node / wf_finish / wf_ask
    │   │   ├── wf-ask-agent.ts  #   wf_ask_agent 三态通信（ask/reply/resolve）
    │   │   └── data-tools.ts    #   wf_db_query + SQL 白名单 + 数据库驱动
    │   │
    │   ├── embedding/           # 向量检索
    │   │   ├── chunker.ts       #   文本分块（定长窗口+重叠）
    │   │   ├── engine.ts        #   嵌入引擎（本地 ONNX/远程端点/BM25 降级）
    │   │   └── indexer.ts       #   向量索引构建/检索（BM25 兜底）
    │   │
    │   ├── service/             # 模式二服务管理
    │   │   ├── manager.ts       #   服务进程生命周期（fork/停止/崩溃/自动恢复）
    │   │   ├── openai-api.ts    #   OpenAI 兼容 REST API + SSE 流式
    │   │   ├── sessions-map.ts  #   userId→sessionId 持久化映射
    │   │   ├── serve-patch.ts   #   serve.patch.yml 渲染
    │   │   └── port-pool.ts     #   端口分配（base 起向上探测）
    │   │
    │   ├── remote/              # GUI API 层
    │   │   ├── api.ts           #   端点白名单分发（run/status/service/template...）
    │   │   ├── download.ts      #   受管文件上传/下载（防目录穿越）
    │   │   ├── transfer.ts      #   导入导出 v2 bundle
    │   │   ├── mcp-registry.ts  #   MCP 服务器配置管理（profile patch）
    │   │   └── service-debug.ts #   调试流式代理（Host 转发 SSE）
    │   │
    │   └── prompts/             # 提示词模板（前缀稳定/关键约束双位）
    │       ├── README.md        #   提示词基线（修改该文件夹内容之前先阅读该文档）
    │       ├── index.ts         #   统一出口
    │       ├── markers.ts       #   段落标记常量
    │       ├── orchestration.ts #   编排指令模板（注入父代理）
    │       ├── node-task.ts     #   节点任务块模板（注入子代理）
    │       └── collab.ts        #   协作 Prompt 模板（追加到组内成员）
    │
    └── client/                  # ── 前端浏览器运行面 ──
        ├── entry.ts             # 入口：FAB + 浮窗 + 样式注入 + i18n 注册
        ├── i18n.ts              # 中英文案词典
        ├── entry.css            # 占位
        ├── styles.ts            # 全局样式
        ├── types.d.ts           # 占位
        │
        ├── studio/              # 工作台核心
        │   ├── Studio.tsx       #   主组件：装配 hooks + 交互编排 + 导入导出
        │   ├── studio-state.ts  #   useReducer 状态机 + 选择器（editorDataOf 等）
        │   └── floating-window.tsx # 浮窗宿主（FAB + 拖动/缩放/几何记忆）
        │
        ├── hooks/               # 业务 hooks（每个职责单一）
        │   ├── useStudioState.ts   # 状态机入口
        │   ├── useWorkflows.ts     # 工作流列表/草稿/保存（乐观锁 revision）
        │   ├── useTemplates.ts     # 模板列表/草稿/保存
        │   ├── useRunControl.ts    # 运行启停
        │   ├── useRunPolling.ts    # 运行状态轮询（600ms 硬编码）
        │   ├── useServiceControl.ts # 服务启停
        │   ├── useModeSwitch.ts    # 模式切换
        │   ├── useUnsavedGuard.ts  # 未保存守卫（保存/放弃/取消）
        │   ├── useGraphHistory.ts  # 撤销/重做栈
        │   ├── useSelection.ts     # 选中/编辑器
        │   ├── useRemote.ts        # 远端调用面
        │   ├── useToast.ts         # 轻提示
        │   └── usePanelLayout.ts   # 面板几何拖拽
        │
        ├── components/          # UI 组件
        │   ├── canvas/          #   画布：GraphCanvas/FlowNode/GroupCard/geometry
        │   ├── sidebar/LeftPanel.tsx        # 左侧模板库（四 Tab/拖拽）
        │   ├── panels/inspector/            # 右侧属性面板 + 各类型表单
        │   ├── toolbar/Toolbar.tsx          # 画布控制栏
        │   ├── confirm-dialog/ConfirmDialog.tsx # 三形态确认弹层
        │   ├── run-history/RunHistory.tsx   # 运行历史 + 断点恢复
        │   ├── service-console/ServiceConsole.tsx # 调试台（⚠ SSE 解析错误）
        │   └── combo-manager/ComboManager.tsx # 组合管理 + MCP 配置
        │
        └── lib/                 # 前端工具
            ├── remote.ts        #   fetch 封装（引用 EP_* 常量；流式 streamCall）
            ├── graph-model.ts   #   画布图模型：HANDLES/连线校验/布局/serialize
            ├── bundle.ts        #   导入导出格式判断
            └── files.ts         #   文件读取/下载/localStorage
```            

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
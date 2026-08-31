# dsh-visual-workflow

> DeepSeek Harness（dsh）生态的 **Host + Client 双面可视化多 Agent 工作流设计器** 插件。
> 拖拽卡片、连线编排、一键运行 —— 提供"流程编排"与"后台服务"双模式，支持可视化编程、智能调度、断点续跑与定时触发。

<p align="center">
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-blue"></a>
  <a href="#"><img alt="React" src="https://img.shields.io/badge/React-19-blueviolet"></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A524-green"></a>
  <a href="#"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-11-orange"></a>
  <a href="#"><img alt="vitest" src="https://img.shields.io/badge/test-vitest-cyan"></a>
  <a href="#"><img alt="license" src="https://img.shields.io/badge/license-MIT-lightgrey"></a>
</p>

---

## 目录

- [项目简介](#项目简介)
- [特色功能](#特色功能)
- [架构概览](#架构概览)
- [环境要求](#环境要求)
- [安装与启动](#安装与启动)
- [开发与构建](#开发与构建)
- [项目结构](#项目结构)
- [配置说明](#配置说明)
- [测试与验证](#测试与验证)
- [文档](#文档)
- [技术栈与约定](#技术栈与约定)
- [许可证](#许可证)

---

## 项目简介

`dsh-visual-workflow` 是运行在 [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）之上的可视化多 Agent 工作流设计器。它在 dsh 的 Agent 编排能力之上提供**可视化画布、节点化配置、连线编排、一键运行**，把一个"复杂的长流程多 Agent 任务"从「写提示词」变成「拖卡片连线」。

插件以 **非侵入式扩展** 方式接入 dsh：不修改 dsh 底层核心框架，全部基于官方组合层（patch 层）、事件观察与 `ctx` 服务实现。分为 Host（服务端）与 Client（浏览器端）两个半区：

| 半区 | 角色 | 入口 |
|------|------|------|
| Host | 数据存储、编排运行时、节点子代理引擎、工具注册、GUI API | `lib/index.js` |
| Client | 工作台 UI、画布交互、双向同步 | `lib/client.js` |

> 入口以 `dsh` 官方侧边栏按钮注入（浮窗/分栏双视图），从 dsh 对话界面即可打开工作台。

---

## 特色功能

### 🧩 双模式架构
- **模式一 · 流程编排**：父代理智能调度子代理，长流程多步骤任务一键运行，支持画布双向同步（运行状态实时回显）；节点 JSON 即事实源，运行期修改即时生效。
- **模式二 · API 服务**：把工作流发布为一个持久化 REST 服务（fork 独立无头 dsh 实例），多用户会话隔离、SSE 流式响应、端口自动分配。

### 🎨 可视化画布
- 节点卡片：父代理 / 子代理 / 文件 / 数据库 / 启动 / 结束 / 暂停 / 协作组 / 虚拟节点。
- 连线编排：流程连线、上下文连线、数据库连线、条件分支（通过 / 不通过 / 内容）配色规范。
- 无限画布、网格吸附、连线整理、撤销 / 重做、画布导出导入（v2 bundle）。

### 🧱 模板与组合
- **角色模板**（父 / 子代理）、**文件模板**、**数据库模板**、**协作组模板**、**工作流模板**（全局共享）。
- **组合管理**：勾选工具目录与 MCP 服务器组成"模式"，一键复用于子代理。

### 🚀 运行与断点
- 一次运行 = 一个完整工作流周期；暂停节点 / 窗口挂起 / 用户停止均可断点续跑（已执行节点不重跑）。
- 运行历史按工作流分组，标注状态 / 起止时间 / 节点摘要 / 继承链（`resumedFromRunId`）。
- 宿主重启后自动把残留运行标记为 `interrupted`，可在历史面板恢复。

### ⏰ 定时任务
- 首页入口：工作台标题栏「定时任务」。
- 选择工作流模板，配置**执行窗口**（日期范围 / 有效星期 / 可执行时间段，含跨天区间）与**触发策略**（定点时刻 / 固定间隔）。
- 触发 = 自动创建实例并运行；每轮可自动创建新会话（`agents.create`），或复用当前会话。
- 运行到窗口结束未完成 → 挂起，下一窗口续跑；错过触发 / 并发重叠按策略跳过。

### 🗄️ 数据能力
- 数据库节点：本地 SQLite 只读查询 + **本地向量检索**（内置 `bge-small-zh-v1.5` 嵌入模型，降级 BM25），服务器数据库结构化查询。
- 受管文件拷贝、非文本文件仅注入路径，代理经官方工具访问。

---

## 架构概览

```
┌────────────────────────── dsh 宿主进程 ──────────────────────────┐
│  Host 半区（lib/index.js）                                        │
│  FlowStore（原子 JSON 存储）                                      │
│  OrchestratorRuntime（运行锁 / 快照 / 断点状态机）                 │
│  NodeAgentRunner（节点子代理执行引擎）                            │
│  CordisAgentHost（agents / subagents 服务适配）                   │
│  ServiceManager（模式二 fork 进程 / 端口池 / 自动恢复）            │
│  SchedulerEngine（定时任务触发 / 挂起 / 续跑）                     │
│  GUI API（/visual-workflow/* 端点分发）                           │
└──────────────────────────────────────────────────────────────────┘
                 │  fetch /visual-workflow/*（同源）
┌────────────────┴────────────── 浏览器 ───────────────────────────┐
│  Client 半区（lib/client.js）                                     │
│  WorkbenchHost → Studio（标题栏 / 三栏 / 浮层）                    │
│  画布（GraphCanvas）· 左库（模板/实例）· 右属性（Inspector）       │
│  组合管理 / 运行历史 / 服务控制台 / 定时任务管理                    │
└──────────────────────────────────────────────────────────────────┘
```

- **双 program 隔离**：`tsconfig.host.json`（host + shared）与 `tsconfig.client.json`（client + shared，仅纯类型）互不 include；`src/host/shared/` 为纯类型契约（零运行时 import）。
- **零官方包运行时依赖**：`@deepseek-ai/*` 仅经 `ctx.get()` 运行时解析；唯一的第三方运行时依赖是 `@huggingface/transformers`（本地嵌入推理）。
- **非侵入扩展**：经组合层 patch（`cordis.patch.yml` / `serve.patch.yml`）、`ctx.on` 事件观察、`ctx` 服务注入实现，不改 dsh 核心。

---

## 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node | ≥ v24.17.0 | | 
| pnpm | ≥ 11.22.0 | 包管理器（请勿使用 npm / yarn） |
| git | ≥ 2.53.0 | 主分支 `main` |
| dsh CLI | 0.1.1-rc.2（`@deepseek-ai/dsh`） | 宿主运行时 |

---

## 安装与启动

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建插件

```bash
# 一次性构建（tsc 发射 Host JS + tsdown 构建 Client bundle）
pnpm build
# 构建产物输出到 lib/
```

### 3. 安装到 dsh（插件注册）

以 dsh 插件形式接入。开发调试推荐 **link 模式**：

```bash
# 从本仓库目录：以软链接形式注册，源码即改即生效
dsh plugin add link:$PWD
```

或以本地/远程包方式安装：

```bash
# 通过 git 分发
dsh plugin add git+file:///path/to/dsh-visual-workflow
# 或已发布包
dsh plugin add dsh-visual-workflow
```

> 插件默认挂载到 Web profile（见 `cordis.patch.yml` 的 insert 块）。`dsh plugin add` 会把插件写入 dsh profile 的 bundle 列表，Host 侧才能加载；缺少该步骤时前端无入口、Host 不加载。

### 4. 启动 dsh

安装并构建完成后，运行 dsh 并打开 Web 界面：

```bash
dsh web      # 或以你当前的 dsh profile 启动命令为准
```

在 dsh 对话界面的 **官方侧边栏「插件 / 设置」区域上方** 即可看到本插件入口按钮；点击打开**浮窗**或**分栏**工作台。模式二服务在「服务控制台」中启动。

---

## 开发与构建

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm typecheck` | tsc 双 program（host + client）+ 两套测试 program 类型检查 |
| `pnpm build` | tsc 发射 `lib/` + tsdown 构建 client bundle |
| `pnpm test` | vitest 运行全部单元测试 | 
| `pnpm client-smoke` | client bundle 冒烟（`__ModuleLoader__` / 样式注入 / host 并存 / sourcemap） |
| `pnpm check` | typecheck + test + build + client-smoke（推荐合并命令） |
| `pnpm verify` | typecheck + build + test + client-smoke |

### 本地热更新开发

```bash
# 监听构建（client/host 各有一份 watch）：改动后刷新 Web 页面
node scripts/watch-client.mjs
node scripts/watch-host.mjs
```

---

## 项目结构

```
dsh-visual-workflow/
├─ src/
│  ├─ host/                 # Host 半区
│  │  ├─ shared/            #   前后端共享纯类型契约（graph-model / types / protocol）
│  │  ├─ storage/           #   原子 JSON 存储（flow-store / atomic）
│  │  ├─ orchestrator/      #   编排运行时（锁/快照/断点/暂停门/挂起/续跑）
│  │  ├─ agent/             #   节点子代理执行引擎、护栏、模型选择、提示词注入
│  │  ├─ tools/             #   wf_* 工具（wf_run_node / wf_finish / wf_ask / wf_db_query…）
│  │  ├─ remote/            #   GUI API 端点（api / api-workflows / api-runs / api-scheduler…）
│  │  ├─ service/           #   模式二服务管理器（fork / 端口池 / serve-patch）
│  │  ├─ embedding/         #   本地嵌入（bge-small-zh-v1.5）与向量/BM25 索引
│  │  ├─ scheduler/         #   定时任务（planner / task-store / engine / session-provider…）
│  │  └─ prompts/           #   编排/节点任务/协作提示词模板
│  └─ client/               # Client 半区
│     ├─ studio/            #   工作台状态机（useReducer）与布局
│     ├─ components/        #   画布 / 组合管理 / 运行历史 / 服务控制台 / 定时任务 / 日期/时间选择器
│     ├─ hooks/             #   controller hooks（文档/画布/运行/模板/面板…）
│     ├─ lib/               #   remote / files / graph-model / bundle 导入导出
│     └─ i18n.ts / styles.ts
├─ tests/                   # 单测（host / client(jsdom) / integration）
├─ scripts/                 # 构建与 watch 脚本（build.mjs / watch-client.mjs …）
├─ docs/                    # 需求文档 / 架构文档 / 运行复盘
├─ assets/models/           # 本地嵌入模型资产
├─ cordis.patch.yml         # Web profile 组合挂载层
├─ serve.patch.yml          # 模式二服务进程组合层模板
├─ tsconfig.host.json       # Host program（emit lib/）
├─ tsconfig.client.json     # Client program（noEmit，仅类型检查）
└─ package.json
```

---

## 配置说明

插件的可配置键定义于 `src/host/config.ts`，默认值与 `cordis.patch.yml` 一致，可通过 dsh 组合配置覆盖：

| 键 | 默认 | 说明 |
|----|------|------|
| `dataDir` | `$DSH_HOME/visual-workflow` | 数据根目录（工作流 / 服务 / 模板 / 运行历史 / 断点） |
| `servicePortBase` | `7860` | 模式二服务端口起始值（端口池自动向上探测） |
| `apiKey` | `null` | 模式二 REST API 鉴权密钥（`null` = 关闭） |
| `maxConcurrentPerService` | `50` | 模式二单服务并发上限（超出 429） |
| `wfAskAgentTimeoutMs` | `120000` | `wf_ask_agent` 阻塞通信超时 |
| `runIdleTimeoutMs` | `1800000` | 运行空闲看护超时 |
| `reactIterationLimitDefault` | `50` | ReAct 迭代默认上限（软截停） |
| `retryLimitDefault` | `3` | 单节点回流重试默认上限 |
| `outputFullLimit` | `102400` | 节点完整输出持久化字节上限 |
| `documentTextLimit` | `20000` | 文本文件节点注入上下文字符上限 |
| `embeddingModelDir` | `null` | 本地嵌入模型目录（`null` = 随包资产） |
| `embeddingEndpoint` | `null` | 外部 OpenAI 兼容 /embeddings 端点（`null` = 本地） |
| `runPollMs` | `2000` | 运行状态轮询间隔（预留，前端当前 600ms 硬编码） |

---

## 测试与验证

```bash
pnpm test         # 全量单测（host + client jsdom + integration）
pnpm check        # 一键门禁：类型 + 测试 + 构建 + client 冒烟
```

- **Host 单测**：存储原子性/锁并发、图校验矩阵、运行状态机（running/paused/interrupted/stopped 续跑）、护栏计数、wf 工具 schema、端口池、定时任务规划器/引擎。
- **Client 单测（jsdom）**：Studio 装配、画布/连线、未保存守卫、撤销重做、组合管理、双月日历、时间输入、定时任务管理。
- **Integration**：真实组合启动（Loader / patch）、startRun → wf_run_node → subagent/end 回写、暂停 / 续跑、服务 fork 启动 / 请求 / 停止。

---

## 文档

- `docs/需求文档.md` —— 产品需求、功能需求、非功能需求、复用与差异清单。
- `docs/架构文档.md` —— 插件契约、Host/Client 模块设计、关键协议与时序、数据与模型资产。
- `docs/运行复盘与改进清单.md` —— 运行复盘与待跟进问题。
- `prompt/定时任务开发.md` —— 定时任务功能需求与字段规则说明。

---

## 技术栈与约定

- **语言 / 框架**：TypeScript（strict）、React 19（函数组件 + hooks）、`useReducer` 单向数据流状态机。
- **构建**：tsdown（client bundle）+ tsc（host 发射），双 program 完全隔离。
- **测试**：vitest + jsdom。
- **唯一第三方运行时依赖**：`@huggingface/transformers`（本地嵌入推理）。
- **约定**：纯函数优先（图模型 / 提示词构建器 / 连线校验 / 打分不依赖全局状态、不读时钟随机源）；后端错误带稳定 `WF_*` 错误码；持久化经 `withJsonLock + atomicWriteJson` 原子写；工具 `description` 用官方标准英文，代码注释 / JSDoc / README 用中文。

---

## 许可证

[MIT](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/流程编排.png" alt="界面预览" width="100%" />
</p>

<h1 align="center">可视化 Agent 编排平台</h1>

<p align="center">
  基于 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 打造的可视化 Agent 编排平台<br>
  支持固定 Workflow、可视化流程设计、Agent 自主元编排，可在运行过程中实时干预，通过反馈沉淀经验持续自进化
</p>

<p align="center">
  <a href="README_EN.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-blue"></a>
  <a href="#"><img alt="React" src="https://img.shields.io/badge/React-19-blueviolet"></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A524-green"></a>
  <a href="#"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-11-orange"></a>
  <a href="#"><img alt="vitest" src="https://img.shields.io/badge/test-vitest-cyan"></a>
  <a href="#"><img alt="license" src="https://img.shields.io/badge/license-MIT-lightgrey"></a>
  <a href="https://github.com/GZX2211/dsh-Visual-Workflow/releases"><img alt="version" src="https://img.shields.io/github/v/release/GZX2211/dsh-Visual-Workflow?label=version&color=0891b2&include_prereleases"></a>
</p>

---

## 项目定位

这是一个可以“越用越聪明的”的 Agent 编排平台，不再是单纯的 workflow。

项目将 **工作流（Workflow）、智能体团队（Agent Team）、元编排（Meta-Orchestration）、人类在环（Human-in-the-loop）和组织记忆（Organizational Memory）** 组合在同一个可视化工作台中：

```text
                    ┌─────────────────────┐
                    │      人类设计        │
                    │   固定 Workflow      │
                    └──────────┬──────────┘
                               │
                               ▼
┌─────────────────┐     ┌───────────────┐     ┌──────────────────┐
│ Agent 自主规划   │ ──► │  组织生成/执行 │ ◄── │ 运行中人工干预     │
│Meta-Orchestration│    └───────┬───────┘     └──────────────────┘
└─────────────────┘             │
                                ▼
                         ┌─────────────────┐
                         │  复盘 + 反馈     │
                         │ Experience      │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  组织记忆        │
                         │Assets + Experience│
                         └────────┬────────┘
                                  │
                                  └──────► 下一次组织生成
```

> 因此，项目此刻正式从曾经的 dsh Visual Workflow 重命名为：可视化 Agent 编排平台。

---

## 核心亮点

✦ **Agent 元编排** 
  - Agent 不再只能执行人预先画好的固定 DAG，而可以在编排过程中**获取组织资产与经验，并根据当前任务生成、调整组织结构，并通过反馈强化学习持续进步**

✦ **人类在环的实时调整**  
  - 人类修改流程后，编排器实时感知最新拓扑动态调整后续编排；Agent 改图后，画布实时显示变化，编排与画布始终一致，运行中 **可观察、可纠偏**。

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/界面优化.png" width="100%" />
</p>

<table>
  <tr>
    <td width="65%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/API服务模式.png" width="100%" />
    </td>
    <td width="35%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/终端输出.png" width="100%" />
    </td>
  </tr>
</table>

> 将 DSH 作为独立后端服务部署，持久化 无头Agent 后台运行，可连接外部APP（如QQ机器人、飞书）或自建前端。

✦ **双模式架构**  
  - **流程编排模式**：长流程多 Agent 智能调度，父代理自主推进，支持随时暂停断点续跑与实时状态回显。
  - **API服务模式**：一键发布为独立 REST API 服务（OpenAI 兼容协议），多租户会话隔离，端口自动分配。

✦ **深度自定义**  
  - 每个子代理节点独立配置 system prompt、LLM 模型、思考强度、工具组合及 ReAct 迭代上限、回流重试上限；父代理亦可自由选择模型与调度模板，满足精细化编排需求。

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/组合管理页.png" width="100%" />
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/MCP配置页.png" width="100%" />
    </td>
  </tr>
</table>

> 工具自由组合分配给各个代理，避免无用工具占据上下文；mcp 服务器只需一行配置自动注册并支持热重载即时生效。

✦ **协作组与 Agent Team**  
  - 将多个角色节点拖入协作组，连通官方 Agent team 机制，将自定义配置连通 teammate，可精确控制其协作行为，使用模型，工具组等，runtime 和协调工具由官方机制负责。
  - Agent Team 功能关闭时，降级由本插件通信机制负责组内协作，通过 `wf_ask_agent` 工具进行组内交流。

✦ **定时触发**  
  - 工作台内置定时任务，选择工作流模板配置执行窗口与触发策略，自动创建实例并运行，错过窗口自动挂起/续跑，支持错峰调用 api，省钱又省心。

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/定时任务管理.png" width="100%" />
</p>

> 全自动化运维管理，定时自动运行工作流，可支持峰谷时段错时调用，自动暂停，保存流程数据，谷时自动运行。

✦ **零官方包依赖**  
  - 所有 DSH 生态服务（LLM、子代理、工具、用户问题等）均通过 `ctx.get()` 运行时解析，Host 工具以纯对象定义注册，插件自身无任何官方包编译时依赖，升级兼容性更强。

---

## 核心概念

| 概念 | 说明 |
|------|------|
| **元编排** | 在编排过程中**获取组织资产与经验，并根据当前任务生成、调整组织结构，并通过反馈强化学习持续进步**的编排架构 |
| **资产** | 经过正式晋升、可被未来编排召回的角色、工作流配置、规则等；与模板分离储存并接入版本控制 |
| **模板** | 角色/文件/数据库/工作流的“蓝图”，存储在 `~/.dsh/visual-workflow/`；模板与实例深拷贝解耦，修改模板不影响已生成节点 |
| **实例** | 工作流或服务的具体运行实例（`workflows/` 与 `services/`），只能从工作流模板创建，可在画布中编辑并保存 |
| **节点** | 画布上的卡片，分为父代理、子代理、文件、数据库、阶段（启动/结束/暂停）、协作组、虚拟节点 |
| **连线** | 传递流程方向（流程线）、上下文内容（上下文线）、数据库标识（数据库线）；流程线可带条件标签，由父代理语义判断 |
| **父代理** | 编排的核心调度者，模式一中负责监督与调度，模式二中为最终回答者；可由用户指定调整编排流程 |
| **子代理** | 任务执行者，独立配置角色 Prompt、模型、工具等，由父代理按需创建与调度 |
| **编排** | 主 Agent 使用 `wf_run_node` / `wf_finish` 等工具自主推进流程，控制节点状态 |
| **模式** | 插件提供两种运行模式：流程编排模式（模式一）与 API 服务模式（模式二），通过顶栏切换 |
| **断点续跑** | 流程暂停或宿主意外中断后，已执行节点状态持久化，恢复后不重跑，从断点继续 |
| **协作组** | 将多个角色节点组合为一个 Agent Team，组内可自由通信协作 |
| **虚拟节点** | 主节点的别名引用，不存储独立配置，共享主节点的执行实例，用于拓扑复用 |

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/资产管理与版本控制.png" width="100%" />
</p>

---

## 节点卡片

### 1. 角色节点（任务执行单元）

卡片形态（**左 3 入、右 2 出**）：

```
        ┌─────────────────────────┐
  左一 ●│  [角色卡片] 标题          │● 右一
（数据库）│  类型徽标 / 模型 /       │（上下文）
  左二 ●│  工具组合徽标            │● 右二
（上下文）│                         │（流程出）
  左三 ●│                         │
（流程入）│                         │
        └─────────────────────────┘
```

| 接点 | 名称 | 语义 |
|---|---|---|
| 左一 | 数据库输入 | 连接数据库节点，注入检索/查询工具 |
| 左二 | 上下文输入 | 接收上游上下文（不连接则不继承） |
| 左三 | 流程输入 | 控制执行顺序 |
| 右一 | 上下文输出 | 向下游传递本节点产出 |
| 右二 | 流程输出 | 顺序执行/条件分支（通过/不通过/内容） |

**属性配置**：

| 配置项 | 说明 |
|---|---|
| **名称** | 节点名称 |
| **system prompt** | 文本输入或引用 .md，设定角色系统提示词 |
| **LLM 模型** | 独立选择 provider + model |
| **思考强度** | 与官方下拉一致 |
| **工具组合** | 内置预设（标准/极简/ptc/创造）+ 自定义组合（组合管理中创建） |
| **ReAct 迭代上限** | 软截停：达上限后强制收尾（不发起新工具调用，输出已有结论），默认 50 |
| **回流重试上限** | 节点级尝试计数护栏，默认 3 |
| **输入/输出数据结构** | 文本/JSON 描述（辅助模型理解） |
| **系统提示词开关** | 控制官方系统提示词注入（默认开启）；**关闭工具散文段不影响工具调用能力** |

**虚拟节点**：点击“复制”可生成虚拟节点（虚线边框 + “↻ 引用”角标），与主节点共享配置与执行实例，删除主节点时级联清除。

### 2. 文件节点

- 文件内容直接存于模板（文本 / PDF 提取文本 / 图片等非文本文件以受管路径存储）
- 右侧属性面板可上传/替换文件，保存后所有引用节点同步
- 功能：用于给角色节点注入提示词、需求、压缩摘要等上下文

### 3. 数据库节点

- 本地类型：支持 SQLite 文件，内置向量检索（bge-small-zh-v1.5，CPU 推理；模型资产缺失/加载失败自动降级 BM25）
- 服务器类型：支持 MySQL / PostgreSQL，提供结构化只读查询与向量检索（本地构建索引）
- 右侧面板可配置连接信息、测试连接，并调整检索高级选项（召回条数、分块窗口、相似度阈值、索引容量）
- 功能：连接企业/个人知识库调用相关信息和查询检索

### 4. 阶段节点

- 启动（模式一） / 输入（模式二）：流程入口；模式二下自动接收外部用户问题作为初始上下文
- 结束（模式一） / 输出（模式二）：流程终点；模式二下汇聚父代理最终输出并流式返回
- 暂停（模式一）：流程门，运行至此暂停并保存断点（人工审查点），再次运行从右出继续

### 5. 协作组节点（Agent Team）

- 将多个角色节点拖入协作组，组内角色登记为 Teammate 并行启动并参与协作
- 协作 Prompt 追加到每个成员的首条用户消息末尾，并自动列出所有成员的 ID 与角色名称（插件协作机制，现已被官方取代，保留降级）
- 组内 Agent 通过 `wf_ask_agent` 异步通信、通过 `wf_ask` 向用户交流提问（保留降级）
- 卡片支持拉伸扩展，内部成员列表可滚动

---

## 连线

**连线类型与颜色**：

| 连线类型 | 语义说明 | 颜色 |
|----------|----------|------|
| 流程连线 | 控制执行顺序 | ⚪ 冷灰 / 银白 |
| 上下文连线 | 传递文本内容、文件索引 | 🟡 琥珀金 |
| 数据库连线 | 传递数据库服务标识 | 🔵 天蓝 |
| 条件：通过 | 条件判断为真，执行该分支 | 🟢 翠绿 |
| 条件：不通过 | 条件判断为假，执行该分支或回流 | 🔴 珊瑚红 |
| 条件：内容 | 自定义语义判断（路由标签） | 🟣 紫罗兰 |

> 编辑条件后，条件颜色覆盖初始颜色；条件判断由父代理进行语义判断。

---

## 编排工具

以下工具构成当前编排层的主要控制面：

| 工具 | 用途 |
|---|---|
| **`wf_run_node`** | Mode 1 异步启动一个 Agent 节点或整个协作组；立即返回，不阻塞父代理等待 |
| **`wf_run_node_wait`** | Mode 2 启动 Agent 节点并阻塞等待，返回 `ok / fail` 与最终输出 |
| **`wf_finish`** | 标记本次编排完成/失败、持久化运行记录并释放运行锁；幂等 |
| **`wf_ask`** | 子代理向用户在“主界面”发起官方问题卡片并等待回答，支持提问队列 |
| **`wf_ask_agent`** | 协作组内 Agent 间非阻塞 `ask / reply` 消息通信；目标离线时可冷恢复 |
| **`wf_db_query`** | 数据库 `search / query / schema` 三模式只读访问 |
| **`wf_org_catalog`** | 召回组织资产、经验、工具组合、preset、模型与编排规则；父代理专用 |
| **`wf_graph_patch`** | 对工作流模板或运行实例进行受控图修改；支持创建、更新、删除、连线调整等操作 |
| **`wf_experience`** | 提交运行复盘得到的经验候选，渲染用户多选确认卡片，根据用户反馈写入经验库 |

> 区别：不同于官方 Teammate 调度只能传递父的工具和模型，`wf_run_node` 创建的代理节点可以自由组合任意工具、设定不同模型和系统提示词（system prompt）。

---

## 安装（Windows）

> **版本适配**：本插件适配 **DeepSeek Harness `0.2.0-rc.2`**。请先安装或升级宿主（升级前先在外部终端**完全停止 dsh 进程**）：
>
> ```bash
> npm install -g @deepseek-ai/dsh@0.2.0-rc.2
> ```
> tips：可直接将以下段落复制给 Claude Codex 等 AI 助手安装该插件。

1. **文件管理器定位**：`%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`,在其中添加：

```yaml
allowBuilds:
  onnxruntime-node: true
  protobufjs: true
  sharp: true
```

2. **运行插件安装命令**:

```bash
dsh plugin --profile web add "github:GZX2211/dsh-Visual-Workflow#main"
```

3. **验证挂载**：（可选）

```bash
dsh --profile web --dump-config | findstr "visual-workflow"
```

4. **重启** `dsh web`。打开工作台：点击官方**左侧边栏底部的「工作流」入口**（在官方「设置」旁）→ 官方**右侧 Sidebar** 打开「工作流」标签页即完整工作台。

### 安装问题速查

**出现 `Host key verification failed` 报错**

在 **PowerShell** 或 **CMD** 中执行：

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

**pnpm 拦截提示：声明了 `prepare`，需要`allowBuilds`**（常见）

文件管理器定位：`%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`，把报错中给出的包名添加到 `allowBuilds` 列表里，保存再重新安装。

### 卸载

```bash
dsh plugin --profile web remove dsh-visual-workflow
```

> 如不再使用可同步清理：`~/.dsh/visual-workflow/` 文件夹。

---

## 快速开始

### 方式一：人工设计 Workflow

1. 打开「工作流」工作台。
2. 创建工作流模板。
3. 创建角色模板。
4. 将角色、文件、数据库、阶段、协作组拖入画布。
5. 使用 `flow / ctx / db` 连线。
6. 配置各 Agent 的模型、Prompt 与工具组合。
7. 创建实例。
8. 点击运行。

### 方式二：让 Agent 设计组织

在主会话中输入：

```text
/arrange <你的规划意图>
```

例如：

```text
/arrange 做一个内容生产流水线，包含选题、资料收集、成稿、审核和发布五个阶段
```

Agent 会：

```text
自然语言意图
    ↓
wf_org_catalog
    ↓
读取相关资产 / 经验 / 规则
    ↓
生成组织方案
    ↓
wf_graph_patch
    ↓
创建 / 修改工作流模板
    ↓
用户确认
    ↓
运行
```

`/arrange` 本身只负责注入规划指令，不会因为规划完成而自动运行工作流。

### 方式三：运行中人工调整

运行 Workflow 后：

1. 观察画布中的实时节点状态。
2. 直接修改画布中的节点或连线。
3. 保存修改。
4. 编排器感知最新拓扑。
5. 后续调度基于最新组织继续执行。

也可以在流程中使用 `暂停/pause` 节点建立人工审查点。

### 方式四：Agent 在运行中自动调整组织

父代理根据运行事实发现当前组织不再合适时会自己调用 `wf_graph_patch` 修改当前实例：

例如：

```text
当前组织
A → B → C

发现 B 不适合当前任务

动态调整
A → D → C
```

修改会经过图校验、组织预算与 revision 检查后落盘，并同步到运行事实源。
也可在 **组合管理** 界面禁用该工具阻止代理自行调整，同理其他功能都可以直接通过工具管理调整运行时能力。

> **组合管理**：顶栏「组合」按钮可创建自定义工具组合（官方工具/自建工具 + MCP 服务器），可在角色模式中选用。

> **定时任务**：顶栏「定时任务」入口，选择工作流模板，配置执行窗口与触发策略，即可自动调度运行。

> **冷启动**：资产与经验没办法在初次使用时即生成，如果希望 Agent 在初期就有优秀的组织能力，最好引入外部 优质 prompt。

---

## 数据存储

所有文件位于 `~/.dsh/visual-workflow/`，人可读 JSON：

```
workflows/                  # Mode 1 工作流实例
services/                   # Mode 2 服务实例
flow-templates/             # 可编辑 Workflow 模板
roles/                      # 可编辑角色模板
files/                      # 文件模板
databases/                  # 数据库模板
combos.json                 # 自定义工具组合

runs/                       # 运行快照与历史
orchestrations/             # 运行期间的编排事实源

assets.db                   # 正式角色/工作流资产 + Experience
data/files/                 # 受管非文本文件
data/vector/                # 数据库向量索引
scheduler/                  # 定时任务定义与触发记录
```

---

## 配置

在 `cordis.patch.yml` 中可覆盖默认值：

```yaml
- insert:
    - id: visual-workflow
      name: dsh-visual-workflow
      config:
        dataDir: !!js dshHomePath('visual-workflow')
        servicePortBase: 7860
        apiKey: null
        maxConcurrentPerService: 50
        wfAskAgentTimeoutMs: 120000
        runIdleTimeoutMs: 1800000
        reactIterationLimitDefault: 50
        retryLimitDefault: 3
        outputFullLimit: 102400
        documentTextLimit: 20000
        embeddingModelDir: null
        embeddingEndpoint: null
        runPollMs: 2000
```

---

## 本地开发

```bash
git clone https://github.com/GZX2211/dsh-Visual-Workflow.git
cd dsh-visual-workflow
pnpm install
dsh plugin --profile web add "link:$PWD"
```

常用命令：

```bash
pnpm typecheck      # Host / Client / Test 类型检查
pnpm build          # 构建 Host + Client
pnpm test           # 单元测试
pnpm gates          # Contract / 门禁测试
pnpm client-smoke   # Client 冒烟测试
pnpm check          # 类型检查 + 测试 + 构建 + smoke
pnpm verify         # 完整验证门禁
```

> 修改 Client 需重新构建并硬刷新浏览器；修改 Host 需重启 `dsh web`。

---

## 目录结构（核心）

```
dsh-visual-workflow/
├── src/
│   ├── host/
│   │   ├── shared/               # 前后端共享纯类型契约
│   │   ├── agent/                # Agent 创建、模型选择、Prompt 注入、执行护栏
│   │   ├── assets/               # SQLite 资产库、Experience
│   │   ├── orchestrator/         # 运行时、状态机、动态编排、运行事实、复盘
│   │   ├── tools/                # wf_* 编排工具
│   │   ├── graph/                # 图模型、结构校验、组织约束与预算
│   │   ├── team/                 # Agent Team 能力适配
│   │   ├── storage/              # 模板/实例/运行记录等文件存储
│   │   ├── embedding/            # 向量嵌入与索引
│   │   ├── mcp/                  # MCP 注册与配置
│   │   ├── scheduler/            # 定时任务
│   │   ├── service/              # Mode 2 服务管理
│   │   ├── api/                  # GUI API
│   │   ├── commands/             # /arrange 等命令
│   │   └── prompts/              # 编排、规划、复盘 Prompt
│   │
│   └── client/
│       ├── sidebar/              # 官方 Sidebar 插槽与工作台入口
│       ├── studio/               # 工作台主状态与状态机
│       ├── components/           # 画布、资产、历史、定时任务等 UI
│       ├── hooks/                # UI / 数据职责单一 hooks
│       ├── styles/               # 样式文件
│       └── lib/                  # graph / remote / storage 等纯逻辑
│
├── tests/                        # 单元、集成与 contract 测试
├── scripts/                      # 构建、冒烟与开发脚本
├── assets/models/                # BGE-small-zh-v1.5 等模型资产
├── docs/                         # 架构文档与归档文件
├── cordis.patch.yml              # Web profile 挂载层
├── serve.patch.yml               # Mode 2 服务进程组合层
└── package.json
```

---

## 本项目核心研究方向（未来规划）

项目目前的研究方向已经从“如何设计一个更好的 Workflow”进一步转向：

 **如何让 Agent 根据任务动态形成、调整并持续利用一个适合当前目标的智能组织**

> 项目的长期目标是：探索元编排架构的最终实现方式和边界。制作一个可以持续进化的 AI 系统。
> 而依附于一个成熟的 Harness 插件框架是一个非常好的起点，希望可以持续进步，也为 dsh 插件生态做出一个优质的“产品”。

---

## 许可

[MIT](LICENSE) © GZX2211。欢迎提 Issue / PR。社区项目，界面形态参考 [dsh-deepseek-flow](https://github.com/kanghelyu/dsh-deepseek-flow)。
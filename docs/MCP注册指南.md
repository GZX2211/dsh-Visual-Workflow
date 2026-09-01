# MCP 注册标准指南

> 本文面向「组合管理 → MCP 服务器」页面的注册流程，涵盖本地全局、npx、远程 URL 三种启动方式，
> 并以 CodeGraph（`@colbymchenry/codegraph`）为例给出可直接照抄的取值。配合本插件的「单行启动命令」
> 表单，任何人只需粘贴一行命令（或导入 mcp.json）即可完成注册，无需理解可执行文件与参数的拆解逻辑。

---

## 0. 先判断：这个 MCP 服务器该用哪种方式

| 启动方式 | 适用场景 | 表单连接方式 | 填什么 |
|---|---|---|---|
| **stdio（本地）** | 服务器在本机作为子进程跑（绝大多数 MCP，如 CodeGraph、playwright） | `stdio（本地命令）` | 「启动命令」填一整行可执行命令 |
| **npx 一行** | 不想/没法全局安装，想按需下载运行某个 npm 包 | `stdio（本地命令）` | 「启动命令」填 `npx -y <包名> [flags]` |
| **streamable-http（远程）** | 服务器已独立运行、对外暴露 HTTP 端点（如 GitHub MCP、自建 Service） | `streamable-http（远程 URL）` | 填服务端点 URL；如需鉴权填「请求头」JSON |

> 关键：**stdio 与 npx 都属于「本地命令」**，连接方式都选 `stdio`；区别只在「启动命令」那一行怎么写。
> 远程方式不启动任何本地进程，只连一个 URL。

---

## 1. 标准注册流程（组合管理 → MCP 服务器）

1. 打开「组合管理」（顶栏「组合」按钮）。
2. 切到 **MCP 服务器** 标签页。
3. 点 **「＋ 新建 MCP 服务器」**（或「从 mcp.json 导入」直接粘贴）。
4. 按下面三种方式之一填写，然后点 **「保存服务器」**。
5. 返回 **工具** 标签页，勾选刚加的 MCP 服务器，命名组合并保存。
6. 在角色卡片「模式」下拉里选这个组合；运行节点时 `mcp__<server名>__*` 工具即进入子代理白名单。
7. MCP 增删改写入 profile 配置，**需重启 dsh web 后生效**（页面有提示）。

---

## 2. 三种方式的「启动命令」怎么填

### 2.1 本地全局（已 `npm i -g xxx` 或 `codegraph install`）

把你在终端里能跑通的那行命令，**整行粘贴**到「启动命令」：

```
node D:\repo\server\cli.js --headless
codegraph serve --mcp
```

- 保存时插件自动拆成 `可执行名 + 参数`。Windows 下若该命令是 `.cmd`/`.ps1` 包装（任意 npm 全局 bin、
  npx/npm 等），**自动经 `cmd.exe /c …` / `powershell -File …` 启动**，无需你手动处理。
- **含空格的路径要加引号**：如 `"C:\Program Files\nodejs\node.exe" D:\server\cli.js`。

### 2.2 npx 一行（无需全局安装，按需下载）

```
npx -y @colbymchenry/codegraph serve --mcp
npx -y @playwright/mcp@latest --headless
```

- 插件对 `npx` 会自动走 `cmd.exe /c npx …`（Windows），因此**可以直接填 npx**，与 Claude 的 mcp.json
  心智完全一致。
- 代价：npx 需要在线解析/下载包，首次较慢、无缓存时每次启动都要解析；稳定使用建议全局安装后走 2.1。

### 2.3 远程（streamable-http）

- 连接方式：`streamable-http（远程 URL）`。
- 服务器名称：自定义（如 `chat-github`）。
- URL：服务端点，如 `https://api.githubcopilot.com/mcp/` 或本机 `http://127.0.0.1:8000/mcp`。
- 请求头（JSON，可选）：需要鉴权时填 `{"Authorization":"Bearer <token>"}`。登录/密钥等走此处。
- 该方式 **不启动本地进程**，只对 URL 发 `tools/list` / `tools/call` 请求；远程服务需已自行运行。

### 2.4 可选：环境变量（仅 stdio）

多数本地服务器不需要；少数需要密钥/路径。在「环境变量（JSON，可选）」填对象，如
`{"API_KEY":"sk-xxx","CODEGRAPH_MCP_TOOLS":"explore,node"}`。这些变量会传给子进程。

---

## 3. CodeGraph 注册实例（`@colbymchenry/codegraph`）

CodeGraph 是「本地优先」的代码图谱 MCP（自带运行时、100% 本地、无网络依赖），
它只提供 **stdio** 启动方式，**不提供远程 HTTP 端点**。以下按推荐度排序。

### 方式 A：本地全局安装 + stdio（推荐）

```powershell
# 1. 安装（任选其一）
npm install -g @colbymchenry/codegraph
# 或 Windows 独立安装器（无需 Node）
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex

# 2. （可选）把 CodeGraph 接入你常用的 agent
codegraph install

# 3. 为每个项目建立索引
cd your-project && codegraph init
```

在插件 UI 的 MCP 服务器里填：

| 字段 | 值 |
|---|---|
| 服务器名称 | `codegraph` |
| 连接方式 | `stdio（本地命令）` |
| 启动命令 | `codegraph serve --mcp` |

> 完成后在角色卡「模式」选含 codegraph 的组合；运行节点即可用 `mcp__codegraph__*` 工具（默认 `codegraph_explore`）。
> 若要其它工具（`codegraph_node` / `codegraph_search` 等）出现在 MCP 面，设环境变量
> `CODEGRAPH_MCP_TOOLS=explore,node,search,callers`。

### 方式 B：npx 一行（不装全局，临时/低频用）

| 字段 | 值 |
|---|---|
| 服务器名称 | `codegraph` |
| 连接方式 | `stdio（本地命令）` |
| 启动命令 | `npx -y @colbymchenry/codegraph serve --mcp` |

> 每次由 npx 解析下载，稳定使用建议方式 A。

---

## 4. 常见问题

| 现象 / 场景 | 处理 |
|---|---|
| 填了 `npx …` 但不起作用 | 不要手动拆成两段；直接整行填写，插件会自动经 `cmd.exe /c` 启动（Windows）。 |
| 报「路径含空格」相关启动失败 | 在「启动命令」里给含空格路径加引号：`"C:\Program Files\nodejs\node.exe"`。 |
| 用 `.ps1` 当启动命令 | `.ps1` 不是可执行体，插件会自动经 `powershell -File` 启动；也可直接用 node + 真实脚本路径。 |
| 需要登录/令牌 | stdio 用「环境变量」；远程用「请求头」。 |
| 参数值里带逗号（如 `--viewport-size 1440,900`） | 现在采用「整行命令」而非逗号拆分，直接写 `--viewport-size 1440,900` 即可，不再被拆分。 |
| 已有 Claude / Cursor 的 mcp.json | 用「从 mcp.json 导入」粘贴即可，自动映射到本表单。 |
| 保存后工具没出现 | MCP 写 profile 需 **重启 dsh web** 生效；重启后再回「组合管理」勾选。 |

---

## 5. 一句话记忆

> **本地命令类**：连接方式选 `stdio`，把终端里能跑的那行命令整行粘贴（含空格的路径加引号；
> `npx`、任意全局 bin 自动处理）。
> **远程类**：连接方式选 `streamable-http`，填 `URL` + 可选请求头。
> 两者在保存前都可用「从 mcp.json 导入」直接带过来。

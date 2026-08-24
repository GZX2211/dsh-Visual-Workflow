# DSH 插件热重载（HMR）实现指南

**核心结论**：在开发环境下，修改源码通常无需重启 `dsh web` 进程。后端（Host）逻辑依赖 `@deepseek-ai/cordis-plugin-hmr` 自动重载；前端（Client）逻辑依赖 `@deepseek-ai/dsh-client-hmr` 自动更新。


## 项目存放位置

> 需要在项目根目录执行一次安装命令，通过软链接（Link）的方式挂载到 Profile 中，后续修改代码就不需要重复推送或重装了。

```bash
# 在你的项目根目录 D:\AiCoding-Gzx\HarnessPlugin\dsh-visual-workflow 下执行
dsh plugin --profile web add "link:$PWD"
```
*   **依赖提示**：用 `link` 方式安装时，建议把 `@deepseek-ai/*` 依赖显式声明在 `package.json` 的 `dependencies` 中，避免 Node 解析真实路径时报错。

## 后端（Host）插件热重载

*   **触发原理**：`@deepseek-ai/cordis-plugin-hmr` 会监听 `root` 目录下的源码变化。当文件保存时，它会先卸载旧插件实例（清理其所有 effects），再加载新代码并执行 `apply`，从而实现逻辑热替换。
*   **核心配置**：需要在 `cordis.yml` 中显式声明并依赖以下服务：
    ```yaml
    # cordis.yml
    - id: logger
      name: '@deepseek-ai/cordis-plugin-logger-console'
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
    - id: hmr
      name: '@deepseek-ai/cordis-plugin-hmr'
      config:
        root: ['.']
        ignored:
          - '**/node_modules'
          - '**/.*'
        debounce: 100
    ```
    *   **前置依赖**：必须同时声明 `timer` 服务，否则 HMR 会因去抖机制无法触发而一直处于挂起状态（PENDING）。
    *   **加载要求**：需要运行在支持 Node 内部模块加载器的环境中（如 `tsx`）。

## 前端（Client）插件热更新

*   **触发原理**：`@deepseek-ai/dsh-client-hmr` 运行在浏览器侧，通过订阅系统 SSE（Server-Sent Events）通道（`GET /plugins/events`）来接收 `rebuilt` 帧。当构建工具（如 `pnpm run dev:web` 或 `tsdown watch`）重新打包 bundle 时，浏览器会自动重载对应插件模块。
*   **触发条件**：必须有一个持续运行的构建 watcher 进程。只要构建器产生了新的包文件，前端就会自动刷新，通常无需手动点击页面刷新。
*   **已知限制**：HMR 是有意的粗粒度重载，会创建全新的 fiber 和组件，因此插件的 React 状态会丢失，数据层（Session 等）不受影响。

## `ctx.effect` 规范

HMR 能干净执行的前提是**所有注册都必须遵守 `ctx.effect` 规范**。框架认为所有资源注册都是可逆的副作用，卸载插件时会自动释放旧资源。

*   **规范写法**：
    ```typescript
    export function apply(ctx: Context) {
      // 不规范的写法：直接注册在 ctx 上，HMR 时会导致旧资源无法清理
      // ctx.tools.register('tool', myTool);

      // 规范的写法：必须包裹在 ctx.effect 中，返回 disposer 以便卸载时清理
      ctx.effect(() => {
        ctx.tools.register('tool', myTool);
        // 返回清理函数（disposer），HMR 卸载旧插件时自动执行
        return () => {
          ctx.tools.unregister('tool');
        };
      });
    }
    ```
*   **核心原则**：每个注册都应具备一个 disposer（通过 `ctx.effect` 返回或使用工具函数），这能确保卸载和重载的可预测性。
   
## 核心坑点与破解

*   **Timer 缺失导致死寂**：如果配置了 HMR 却不生效，检查是否在 `cordis.yml` 里漏掉了 `timer`。没有它，HMR 会因无法防抖而永远处于 PENDING 状态，且不报错。
*   **监控范围调优**：若你直接在目录内编译 TS 产物再通过 `link` 引用，需将编译目录也加入 HMR 的 `root` 数组（如 `root: ['.', './lib']`），确保保存产物时能触发监听。
*   **配置依赖**：修改 `cordis.yml` 本身也能热更新，但必须为插件行设置稳定的 `id`，否则配置一改就会全部重载。
*   **代码规范**：热重载的安全边际取决于你写了规范的 `ctx.effect`。每次注册（如 `ctx.tools.register`）必须包在 `ctx.effect` 里，这样才能保证卸载旧插件时清理干净，不会报错。

## 官方引用文件路径（重要：运用该机制前，先查证官方文档，确保满足条件）

为了方便 AI 检索原始文档，以下信息供参考：

| 模块 | 官方参考文件路径 |
| :--- | :--- |
| **后端 HMR 配置与机制** | `docs/cordis-tutorial/06-composition-and-hmr.md` |
| **前端 Client HMR 机制** | `packages/client/hmr/README.md` |
| **前端包结构说明** | `packages/client/README.md`  |
| **`ctx.effect` 规范与 Cordis 原则** | `docs/cordis-primer.md` 的 “Registrations are reversible effects” 章节  |
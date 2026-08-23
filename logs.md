# logs.md — Visual Workflow 开发日志（总览）

> 标准示例，AI 据此填写，每次任务作为项目上下文注入

**版本号通用规则**

- 版本（X.Y.Z）。含义如下：
  - 主版本号 (X)：做不兼容 API 修改时递增。注意： 主版本号为 0（如 0.x.x）代表项目处于开发初始阶段，接口随时可能改变，不算稳定版。此项目处于该阶段。
  - 次版本号 (Y)：向下兼容的功能性新增时递增。
  - 修订号 (Z)：向下兼容的 Bug 修复时递增。

## 2026.08.24

1. git版本：[3119869] [v0.1.0]
   - 完成：P02 挂载层+构建链路+模型资产+提示词基线（T-002/T-003/T-004/T-005）。
   - T-002：cordis.patch.yml 13 键（§2.2 实际为 13 键，文档"14 键"为笔误）+ src/host/index.ts 官方 Service 形态入口（z 取自 @deepseek-ai/schemastery，进 peerDependencies；清理用 ctx.effect 而非 ctx.on('dispose')）；真实 Loader 验证：工作区内临时 DSH_HOME + `dsh plugin add file:` + `--dump-config` 出现 visual-workflow 层且入口可 import。
   - T-003：tsdown 0.22.14 客户端构建（__ModuleLoader__ 包装/style[data-plugin]/purity gate/sourcemap/host-client 产物并存）+ client 声明发射 + client-smoke 冒烟；check/verify 脚本扩展；lightningcss 显式 devDep。
   - T-004：embedding-model.mjs 幂等资产脚本；assets/models/bge-small-zh-v1.5 齐备（tokenizer/配置 + onnx/model_quantized.onnx 24MB，Xenova 社区仓库经 hf-mirror 镜像获取——本机 huggingface.co 不可达且 BAAI 官方仓库无 onnx 目录；transformers.js v4 固定 onnx/ 子目录，真机加载验证通过）；manifest 含 sha256。
   - T-005：prompts 基线三构建器（编排指令/节点任务块/协作 Prompt），W-01 前缀稳定 + W-02 约束双位 + 动态值仅入尾段；段落标记下沉 markers.ts 消除循环 import（主代理收口时重构）。
   - 测试：50 用例全绿（新增 cordis-patch 9 + build-artifacts 5 + embedding-assets 6 + prompts-baseline 12）。
   - 变更标注：@deepseek-ai/schemastery 进 peer（共享运行时，非运行时依赖）；vitest --pool=threads（沙箱 pipe EPERM 规避）；`dsh plugin add` 需 profile 的 pnpm-workspace.yaml 设 allowBuilds=false 才能 reconcile bundles（T-064 注意）。

2. git版本：[87f4e0e] [v0.1.0]
   - 完成：P01 项目骨架与包配置（T-001）——package.json 插件契约（exports/files/dsh.bundle/dsh.client，零 @deepseek-ai/* 运行时依赖）、tsconfig.host/client 双 program、scripts/build.mjs（host tsc 双发射：JS→lib/ + 声明→lib/types/）、cordis/serve patch 占位、目录骨架、.gitignore/.gitattributes。
   - 完成：tests/host/package-contract.test.ts（18 用例）断言包契约与 W-05；vitest 使用 --pool=threads（沙箱下 forks 池 pipe EPERM 规避）。
   - 变更标注：@huggingface/transformers@^4.2.0 声明为唯一运行时依赖；其 onnxruntime 硬依赖的构建脚本经 pnpm-workspace.yaml allowBuilds=false 抑制，T-004/T-025 时再评估。

## 2026.08.17

1. git版本：[12a61b9] [v0.1.0]
   - 完成：三栏布局、DSH token、深浅色适配、节点配色、点阵背景、发光贝塞尔连线、圆形 handles、缩放控件、空画布引导。
   - ...

2. git版本：[版本前7位哈希] [插件版本号]
   - （完成的任务/修复的 bug/实现的功能）
   - （功能性重大变更请标注）

## 2026.08.16（日期倒序，最新的在最前）

3. git版本：[]
   - ...

---
> 下述日志已压缩（AI自动维护，根据每次最新读取时间，超时2天自动压缩过期日志，以此为界限，作为记录）
> 压缩状态：未压缩（压缩完成后更新）
> 压缩时间：2026.08.14

## 2026.08.12

4. git版本：[]
   - ...
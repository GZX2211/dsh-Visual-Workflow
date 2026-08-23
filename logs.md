# logs.md — Visual Workflow 开发日志（总览）

> 标准示例，AI 据此填写，每次任务作为项目上下文注入

**版本号通用规则**

- 版本（X.Y.Z）。含义如下：
  - 主版本号 (X)：做不兼容 API 修改时递增。注意： 主版本号为 0（如 0.x.x）代表项目处于开发初始阶段，接口随时可能改变，不算稳定版。此项目处于该阶段。
  - 次版本号 (Y)：向下兼容的功能性新增时递增。
  - 修订号 (Z)：向下兼容的 Bug 修复时递增。

## 2026.08.24

1. git版本：[87f4e0e] [v0.1.0]
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
# 跨进程接续守护程序 · 使用手册

## 用途

Agent 修改插件代码后，必须重启 harness 进程才能加载新代码。本套件把这件事做成一条命令的
无人值守闭环：

```
改代码 → pnpm check → 守护重启 harness → 会话恢复 → 定时任务唤醒 → 自动接续
```

守护进程由 Windows 计划任务 + wscript 启动，**脱离 harness 进程树**：harness 整体死亡时
它不受影响，因此能杀掉宿主再把宿主拉起来。

---

## 一键流程（新会话照做即可）

### 第 0 步 · 前置检查（改代码的场景）

- 在仓库执行 `pnpm check` 并通过（**否则重启后插件加载即崩，守护会陷入重启风暴退避**）。
- 确认没有其他会话正在跑编排：杀进程会中断它们（见文末「安全影响」）。

### 第 1 步 · 启动守护（幂等；已在运行会直接返回）

```powershell
pwsh -File <dir>\guardian.ps1 -Action Start
```

### 第 2 步 · 创建接续定时任务（**必须有**，否则重启后没有人继续干活）

用 `schedule_create`，延时 **≥ 150 秒**，prompt 中写清「重启后要接续执行的工作交接内容」。
示例骨架：

```
【守护重启 · 自动接续】harness 已由 guardian 重启，请勿重新规划，直接继续：
1) pwsh -File guardian\guardian.ps1 -Action Status   # 确认 harness RUNNING（新 pid）
2) 确认主进程启动时间晚于本次产物构建时间（证明新代码已加载）
3) 继续执行 <本次未完成的工作>
```

### 第 3 步 · 发起重启（一条命令；杀进程由守护自己完成）

```powershell
pwsh -File <dir>\guardian.ps1 -Action Restart              # 默认 T+20s 杀目标
pwsh -File <dir>\guardian.ps1 -Action Restart -DelaySec 40 # 需要更长缓冲时
```

不要自己写 `Stop-Process` / WMI / 延迟杀进程脚本——那需要处理「脱钩、PATH 不继承、
进程树连带、自身回合被打断」四个坑，而守护已经在正确的进程树里。

### 第 4 步 · 立即结束当前回合

当前回合同样属于被杀进程，**这是预期行为**；链路保障由第 2 步的定时任务承担。

---

## 时序（默认参数：poll=5s、restartDelay=20s、DelaySec=20s）

| 相对时刻 | 事件 |
|---|---|
| T+0 | 写入 `guardian.restart` 请求 |
| T+0 ~ +5s | 守护读到请求（轮询间隔 5s；日志 `restart request accepted`） |
| T+DelaySec ~ +（DelaySec+5）s | 守护杀掉主进程（日志 `RESTART REQUESTED: killing target pid …`） |
| 再 +restartDelay(20s) | 守护重新拉起 exe（日志 `restarting harness now`） |
| 再 +5~60s | 新主进程存活（日志 `target back alive (pid …)`）、会话恢复 |
| T+150s | 接续定时任务触发 → agent 继续 |

按默认值整体约 **T+50s 完成重启**（实测：`-DelaySec 8` 时 T+13s 杀、T+35s 拉起、T+40s 存活）。
因此：`schedule_create` 延时不小于 150 秒；`-DelaySec` 默认为 agent 结束回合留出 20 秒。

---

## 命令参考

```powershell
pwsh -File guardian.ps1 -Action Start              # 启动守护（幂等，重建计划任务）
pwsh -File guardian.ps1 -Action Status             # 状态 + 最近日志
pwsh -File guardian.ps1 -Action Restart            # 一键重启（守护延迟杀目标并自行拉起）
pwsh -File guardian.ps1 -Action Restart -DelaySec 40
pwsh -File guardian.ps1 -Action Stop               # 停止守护（同时注销计划任务；自动重启能力失效）
```

`Restart` 的前置条件：守护必须处于运行状态（否则报错并提示先 `Start`）——没有守护就没有
自动拉起能力，此时"重启"等于"关机"。

---

## 环境变量（可选）

- `DSH_GUARDIAN_TARGET_EXE` — 被守护的 exe 完整路径，默认 `D:\dsh\DeepSeek Harness.exe`
- `DSH_GUARDIAN_WORKDIR` — 进程工作目录，默认为 exe 所在目录

整个文件夹可拷贝到任意项目目录，路径全部从脚本所在目录推导。

---

## 本项目（dsh-visual-workflow）事实基线

本次自迭代沉淀的确定性事实，新会话可直接引用，无需重新探索：

- **插件挂载**：`%DSH_PROFILE_DIR%\node_modules\dsh-visual-workflow` 是指向本仓库根的
  **Junction** → 重启即加载本仓库 `lib/`（务必先 `pnpm build` 或 `pnpm check`）。
- **当前会话 id**：`$env:DSH_SESSION_ID`；**GUI API**：`POST $env:DSH_WEB_URL/visual-workflow/<endpoint>`，
  body 为 `{"args":{…}}`（端点名见 `src/host/shared/protocol.ts` 的 `EP_*`）。
- **主进程识别**：命令行恰好只有 exe 路径的那个；带 `--expose-internals` 的是 desktop-host
  （**不是它**），带 `--type=` 的是 Electron 子进程。
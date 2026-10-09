# guardian.ps1 — DeepSeek Harness 守护程序
# 功能：
#   1. 持续监控 DeepSeek Harness.exe 主GUI进程（精确匹配：命令行只有一个 exe 路径；
#      退而求其次：不含 --type= 与 --expose-internals 的进程）
#   2. 检测到进程消失后，等待 20 秒自动重启它
#   3. 控制模式：Start / Stop / Status / Restart
#      Restart = 由守护自己延迟杀死目标再拉起。为什么必须收在守护侧：守护经计划任务
#      启动、已脱离 harness 进程树，能杀掉宿主而自身存活；调用方若自行杀进程，就要
#      处理「脱钩（WMI/计划任务）/ PATH 不继承 / 进程树连带 / 自身回合被打断」等坑。
#      调用方只需发出请求，然后在延迟窗口内结束当前回合。
# 日志与状态文件均位于本目录（guardian.pid / guardian.log / guardian.stop / guardian.restart）

param(
    [string]$Role = 'guardian',   # 'guardian' = 守护循环；其他值 = 控制模式
    [string]$Action = '',         # 控制模式动作：Start | Stop | Status | Restart
    [int]$DelaySec = 20           # Restart 专用：请求后延迟多少秒杀目标（留给调用方结束回合）
)

$ErrorActionPreference = 'Stop'
# 所有「自身文件」路径从脚本所在目录推导 → 本文件夹可移到任意项目目录下使用
$dir            = $PSScriptRoot
$scriptPath     = Join-Path $dir 'guardian.ps1'
$pidFile        = Join-Path $dir 'guardian.pid'
$logFile        = Join-Path $dir 'guardian.log'
$stopFlag       = Join-Path $dir 'guardian.stop'
$restartFlag    = Join-Path $dir 'guardian.restart'
# 被守护对象（DeepSeek Harness 安装路径）通过环境变量可配置，未设置则用当前机器默认安装路径
$targetExe      = if ($env:DSH_GUARDIAN_TARGET_EXE) { $env:DSH_GUARDIAN_TARGET_EXE } else { 'D:\dsh\DeepSeek Harness.exe' }
$targetName     = [System.IO.Path]::GetFileName($targetExe)
$workDir        = if ($env:DSH_GUARDIAN_WORKDIR) { $env:DSH_GUARDIAN_WORKDIR } else { Split-Path $targetExe -Parent }
$pollSec        = 5
$restartDelaySec = 20
$taskName       = 'DSH-Guardian-Test'

function Write-Log {
    param([string]$msg)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -Path $logFile -Value "[$ts] $msg" -Encoding UTF8
}

# 找到 Harness 主GUI进程。判定顺序（从最严格到最宽松，绝不猜"看起来像"的进程）：
#   ① 命令行恰好只有 exe 路径（无任何参数）——标准 GUI 启动形态；
#   ② 退而求其次：无 --type=、无 --expose-internals、且命令行不含 .asar（排除 desktop-host /
#      工具子进程等托管入口，避免误杀）。两者都无命中时返回 $null（宁可不动作也不误杀）。
function Get-TargetProcess {
    $procs = Get-CimInstance Win32_Process -Filter "Name='$targetName'" -ErrorAction SilentlyContinue
    if (-not $procs) { return $null }
    $exact = @($procs | Where-Object { $_.CommandLine -and $_.CommandLine.Trim() -eq ('"{0}"' -f $targetExe) })
    if ($exact.Count -gt 0) { return $exact[0] }
    $main = @($procs | Where-Object {
        $_.CommandLine -and
        $_.CommandLine -notmatch '--type=' -and
        $_.CommandLine -notmatch '--expose-internals' -and
        $_.CommandLine -notmatch '\.asar'
    })
    if ($main.Count -gt 0) { return $main[0] }
    return $null
}

function Test-GuardianAlive {
    if (-not (Test-Path $pidFile)) { return $false }
    try {
        $gpid = [int](Get-Content $pidFile)
        return [bool](Get-Process -Id $gpid -ErrorAction SilentlyContinue)
    } catch { return $false }
}

function Exit-Guardian {
    param([string]$msg)
    if ($msg) { Write-Log $msg }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue
    Remove-Item $restartFlag -Force -ErrorAction SilentlyContinue
    schtasks /delete /tn $taskName /f *> $null
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    exit 0
}

# ---------------- 控制模式：Start / Stop / Status ----------------
if ($Action) {
    switch ($Action) {
        'Start' {
            if (Test-GuardianAlive) {
                Write-Output "guardian already running (pid $(Get-Content $pidFile))"
                exit 0
            }
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            # 清理上一次的残留旗标：否则新守护会立刻消费旧 stop/restart 请求（意外自杀或误重启）
            Remove-Item $pidFile, $stopFlag, $restartFlag -Force -ErrorAction SilentlyContinue
            $pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
            if (-not $pwshPath) { $pwshPath = 'pwsh' }
            # 生成（或刷新）VBS 隐藏启动器：wscript 无控制台窗口，
            # WshShell.Run 的 0（SW_HIDE）保证 pwsh 完全隐藏——桌面上无黑色窗口。
            # 注意：VBS 中不要给 pwsh 加 -Role/-WindowStyle 等额外参数，否则
            # WshShell.Run 会静默启动失败；脚本默认 Role=guardian 已满足需求。
            # 该 VBS 静态自定位（运行时从自身目录定位 guardian.ps1、调用 PATH
            # 中的 pwsh），因而含无硬编码路径，整个文件夹可复制到任意电脑/目录。
            $vbsPath = Join-Path $dir 'launch-hidden.vbs'
            $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
Dim scriptPath, q, cmd
q = Chr(34)
scriptPath = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1) & "\guardian.ps1"
cmd = "pwsh -NoProfile -ExecutionPolicy Bypass -File " & q & scriptPath & q
WshShell.Run cmd, 0, False
"@
            Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
            # 通过 Windows 计划任务启动：守护进程脱离 harness 进程树，
            # harness 整体死亡时守护程序不受影响（这是跨进程恢复的关键）
            $launched = $false
            try {
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                $taskAction = New-ScheduledTaskAction -Execute ($env:SystemRoot + '\System32\wscript.exe') -Argument "`"$vbsPath`""
                # ExecutionTimeLimit=0：守护是无限循环，计划任务默认 3 天执行上限会把它掐掉，
                # 之后自动重启能力静默失效（无任何报错）——必须显式取消上限。
                # RestartCount/RestartInterval：守护异常退出（被误杀/崩溃）时由计划任务拉起。
                $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
                    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
                Register-ScheduledTask -TaskName $taskName -Action $taskAction -Settings $taskSettings -Description 'DeepSeek Harness guardian (cross-process recovery test)' -Force | Out-Null
                Start-ScheduledTask -TaskName $taskName
                $tries = 0
                while ($tries -lt 30 -and -not (Test-GuardianAlive)) { Start-Sleep -Seconds 2; $tries++ }
                $launched = Test-GuardianAlive
            } catch { $launched = $false }
            if (-not $launched) {
                Write-Output "scheduled-task launch failed, falling back to wscript"
                Start-Process -FilePath ($env:SystemRoot + '\System32\wscript.exe') -ArgumentList "`"$vbsPath`""
                $tries = 0
                while ($tries -lt 30 -and -not (Test-GuardianAlive)) { Start-Sleep -Seconds 2; $tries++ }
            }
            if (Test-GuardianAlive) { Write-Output "guardian started (pid $(Get-Content $pidFile))" }
            else { Write-Output "guardian failed to start"; exit 1 }
        }
        'Stop' {
            if (-not (Test-GuardianAlive)) {
                Write-Output "guardian not running"
                Remove-Item $pidFile, $stopFlag, $restartFlag -Force -ErrorAction SilentlyContinue
                schtasks /delete /tn $taskName /f *> $null
                exit 0
            }
            $gpid = Get-Content $pidFile
            New-Item -ItemType File -Path $stopFlag -Force | Out-Null
            Write-Output "stop flag set; waiting for guardian (pid $gpid) to exit..."
            $waited = 0
            while ($waited -lt 30 -and (Get-Process -Id $gpid -ErrorAction SilentlyContinue)) {
                Start-Sleep -Seconds 2; $waited += 2
            }
            if (Get-Process -Id $gpid -ErrorAction SilentlyContinue) {
                Write-Output "guardian still running (pid $gpid)"
                exit 1
            }
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            Write-Output "guardian stopped; auto-restart capability disabled"
        }
        # 一键重启：只写请求文件，真正杀进程由守护自己执行（它已脱离 harness 进程树，
        # 杀宿主后自身存活，因而能完成「杀 → 等 → 拉起」闭环）。调用方（agent）必须在
        # DelaySec 秒内结束当前回合——本进程即将成为被杀目标的子进程，回合无法续跑。
        'Restart' {
            if (-not (Test-GuardianAlive)) {
                Write-Output "guardian NOT running; a restart would lose the auto-restart capability"
                Write-Output "run -Action Start first, then -Action Restart"
                exit 1
            }
            $t = Get-TargetProcess
            if (-not $t) {
                # 目标已不在：守护会自行把它拉起来（无需再杀），避免"重启"变成"再杀一次"
                Write-Output "target process is not running; guardian will bring it back on its own"
                exit 0
            }
            if ($DelaySec -lt 1) { $DelaySec = 1 }
            $req = [ordered]@{
                requestedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                delaySec    = $DelaySec
                targetPid   = $t.ProcessId
                requestedBy = "pid $PID"
            }
            ($req | ConvertTo-Json -Compress) | Set-Content -Path $restartFlag -Encoding UTF8
            Write-Output "restart requested: target pid $($t.ProcessId) will be killed in ${DelaySec}s, then relaunched by guardian"
            Write-Output "end the current turn now; a scheduled handoff reminder should wake the session after the restart"
        }
        'Status' {
            if (Test-GuardianAlive) {
                $gpid = Get-Content $pidFile
                $t = Get-TargetProcess
                if ($t) { Write-Output "guardian RUNNING (pid $gpid); harness RUNNING (pid $($t.ProcessId))" }
                else { Write-Output "guardian RUNNING (pid $gpid); harness NOT RUNNING" }
                if (Test-Path $restartFlag) { Write-Output "restart request PENDING (guardian will kill + relaunch the target shortly)" }
            } else {
                Write-Output "guardian NOT RUNNING"
            }
            if (Test-Path $logFile) { Write-Output '--- recent log ---'; Get-Content $logFile -Tail 15 }
        }
        default { Write-Output "unknown action: $Action (use Start|Stop|Status|Restart)"; exit 1 }
    }
    exit 0
}

# ---------------- 守护循环 ----------------
# 单实例检查
if (Test-Path $pidFile) {
    try {
        $existing = [int](Get-Content $pidFile)
        if ($existing -ne $PID -and (Get-Process -Id $existing -ErrorAction SilentlyContinue)) {
            Write-Log "another guardian (pid $existing) already running; this instance (pid $PID) exits"
            exit 0
        }
    } catch { }
}
$PID | Set-Content $pidFile -Encoding ASCII
Write-Log "guardian started (pid $PID); watching '$targetName' main GUI process; poll=${pollSec}s, restartDelay=${restartDelaySec}s"

# 等待首次发现目标
$seen = $false
while (-not $seen) {
    if (Test-Path $stopFlag) { Exit-Guardian "stop flag before initial sighting; exiting" }
    $t = Get-TargetProcess
    if ($t) { $seen = $true; Write-Log "target found alive (pid $($t.ProcessId)); monitoring active" }
    else { Write-Log "target not found yet; retrying in ${pollSec}s"; Start-Sleep -Seconds $pollSec }
}

# 最近成功发起重启的时刻（重启风暴抑制用：目标起不来时会反复「死→重启」，退避避免空转）
$recentRestarts = New-Object System.Collections.ArrayList

while ($true) {
    if (Test-Path $stopFlag) { Exit-Guardian "stop flag received; guardian shutting down (auto-restart capability disabled)" }

    # 主动重启请求（-Action Restart 写入）：守护脱钩于 harness 进程树，由它杀目标再拉起。
    # 先消费请求（删除文件），延迟期间仍响应 stop flag。
    if (Test-Path $restartFlag) {
        $delay = $restartDelaySec
        try {
            $req = Get-Content $restartFlag -Raw | ConvertFrom-Json
            $d = [int]$req.delaySec
            if ($d -ge 1) { $delay = $d }
        } catch { }
        Remove-Item $restartFlag -Force -ErrorAction SilentlyContinue
        Write-Log "restart request accepted; killing target in ${delay}s"
        $w = 0
        while ($w -lt $delay) {
            if (Test-Path $stopFlag) { Exit-Guardian "stop flag during restart delay; exiting WITHOUT restart" }
            Start-Sleep -Seconds 5; $w += 5
        }
        $rk = Get-TargetProcess
        if ($rk) {
            Write-Log "RESTART REQUESTED: killing target pid $($rk.ProcessId) (cmd: $($rk.CommandLine))"
            Stop-Process -Id $rk.ProcessId -Force -ErrorAction SilentlyContinue
        } else {
            Write-Log "RESTART REQUESTED: target already gone; proceeding to relaunch"
        }
    }

    $t = Get-TargetProcess
    if ($t) { Start-Sleep -Seconds $pollSec; continue }

    # 目标进程消失
    $diedAt = Get-Date
    Write-Log "TARGET PROCESS DEAD at $($diedAt.ToString('yyyy-MM-dd HH:mm:ss')); automatic restart in ${restartDelaySec}s"
    $waited = 0
    $cancel = $false
    while ($waited -lt $restartDelaySec) {
        if (Test-Path $stopFlag) { Exit-Guardian "stop flag during death-wait; exiting WITHOUT restart" }
        Start-Sleep -Seconds 5; $waited += 5
        $t2 = Get-TargetProcess
        if ($t2) { Write-Log "target reappeared on its own (pid $($t2.ProcessId)) after ${waited}s; restart cancelled"; $cancel = $true; break }
    }
    if ($cancel) { continue }
    if (Get-TargetProcess) { continue }

    # 重启风暴抑制：10 分钟内已重启 ≥3 次说明目标很可能起不来（例如插件加载即崩），
    # 退避 5 分钟再试，避免每 20 秒刷一次启动/日志；期间仍响应 stop flag。
    $now = Get-Date
    $recent = @($recentRestarts | Where-Object { ($now - $_).TotalMinutes -lt 10 })
    $recentRestarts.Clear(); $recent | ForEach-Object { [void]$recentRestarts.Add($_) }
    if ($recent.Count -ge 3) {
        Write-Log "RESTART STORM suspected ($($recent.Count) restarts within 10min); backing off 300s before next attempt"
        $w = 0
        while ($w -lt 300) {
            if (Test-Path $stopFlag) { Exit-Guardian "stop flag during storm backoff; exiting" }
            Start-Sleep -Seconds 10; $w += 10
        }
        $recentRestarts.Clear()
    }

    # 重启 harness
    Write-Log "restarting harness now: Start-Process '$targetExe' (working dir '$workDir')"
    try {
        Start-Process -FilePath $targetExe -WorkingDirectory $workDir
        [void]$recentRestarts.Add((Get-Date))
        Write-Log "restart command issued at $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
    } catch {
        Write-Log "restart FAILED: $($_.Exception.Message)"
    }
    $ap = 0
    while ($ap -lt 60) {
        Start-Sleep -Seconds 5; $ap += 5
        $t4 = Get-TargetProcess
        if ($t4) { Write-Log "target back alive (pid $($t4.ProcessId)); monitoring resumed"; break }
    }
}

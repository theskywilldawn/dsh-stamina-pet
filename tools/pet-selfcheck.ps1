# 大肥鱼 · 桌面层自检
#
# 目的：不猜。用真实鼠标事件验证「点她到底能不能收到」，并把每一层的真实状态打出来。
# 2026-10-28 建 —— 那天「点不动」反复出现四次，每次靠临时脚本才查出来，所以固化成命令。
#
# 用法：  大肥鱼自检.cmd                     （双击）
#         powershell -File pet-selfcheck.ps1 -TargetPid 1234
#         powershell -File pet-selfcheck.ps1 -NoClick      只看状态，不动鼠标
#
# 它做三件事：
#   1 查窗口的真实扩展样式（WS_EX_TRANSPARENT 到底还在不在，不采信插件自己的说法）
#   2 把光标移到她身上，再看一次样式 —— 这时应该是「不穿透」
#   3 真的按一下左键，然后看日志里有没有新的 down 记录

param(
  [int]$TargetPid = 0,
  [switch]$NoClick
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PetCheck {
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public struct POINT { public int X, Y; }
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@ -ErrorAction SilentlyContinue

function Say { param([string]$t) Write-Host $t }

Say "======== 大肥鱼 · 桌面层自检 ========"
Say "时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Say ""

# ---- 1. 找进程 ----
if (-not $TargetPid) {
  $p = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*dsh-stamina-pet*' } |
    Select-Object -First 1
  if (-not $p) {
    Say "[FAIL] 没找到桌面层进程（插件没启动，或者被杀还没拉起来）"
    exit 1
  }
  $TargetPid = $p.ProcessId
}
$proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
if (-not $proc) { Say "[FAIL] 进程 $TargetPid 不存在"; exit 1 }
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq 0) { Say "[FAIL] 进程 $TargetPid 没有主窗口"; exit 1 }

Say "进程：$TargetPid   窗口：$hwnd   启动于 $($proc.StartTime.ToString('HH:mm:ss'))"

$r = New-Object PetCheck+RECT
[void][PetCheck]::GetWindowRect($hwnd, [ref]$r)
Say "窗口矩形：($($r.Left),$($r.Top)) - ($($r.Right),$($r.Bottom))   $($r.Right - $r.Left)x$($r.Bottom - $r.Top)   可见=$([PetCheck]::IsWindowVisible($hwnd))"

# ---- 2. 读日志，拿她现在的命中框 ----
$log = Join-Path $env:USERPROFILE '.dsh\stamina-pet\desktop.log'
if (-not (Test-Path $log)) { Say "[FAIL] 日志不存在：$log"; exit 1 }

$lines = @(Get-Content $log -Tail 80 -Encoding UTF8)
$hit = $null
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
  if ($lines[$i] -match '第一块=\(([\d.\-]+),([\d.\-]+) ([\d.]+)x([\d.]+)\)') {
    $hit = @{ x = [double]$Matches[1]; y = [double]$Matches[2]; w = [double]$Matches[3]; h = [double]$Matches[4] }
    break
  }
}
if (-not $hit) {
  Say "[FAIL] 日志里没有命中框记录（页面没在上报？）"
  exit 1
}
$cx = [int]($hit.x + $hit.w / 2)
$cy = [int]($hit.y + $hit.h / 2)
Say "她的命中框：($($hit.x),$($hit.y)) $($hit.w)x$($hit.h)   中心 ($cx,$cy)"

$offRight = [math]::Max(0, ($hit.x + $hit.w) - $r.Right)
$offBottom = [math]::Max(0, ($hit.y + $hit.h) - $r.Bottom)
if ($offRight -gt 0 -or $offBottom -gt 0) {
  Say "  [注意] 命中框伸出屏幕：右 $([math]::Round($offRight))px、下 $([math]::Round($offBottom))px —— 她在屏幕边上，会有一半点不到"
}

# ---- 3. 静止状态 ----
$ex0 = [PetCheck]::GetWindowLongPtr($hwnd, -20).ToInt64()
$p0 = New-Object PetCheck+POINT
[void][PetCheck]::GetCursorPos([ref]$p0)
Say ""
Say "【静止】光标 ($($p0.X),$($p0.Y))   穿透位=$([bool]($ex0 -band 0x20))   置顶位=$([bool]($ex0 -band 0x8))"

# ---- 4. 光标移到她身上 ----
$mark = (Get-Item $log).Length
$oldX = $p0.X
$oldY = $p0.Y

Say ""
Say "【命中】把光标移到她身上 ($cx,$cy)，等 700ms..."
[void][PetCheck]::SetCursorPos($cx, $cy)
Start-Sleep -Milliseconds 700

$ex1 = [PetCheck]::GetWindowLongPtr($hwnd, -20).ToInt64()
$pen = [bool]($ex1 -band 0x20)
Say "  穿透位=$pen   （这里必须是 False，否则窗口还在吃穿透）"

$pt = New-Object PetCheck+POINT
$pt.X = $cx
$pt.Y = $cy
$who = [PetCheck]::WindowFromPoint($pt)
$pid2 = 0
[void][PetCheck]::GetWindowThreadProcessId($who, [ref]$pid2)
$cls = New-Object Text.StringBuilder 128
[void][PetCheck]::GetClassNameW($who, $cls, 128)
$ownWindow = (($who -eq $hwnd) -or ($pid2 -eq $TargetPid))
if ($ownWindow) {
  Say "  这个点归谁：hwnd=$who（就是大肥鱼自己，没被挡）"
} else {
  Say "  这个点归谁：hwnd=$who 进程=$pid2 class=$cls  [注意] 不是大肥鱼，被别的窗口挡住了"
}

# ---- 5. 真按一下 ----
$received = $false
if (-not $NoClick) {
  Say ""
  Say "【点击】模拟一次真实左键..."
  [PetCheck]::mouse_event(0x02, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [PetCheck]::mouse_event(0x04, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 900

  $fs = [System.IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
  try {
    [void]$fs.Seek($mark, 'Begin')
    $len2 = $fs.Length - $mark
    $newText = ''
    if ($len2 -gt 0) {
      $buf = New-Object byte[] $len2
      [void]$fs.Read($buf, 0, $len2)
      $newText = [Text.Encoding]::UTF8.GetString($buf)
    }
  } finally { $fs.Close() }

  if ($newText -match 'down ok') {
    $received = $true
    Say "  [OK] 页面收到了 pointerdown"
  } elseif ($newText -match 'down 落空') {
    Say "  [注意] 事件到了页面，但没命中她的 .av 元素（坐标对不上）"
  } elseif ($newText -match 'down 没找到') {
    Say "  [注意] 事件到了页面，但找不到对应角色"
  } else {
    Say "  [FAIL] 页面没收到任何 pointerdown"
  }
}

[void][PetCheck]::SetCursorPos($oldX, $oldY)

# ---- 6. 结论 ----
Say ""
Say "======== 结论 ========"
if ($NoClick) {
  if ($pen) { Say "[FAIL] 窗口在她身上时仍然是穿透的 —— 主进程没把穿透关掉" }
  elseif (-not $ownWindow) { Say "[FAIL] 窗口不穿透，但这个点被别的窗口挡住了" }
  else { Say "[OK] 窗口状态正常，点不点得动要再实测" }
} elseif ($received) {
  Say "[OK] 通过：点击能进入页面，交互链路是通的"
} elseif ($pen) {
  Say "[FAIL] 窗口还穿透着 —— 问题在「状态切换」这一层"
  Say "       看日志里 watch 那几行，确认 setIgnoreMouseEvents 有没有真的切过来"
} elseif (-not $ownWindow) {
  Say "[FAIL] 窗口不穿透，但被别的窗口（进程 $pid2）盖住了 —— 关掉或最小化它再试"
} else {
  Say "[WARN] 窗口完全正常，但点击就是进不去 —— Electron 层的输入路由问题"
  Say "       排查顺序："
  Say "       1) 有没有再用 setIgnoreMouseEvents 的 forward 参数（Windows 上会被别的软件抢）"
  Say "       2) 窗口是不是从没被激活过（focusable:false 的副作用）"
  Say "       3) 渲染进程是不是被 Chromium 判成「不可见」而丢弃输入"
}

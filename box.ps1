<#
  advisor-dev/box.ps1 — 旁边的小框（PowerShell + WinForms，置顶）。
  排版全部手算：标签固定宽度 + 按文本量高度，按钮按行折行，窗口大小由内容决定，
  然后贴回屏幕右上角。不用 TableLayoutPanel / 自动列宽那套互相打架的机制。

  用法：powershell.exe -STA -ExecutionPolicy Bypass -File advisor-dev\box.ps1
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $here 'state.json'
$routePath = Join-Path $here 'route.json'

$bg = [System.Drawing.Color]::FromArgb(11, 20, 20)
$fg = [System.Drawing.Color]::FromArgb(232, 224, 208)
$dim = [System.Drawing.Color]::FromArgb(150, 165, 160)
$hi = [System.Drawing.Color]::FromArgb(127, 224, 191)
$warn = [System.Drawing.Color]::FromArgb(240, 176, 120)
$ink = [System.Drawing.Color]::FromArgb(16, 26, 26)
$font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5)
$fontSmall = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)

$innerW = 360          # 文本宽度上限
$padX = 10
$rowH = 26             # 按钮行高

$form = New-Object System.Windows.Forms.Form
# 把自身 PID 写到 box.pid：启动器靠它判断「小框是否已经在跑」（比匹配命令行可靠，不会自我误判）
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'box.pid'), "$PID")
# 退出时删掉，免得下次启动以为还活着
$form.add_FormClosed({ [System.IO.File]::Delete((Join-Path $PSScriptRoot 'box.pid')) })
$form.Text = '抓取顾问'
$form.BackColor = $bg
$form.ForeColor = $fg
$form.TopMost = $true
$form.FormBorderStyle = 'FixedToolWindow'
$form.ShowInTaskbar = $true
$form.StartPosition = 'Manual'
$form.AutoSize = $false

function New-BoxLabel($fontObj, $color) {
  $l = New-Object System.Windows.Forms.Label
  $l.AutoSize = $false
  $l.Width = $innerW
  $l.Height = 0
  $l.Font = $fontObj
  $l.ForeColor = $color
  $l.Text = ''
  $form.Controls.Add($l)
  return $l
}

$lHead = New-BoxLabel $fontSmall $dim
$lMain = New-BoxLabel $font $hi
$lAdvice = New-BoxLabel $font $hi
$lPlace = New-BoxLabel $fontSmall $fg
$lHand = New-BoxLabel $fontSmall $dim
$lGap = New-BoxLabel $font $fg
$lShop = New-BoxLabel $font $fg
$lAux = New-BoxLabel $font $fg
$lRisk = New-BoxLabel $fontSmall $warn
# 自然语言建议块：state.json 的 nl[] 一句一行，整段放在这一个标签里（Set-Line 会按宽度折行算高）
$lNl = New-BoxLabel $font $fg
$labels = @($lHead, $lMain, $lAdvice, $lNl, $lPlace, $lHand, $lGap, $lShop, $lAux, $lRisk)

$coreBonds = [ordered]@{
  yanShip = '炎'; sargonShip = '萨尔贡'; victoriaShip = '维多利亚'; kjeragShip = '谢拉格'
  lateranoShip = '拉特兰'; egirShip = '阿戈尔'; siracusaShip = '叙拉古'; kazimierzShip = '卡西米尔'
}
$buttons = @()
$script:picked = $null
# 本局指纹（state.json 的 match，= 插件核心 matchKeyOf）：点选的主线带着它写进 route.json，换了局就清掉选中
$script:matchKey = $null
# 启动时 route.json 里的旧选择：先不认，等第一帧 match 对上了才用（上一局的选择不能带进这一局）
$script:savedRoute = $null

foreach ($id in $coreBonds.Keys) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $coreBonds[$id]
  $b.Font = $fontSmall
  $b.AutoSize = $true
  $b.AutoSizeMode = 'GrowAndShrink'
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 1
  $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(39, 73, 74)
  $b.BackColor = [System.Drawing.Color]::FromArgb(22, 38, 42)
  $b.ForeColor = $fg
  $b.Padding = New-Object System.Windows.Forms.Padding(5, 2, 5, 2)
  $b.Tag = $id
  $b.Add_Click({
    $script:picked = $this.Tag
    # match 为空（还没见过对局）时 overlay 不认这次选择，照样走自动主线
    $json = [ordered]@{ route = [string]$this.Tag; match = $script:matchKey } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($routePath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Paint-Route
  })
  $form.Controls.Add($b)
  $buttons += $b
}

function Paint-Route {
  foreach ($b in $buttons) {
    if ($b.Tag -eq $script:picked) { $b.BackColor = $hi; $b.ForeColor = $ink }
    else { $b.BackColor = [System.Drawing.Color]::FromArgb(22, 38, 42); $b.ForeColor = $fg }
  }
}

if (Test-Path $routePath) {
  try {
    $saved = [System.IO.File]::ReadAllText($routePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($saved.route -and $coreBonds.Contains($saved.route) -and $saved.match) { $script:savedRoute = $saved }
  } catch { }
}
Paint-Route

# 设置一行文本：固定宽度，按实际排版量高度（长文本自动换行，高度跟着长）
function Set-Line($label, $text, $color) {
  if (-not $text) {
    $label.Text = ''
    $label.Height = 0
    $label.Visible = $false
    return
  }
  $label.Visible = $true
  if ($color) { $label.ForeColor = $color }
  $label.Text = $text
  $g = $label.CreateGraphics()
  $size = $g.MeasureString($text, $label.Font, [Math]::Max(80, $label.Width - 4))
  $g.Dispose()
  $label.Height = [int][Math]::Ceiling($size.Height) + 3
}

# 逐个摆好标签与按钮，窗口按内容收缩/撑开，再贴到右上角
function Reflow {
  $y = 7
  foreach ($l in $labels) {
    if (-not $l.Visible -or $l.Height -le 0) { continue }
    $l.Left = $padX
    $l.Top = $y
    $y += $l.Height + 2
  }
  $y += 4
  $bx = $padX
  $by = $y
  $maxRight = $padX + 80
  foreach ($b in $buttons) {
    $bw = $b.PreferredSize.Width
    if ($bx -gt $padX -and ($bx + $bw) -gt ($padX + $innerW)) {
      $bx = $padX
      $by += $rowH + 3
    }
    $b.Left = $bx
    $b.Top = $by
    $bx += $bw + 4
    if (($bx - 4) -gt $maxRight) { $maxRight = $bx - 4 }
  }
  $contentH = $by + $rowH + 7
  $contentW = [Math]::Max(($maxRight + $padX), 240)
  $form.ClientSize = New-Object System.Drawing.Size($contentW, $contentH)

  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Left = $screen.Right - $form.Width - 14
  if ($form.Left -lt $screen.Left + 8) { $form.Left = $screen.Left + 8 }
  if ($form.Top + $form.Height -gt $screen.Bottom) { $form.Top = [Math]::Max($screen.Top + 8, $screen.Bottom - $form.Height - 8) }
}

$form.Add_Shown({ Reflow })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
  if (-not (Test-Path $statePath)) {
    Set-Line $lHead 'state.json 未找到 · 先跑 node advisor-dev\overlay.mjs --watch' $dim
    Set-Line $lMain '等待对局…' $hi
    Set-Line $lAdvice '' $hi ; Set-Line $lNl '' $fg ; Set-Line $lPlace '' $fg ; Set-Line $lHand '' $dim ; Set-Line $lGap '' $fg ; Set-Line $lShop '' $fg ; Set-Line $lAux '' $fg ; Set-Line $lRisk '' $warn
    Reflow
    return
  }
  $box = $null
  try { $box = [System.IO.File]::ReadAllText($statePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return }
  if (-not $box) { return }

  # 换了一局：清掉上一局的选中（下面的自动选中会按这一局的主线重选）；启动时读到的旧选择只在第一局对得上时才用
  if ($box.match -and [string]$box.match -ne $script:matchKey) {
    $script:matchKey = [string]$box.match
    $script:picked = $null
    if ($script:savedRoute -and [string]$script:savedRoute.match -eq $script:matchKey) { $script:picked = [string]$script:savedRoute.route }
    $script:savedRoute = $null
    Paint-Route
  }

  $age = [int](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) - $box.at)
  $stale = if ($age -gt 4000) { " · 数据 $age ms 旧" } else { '' }
  $headColor = if ($age -gt 4000) { $warn } else { $dim }

  if ($box.open) {
    $demoMark = if ($box.demo) { ' · 演示数据（非本局）' } else { '' }
    Set-Line $lHead ('开局决策' + $demoMark + $stale) $headColor
    $boss = 'BOSS 未知'
    if ($box.boss) {
      $tags = ''
      if ($box.boss.tags -and $box.boss.tags.Count) { $tags = ' · ' + ($box.boss.tags -join '/') }
      $boss = "BOSS $($box.boss.name) HP$($box.boss.hp) DEF$($box.boss.def) RES$($box.boss.res)$tags"
    }
    Set-Line $lMain $boss $hi
    $bans = if ($box.bans.drawn.Count) { '禁用 ' + ($box.bans.drawn -join '/') } else { '没有禁用核心' }
    Set-Line $lGap ($bans + ' · 可用 ' + $box.ranking.Count + ' 条') $fg
    $rank = ($box.ranking | Select-Object -First 3 | ForEach-Object -Begin { $i = 0 } -Process { $i++; "$i)$($_.name)" }) -join ' '
    Set-Line $lShop ('建议 ' + $(if ($rank) { $rank } else { '无可用核心' })) $fg
    $bandText = if ($box.bands.Count) { '策略 ' + $box.bands[0].name } else { '策略 —' }
    if ($box.bands.Count -gt 1) {
      $alt = ($box.bands | Select-Object -Skip 1 -First 2 | ForEach-Object { $_.name }) -join ' / '
      $bandText = $bandText + ' · 备选 ' + $alt
    }
    if ($box.bands.Count -and $box.bands[0].conflict) { $bandText = $bandText + ' · ' + $box.bands[0].conflict }
    Set-Line $lAux $bandText $fg
    if ($box.loadout -and $box.loadout.diy.Count) {
      $diy = ($box.loadout.diy -join '/')
      $sk = ''
      if ($box.loadout.skill.Count) { $sk = ' · ' + (($box.loadout.skill | Select-Object -First 2 | ForEach-Object { $_.name + ':' + $_.skill }) -join '，') }
      Set-Line $lRisk ('调配 自选 ' + $diy + $sk) $fg
    } elseif ($box.pick -and $box.pick.entryRisk) { Set-Line $lRisk ('提醒：' + $box.pick.entryRisk) $warn }
    else { Set-Line $lRisk '' $warn }
    Reflow
    return
  }

  if ($box.text) {
    Set-Line $lHead ("抓取顾问 · $age ms 前" + $stale) $headColor
    Set-Line $lMain $box.text $hi
    Set-Line $lAdvice '' $hi ; Set-Line $lNl '' $fg ; Set-Line $lPlace '' $fg ; Set-Line $lHand '' $dim ; Set-Line $lGap '' $fg ; Set-Line $lShop '' $fg ; Set-Line $lAux '' $fg ; Set-Line $lRisk '' $warn
    Reflow
    return
  }

  $est = if ($box.est.low -eq $box.est.high) { "成 $($box.est.high) 人 $($box.est.pHigh)%" }
         else { "成 $($box.est.low) 人 $($box.est.pLow)% / $($box.est.high) 人 $($box.est.pHigh)%" }
  $next = if ($box.main.next) { "/$($box.main.next)" } else { '' }
  $estShort = if ($box.est.low -eq $box.est.high) { "成$($box.est.high)人$($box.est.pHigh)%" } else { "成$($box.est.low)/$($box.est.high)人" }
  $layerText = if ($box.main.layers -gt 0) { " · $($box.main.layers)层×$($box.main.mult)" } else { '' }
  # 一行说清局面：回合/钱/主线进度/倍率/成牌率
  Set-Line $lHead ("R$($box.round) · $($box.funds)金 · LP$($box.lp) · $($box.main.name) $($box.main.count)$next$layerText · $estShort" + $(if ($box.main.pivoted) { ' · 跟你的线' } else { '' }) + $stale) $headColor
  Set-Line $lMain '' $hi
  # ── 自然语言建议：state.json 的 nl[] 一句一行，说完就收（下面那堆电报体是旧数据的兜底） ──
  if ($box.nl -and $box.nl.Count -gt 0) {
    Set-Line $lNl ($box.nl -join [Environment]::NewLine) $fg
    Set-Line $lAdvice '' $hi
    Set-Line $lPlace '' $fg
    Set-Line $lHand '' $dim
    Set-Line $lGap '' $fg
    Set-Line $lShop '' $fg
    Set-Line $lAux '' $fg
    Set-Line $lRisk '' $warn
    if (-not $script:picked -and $box.main.id) { $script:picked = $box.main.id; Paint-Route }
    Reflow
    return
  }
  Set-Line $lNl '' $fg
  # 抓谁（带理由）
  if ($box.advice) { Set-Line $lAdvice ('抓 → ' + ($box.advice -replace '^抓\s*','')) $hi } else { Set-Line $lAdvice '抓 → 等刷新' $hi }
  # 怎么放（顺带说这一抓换什么：层数/金币/免费刷新，投资人倍率已含）
  if ($box.pick -and $box.pick.place) {
    $placeText = '放 → ' + $box.pick.name + '：' + $box.pick.place
    if ($box.pickGain) { $placeText = $placeText + ' · 换 ' + $box.pickGain }
    Set-Line $lPlace $placeText $fg
  } else { Set-Line $lPlace '' $fg }
  Set-Line $lHand ('手牌 ' + $(if ($box.hand -and $box.hand.Count) { ($box.hand -join ' ') } else { '空' })) $dim
  $gapText = '缺口 ' + $(if ($box.gap.Count) { ($box.gap -join ' · ') } else { '路线已齐' })
  if ($box.addonLine) { $gapText = $gapText + ' · 小盟约 ' + $box.addonLine }
  Set-Line $lGap $gapText $fg
  # 商店：先拼字符串再显示（在 Set-Line 里嵌复杂管道容易静默失败）
  $shopText = '空'
  if ($box.shop -and $box.shop.Count -gt 0) {
    $parts = @()
    foreach ($it in $box.shop) {
      $mark = ''
      if ($it.key) { $mark = '★本家' }
      elseif ($it.route) { $mark = '·本家' }
      elseif (-not $it.item) { $mark = '·外' }
      $parts += ('{0} {1}{2} {3}金 {4}' -f $it.tag, $it.name, $mark, $it.price, $it.score)
    }
    $shopText = ($parts -join '  ')
  }
  Set-Line $lShop ('商店 ' + $shopText) $fg
  if ($box.terminal) { Set-Line $lPlace ('终端 → ' + $box.terminal.line) $hi }
  $aux = '—'
  if ($box.assist) {
    $aux = "$($box.assist.name) $($box.assist.count)"
    if ($box.assist.next) { $aux = $aux + '/' + $box.assist.next }
  }
  if ($box.dual.Count) { $aux = $aux + ' · 双叠 ' + ($box.dual -join '/') }
  # 人数档位：6 人档给什么、9 人档给什么（引擎实测，见 routes/_tiers.json）
  if ($box.tierLine) { $aux = $aux + ' · ' + $box.tierLine }
  if ($box.tierOdds) { $aux = $aux + '（成约' + $box.tierOdds.p + '%）' }
  if ($box.stackPlace) { $aux = $aux + ' · ' + $box.stackPlace + '放前排1格' }
  Set-Line $lAux ("辅叠 $aux") $fg
  # 悬赏（机变）优先占「放」那一行；否则显示下一波怪的预警
  if ($box.bounty -and $box.bounty.best -and $box.bounty.best.Count) {
    $bs = @()
    foreach ($c in $box.bounty.best) { $bs += ('{0}({1})' -f $c.name, $c.score) }
    $lbl = $(if ($box.bounty.label) { $box.bounty.label + ' ' } else { '' })
    Set-Line $lPlace ($lbl + '悬赏拿 ' + ($bs -join ' / ')) $hi
  }
  $riskText = ''
  if ($box.wave -and $box.wave.text) { $riskText = $box.wave.text }
  if ($box.usage) { $u = $box.usage; if ($u.Length -gt 42) { $u = $u.Substring(0,42) + '…' }; if ($riskText) { $riskText += ' · ' + $u } else { $riskText = $u } }
  if ($box.armor) { if ($riskText) { $riskText += ' · ' + $box.armor.line } else { $riskText = $box.armor.line } }
  Set-Line $lRisk $riskText $warn

  # ── 操作清单：一次列全，不一条条挤（每行 ≤12 字） ──
  if ($box.plan -and $box.plan.Count) {
    Set-Line $lAdvice (($box.plan | Select-Object -First 4) -join [Environment]::NewLine) $hi
    Set-Line $lPlace  (($box.plan | Select-Object -Skip 4) -join [Environment]::NewLine) $fg
    Set-Line $lHand '' $dim
    Set-Line $lGap '' $fg
    Set-Line $lShop '' $fg
    Set-Line $lAux '' $fg
    $risk3 = ''
    if ($box.armor -and $box.armor.lpr -ge 10) { $risk3 = '漏一只-' + $box.armor.lpr + 'LP' }
    elseif ($box.wave) { $risk3 = $box.wave.text }
    Set-Line $lRisk $risk3 $warn
  }
  # ── 极简五行（每项不超过十个字）：抓谁 / 配谁 / 下步 / 冻否 / 组谁 ──
  if ($box.compact -and -not ($box.plan -and $box.plan.Count)) {
    $c = $box.compact
    Set-Line $lAdvice $c.pick $hi
    Set-Line $lPlace  $c.partner $fg
    Set-Line $lHand   $c.next $fw
    Set-Line $lGap    $c.group $fg
    $risk2 = $c.freeze
    if ($box.armor -and $box.armor.lpr -ge 10) { $risk2 = $risk2 + ' · 漏一只-' + $box.armor.lpr + 'LP' }
    Set-Line $lRisk $risk2 $warn
    Set-Line $lShop '' $fg
    Set-Line $lAux '' $fg
  }

  if (-not $script:picked -and $box.main.id) { $script:picked = $box.main.id; Paint-Route }
  Reflow
})
$timer.Start()

[void]$form.ShowDialog()

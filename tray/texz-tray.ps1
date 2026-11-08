# Texz tray icon: shows if the bot is online and lets you start, stop, restart and update it
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $root 'texz.log'
$aliveFile = Join-Path $root '.alive'
$settingsFile = Join-Path $PSScriptRoot 'settings.json'
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Texz.lnk'

# only one tray at a time
$mutex = New-Object System.Threading.Mutex($false, 'texz-tray')
if (-not $mutex.WaitOne(0)) { exit }

$settings = [pscustomobject]@{ botOn = $true; autoUpdate = $true; lastUpdateCheck = '' }
$firstRun = -not (Test-Path $settingsFile)
if (-not $firstRun) {
  $saved = Get-Content $settingsFile -Raw | ConvertFrom-Json
  foreach ($p in $saved.PSObject.Properties) { $settings | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force }
}
function Save-Settings { $settings | ConvertTo-Json | Set-Content $settingsFile }

function Write-Log($text) { Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $text" }

# small coloured dots for the tray
function New-Dot($color) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#14161c'))), 0, 0, 15, 15)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))), 3, 3, 9, 9)
  $g.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$icons = @{ online = New-Dot '#3ba55d'; stuck = New-Dot '#f0a232'; off = New-Dot '#8b8f9a' }

$script:proc = $null
$script:startedAt = $null
$script:crashes = 0
$script:watchUntil = $null
$script:rollbackTo = $null

function Stop-Strays {
  # anything left from older launchers or a previous tray
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dist[\\/]index\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'texz-run\.bat' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-Bot {
  if ($script:proc -and -not $script:proc.HasExited) { return }
  $psi = New-Object System.Diagnostics.ProcessStartInfo 'cmd.exe', '/c node --env-file=.env dist/index.js >> texz.log 2>&1'
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $script:proc = [System.Diagnostics.Process]::Start($psi)
  $script:startedAt = Get-Date
  Write-Log 'texz started from the tray'
}

function Stop-Bot {
  if ($script:proc -and -not $script:proc.HasExited) { & taskkill /PID $script:proc.Id /T /F | Out-Null }
  $script:proc = $null
  Stop-Strays
  Remove-Item $aliveFile -ErrorAction SilentlyContinue
}

function Invoke-Step($what, [scriptblock]$step) {
  Push-Location $root
  try { & $step 2>&1 | Out-File -Append -FilePath $logFile -Encoding utf8; return $LASTEXITCODE -eq 0 }
  catch { Write-Log "$what failed: $_"; return $false }
  finally { Pop-Location }
}

function Build-And-Deploy {
  if (-not (Invoke-Step 'build' { npm.cmd run build })) { return $false }
  Invoke-Step 'deploy' { npm.cmd run deploy } | Out-Null
  return $true
}

function Show-Tip($text) { $tray.ShowBalloonTip(4000, 'Texz', $text, 'None') }

function Update-Bot([bool]$quiet) {
  $settings.lastUpdateCheck = (Get-Date).ToString('o'); Save-Settings
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { if (-not $quiet) { Show-Tip 'Git is not installed, so I cannot update.' }; return }
  Push-Location $root
  git fetch --quiet origin main 2>$null
  $here = (git rev-parse HEAD).Trim()
  $there = (git rev-parse origin/main 2>$null).Trim()
  Pop-Location
  if (-not $there -or $here -eq $there) { if (-not $quiet) { Show-Tip 'Already on the newest version.' }; return }
  Push-Location $root
  $lockBefore = (git rev-parse HEAD:package-lock.json).Trim()
  git merge --ff-only --quiet origin/main 2>$null
  $merged = $LASTEXITCODE -eq 0
  $lockAfter = (git rev-parse HEAD:package-lock.json).Trim()
  Pop-Location
  if (-not $merged) { Show-Tip 'Update skipped, the local copy has its own changes.'; Write-Log 'update skipped, local changes'; return }
  Write-Log "updating $($here.Substring(0,7)) -> $($there.Substring(0,7))"
  if ($lockBefore -ne $lockAfter) { Invoke-Step 'install' { npm.cmd install --no-audit --no-fund } | Out-Null }
  Stop-Bot
  if (-not (Build-And-Deploy)) { Undo-Update $here 'the build failed'; return }
  if ($settings.botOn) { Start-Bot }
  # a version that crashes in its first minute gets rolled back
  $script:watchUntil = (Get-Date).AddSeconds(60)
  $script:rollbackTo = $here
  Show-Tip 'Updated to the newest version.'
}

function Undo-Update($to, $why) {
  Write-Log "rolling back to $($to.Substring(0,7)): $why"
  Stop-Bot
  Push-Location $root; git reset --hard --quiet $to; Pop-Location
  Build-And-Deploy | Out-Null
  if ($settings.botOn) { Start-Bot }
  $script:watchUntil = $null
  Show-Tip "The update broke something ($why), went back to the last working version."
}

# ---------- tray and menu ----------

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icons.off
$tray.Text = 'Texz'
$tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$status = $menu.Items.Add('Texz')
$status.Enabled = $false
$menu.Items.Add('-') | Out-Null
$toggle = $menu.Items.Add('Turn off')
$toggle.add_Click({
  $settings.botOn = -not $settings.botOn; Save-Settings
  if ($settings.botOn) { $script:crashes = 0; Start-Bot } else { Stop-Bot; Write-Log 'texz turned off from the tray' }
})
$restart = $menu.Items.Add('Restart')
$restart.add_Click({ Stop-Bot; $settings.botOn = $true; Save-Settings; Start-Bot })
$rebuild = $menu.Items.Add('Rebuild and restart')
$rebuild.add_Click({ Stop-Bot; if (Build-And-Deploy) { Show-Tip 'Rebuilt.' } else { Show-Tip 'Build failed, see the log.' }; if ($settings.botOn) { Start-Bot } })
$menu.Items.Add('-') | Out-Null
$startup = $menu.Items.Add('Start with Windows')
$startup.CheckOnClick = $true
function Set-Startup([bool]$on) {
  if ($on) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($startupLink)
    $lnk.TargetPath = 'wscript.exe'
    $lnk.Arguments = '"' + (Join-Path $PSScriptRoot 'texz-tray.vbs') + '"'
    $lnk.WorkingDirectory = $root
    $lnk.Save()
  } else { Remove-Item $startupLink -ErrorAction SilentlyContinue }
}
# the first run turns startup on, after that it's whatever the tick says
if ($firstRun) { Set-Startup $true; Save-Settings }
$startup.Checked = Test-Path $startupLink
$startup.add_Click({ Set-Startup $startup.Checked })
$auto = $menu.Items.Add('Auto update')
$auto.CheckOnClick = $true
$auto.Checked = [bool]$settings.autoUpdate
$auto.add_Click({ $settings.autoUpdate = $auto.Checked; Save-Settings })
$check = $menu.Items.Add('Check for updates now')
$check.add_Click({ Update-Bot $false })
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Open log').add_Click({ Start-Process notepad.exe $logFile })
$menu.Items.Add('Open folder').add_Click({ Start-Process explorer.exe $root })
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Quit (stops Texz)').add_Click({ Stop-Bot; $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ if ($_.Button -eq 'Left') { $menu.Show([System.Windows.Forms.Cursor]::Position) } })

# ---------- the heartbeat check ----------

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  $running = $script:proc -and -not $script:proc.HasExited
  if ($settings.botOn -and -not $running) {
    if ($script:watchUntil -and (Get-Date) -lt $script:watchUntil -and $script:rollbackTo) { Undo-Update $script:rollbackTo 'it crashed on start'; return }
    $script:crashes++
    # back off a little if it keeps falling over
    if ($script:crashes -le 5 -or ($script:crashes % 6) -eq 0) { Write-Log 'texz was not running, starting it'; Start-Bot }
  }
  if ($script:watchUntil -and (Get-Date) -gt $script:watchUntil) { $script:watchUntil = $null; $script:crashes = 0 }
  $beat = 0
  $offline = $false
  if (Test-Path $aliveFile) {
    $raw = (Get-Content $aliveFile -Raw).Trim()
    # "offline:<time>" means the bot is fine but the internet isn't
    if ($raw.StartsWith('offline:')) { $offline = $true; $raw = $raw.Substring(8) }
    [long]::TryParse($raw, [ref]$beat) | Out-Null
  }
  $fresh = $beat -gt 0 -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $beat) -lt 75000
  if (-not $settings.botOn -or -not $running) { $tray.Icon = $icons.off; $status.Text = 'Texz is off'; $tray.Text = 'Texz · off' }
  elseif ($fresh -and $offline) { $tray.Icon = $icons.stuck; $status.Text = 'Texz is waiting for the internet'; $tray.Text = 'Texz · offline' }
  elseif ($fresh) {
    $up = (Get-Date) - $script:startedAt
    $since = if ($up.TotalHours -ge 1) { '{0}h {1}m' -f [int][math]::Floor($up.TotalHours), $up.Minutes } else { '{0}m' -f [int]$up.TotalMinutes }
    $tray.Icon = $icons.online; $status.Text = "Texz is online · $since"; $tray.Text = "Texz · online $since"
  }
  else { $tray.Icon = $icons.stuck; $status.Text = 'Texz is starting or stuck'; $tray.Text = 'Texz · starting' }
  $toggle.Text = if ($settings.botOn) { 'Turn off' } else { 'Turn on' }
  # once a day, if auto update is on
  if ($settings.autoUpdate) {
    $last = [datetime]::MinValue
    [datetime]::TryParse([string]$settings.lastUpdateCheck, [ref]$last) | Out-Null
    if ((Get-Date) - $last -gt [TimeSpan]::FromHours(24)) { Update-Bot $true }
  }
})

Stop-Strays
if ($settings.botOn) { Start-Bot }
$timer.Start()
[System.Windows.Forms.Application]::Run()

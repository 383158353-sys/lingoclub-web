param([switch]$InstallStartup)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $ProjectRoot 'logs'
$CloudflaredConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
$LocalEnv = Join-Path $ProjectRoot '.env.local'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if ($InstallStartup) {
  $startupDir = [Environment]::GetFolderPath('Startup')
  $shortcutPath = Join-Path $startupDir 'LingoClub Dev Test.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.WindowStyle = 7
  $shortcut.Save()
  Write-Output 'Windows login startup shortcut configured for the current user.'
}

function Get-LocalDevHost {
  if (-not (Test-Path -LiteralPath $LocalEnv)) { return '' }
  $match = Select-String -LiteralPath $LocalEnv -Pattern '^\s*LINGOCLUB_DEV_HOST\s*=\s*(.+?)\s*$' | Select-Object -First 1
  if (-not $match) { return '' }
  return $match.Matches[0].Groups[1].Value.Trim().Trim('"', "'")
}

$listeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run dev:test' -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'vite-dev.log') -RedirectStandardError (Join-Path $LogDir 'vite-dev-error.log') | Out-Null
}

$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2 -UseBasicParsing
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw 'Vite did not become ready at http://127.0.0.1:5173/; inspect logs/vite-dev-error.log.' }

Write-Output 'LingoClub Vite is ready at http://127.0.0.1:5173/.'
Write-Output 'LAN access uses the computer Wi-Fi IPv4 address on port 5173.'

$cloudflared = Get-Command 'cloudflared' -ErrorAction SilentlyContinue
$devHost = Get-LocalDevHost
if (-not $cloudflared -or -not (Test-Path -LiteralPath $CloudflaredConfig) -or -not $devHost) {
  Write-Warning 'Fixed public tunnel not started. Install/authenticate cloudflared, configure a named tunnel for an owned Cloudflare DNS hostname, and set LINGOCLUB_DEV_HOST in .env.local.'
  exit 2
}

$runningTunnel = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*tunnel*run*' -and $_.CommandLine -like '*config.yml*' } | Select-Object -First 1
if (-not $runningTunnel) {
  Start-Process -FilePath $cloudflared.Source -ArgumentList @('tunnel', '--config', $CloudflaredConfig, 'run') `
    -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir 'cloudflared.log') `
    -RedirectStandardError (Join-Path $LogDir 'cloudflared-error.log') | Out-Null
}

Write-Output "Fixed tunnel launch requested for https://$devHost/."

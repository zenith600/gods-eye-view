<#
.SYNOPSIS
    Start the God's Eye View dev server and open it in a browser.

.DESCRIPTION
    The Windows counterpart to scripts/dev-fresh.sh. Intended to sit behind a
    desktop shortcut, so it is written to survive being double-clicked by
    someone who is not watching a terminal:

      * If a server is already answering on the target port, it opens a browser
        at that port instead of starting a second one. Vite's port is NOT
        strictPort (see the server block in vite.config.js), so a blind second
        launch would silently bind 4174 and leave two servers running.
      * It reads the actual port back out of Vite's banner rather than assuming
        4173, for the same reason.
      * It prefers Chrome when installed. On hybrid-graphics laptops the
        browser's GPU assignment is worth ~11x on this app (see
        docs/PERFORMANCE.md), and that assignment is stored per executable, so
        which browser opens is a performance decision and not a cosmetic one.
      * It stops the server it started when the window closes.

    Written against Windows PowerShell 5.1: no ternary, null-coalescing, or
    pipeline chain operators.

.PARAMETER Port
    Port to serve on. Defaults to 4173, matching vite.config.js.

.PARAMETER NoBrowser
    Start the server but do not open a browser.
#>
[CmdletBinding()]
param(
    [int]$Port = 4173,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($message) { Write-Host "  $message" -ForegroundColor Cyan }
function Write-Warn($message) { Write-Host "  $message" -ForegroundColor Yellow }
function Write-Bad($message)  { Write-Host "  $message" -ForegroundColor Red }

Write-Host ""
Write-Host "  GOD'S EYE VIEW" -ForegroundColor Cyan
Write-Host "  $repoRoot" -ForegroundColor DarkGray
Write-Host ""

# Fast, non-blocking liveness probe. Test-NetConnection takes seconds on a
# closed port, which is the common case on a cold launch.
#
# Both address families must be probed. Vite's host is 'localhost', which
# resolves to the IPv6 loopback on Windows and binds [::1] ONLY, so an
# IPv4-only probe reports a live server as absent and the launcher then starts
# a second one on port+1. That is not hypothetical: it is what this function
# did before the fix.
function Test-PortOpen([int]$portNumber) {
    foreach ($address in @('::1', '127.0.0.1')) {
        $client = $null
        try {
            $ip = [System.Net.IPAddress]::Parse($address)
            # The parameterless TcpClient ctor is IPv4-only on .NET Framework,
            # so the family has to be chosen per address.
            $client = New-Object System.Net.Sockets.TcpClient($ip.AddressFamily)
            $async = $client.BeginConnect($ip, $portNumber, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(400)) {
                $client.EndConnect($async)
                return $true
            }
        } catch {
            # Connection refused / no route / family unsupported: try the next.
        } finally {
            if ($null -ne $client) { $client.Close() }
        }
    }
    return $false
}

function Open-Browser([string]$url) {
    $chromePaths = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($chrome in $chromePaths) {
        if (Test-Path $chrome) {
            Write-Step "Opening Chrome at $url"
            Start-Process -FilePath $chrome -ArgumentList $url | Out-Null
            return
        }
    }
    Write-Step "Opening default browser at $url"
    Start-Process $url | Out-Null
}

# --- Already running? --------------------------------------------
if (Test-PortOpen $Port) {
    Write-Step "A server is already listening on port $Port; reusing it."
    if (-not $NoBrowser) { Open-Browser "http://localhost:$Port/" }
    Write-Host ""
    Write-Host "  This window did not start that server, so closing it leaves the" -ForegroundColor DarkGray
    Write-Host "  server running. Stop it in the window that owns it." -ForegroundColor DarkGray
    Write-Host ""
    Start-Sleep -Seconds 4
    exit 0
}

# --- Toolchain ---------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Bad 'Node.js was not found on PATH.'
    Write-Host '  Install Node 24.14+ or 26.x from https://nodejs.org, then run this again.'
    Read-Host '  Press Enter to close'
    exit 1
}
$nodeVersion = (& node -v).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
$nodeMinor = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 24 -or ($nodeMajor -eq 24 -and $nodeMinor -lt 14)) {
    Write-Warn "Node $nodeVersion is below the supported 24.14 (npm run doctor will flag it)."
    Write-Warn 'Starting anyway; Vite itself runs on this version.'
} else {
    Write-Step "Node $nodeVersion"
}

$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
if ($null -eq $npmCmd) {
    Write-Bad 'npm was not found on PATH.'
    Read-Host '  Press Enter to close'
    exit 1
}

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Write-Warn 'Dependencies are missing. Running npm ci (this takes a few minutes)...'
    Push-Location $repoRoot
    try {
        & $npmCmd.Source 'ci'
        if ($LASTEXITCODE -ne 0) {
            Write-Bad "npm ci failed with exit code $LASTEXITCODE."
            Read-Host '  Press Enter to close'
            exit 1
        }
    } finally {
        Pop-Location
    }
}

# --- Start Vite --------------------------------------------------
$logDir = Join-Path $env:LOCALAPPDATA 'GodsEyeView'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$outLog = Join-Path $logDir 'dev-server.out.log'
$errLog = Join-Path $logDir 'dev-server.err.log'
foreach ($f in @($outLog, $errLog)) { Set-Content -Path $f -Value '' -Encoding utf8 }

Write-Step "Starting the dev server on port $Port..."
$env:PORT = "$Port"
$server = Start-Process -FilePath $npmCmd.Source -ArgumentList 'run', 'dev' `
    -WorkingDirectory $repoRoot -NoNewWindow -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

try {
    # Vite prints "Local:   http://localhost:<port>/" once it is serving. Read
    # the port back rather than trusting $Port: without strictPort, Vite silently
    # moves to the next free port and a hardcoded URL would open nothing.
    $resolvedUrl = $null
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if ($server.HasExited) { break }
        $text = (Get-Content -Path $outLog -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
        if ($text -match 'https?://localhost:(\d+)') {
            $resolvedUrl = "http://localhost:$($Matches[1])/"
            break
        }
        Start-Sleep -Milliseconds 300
    }

    if ($null -eq $resolvedUrl) {
        Write-Bad 'The dev server did not report a URL.'
        Write-Host "  --- stdout ---"; Get-Content $outLog -Tail 25 -Encoding UTF8 -ErrorAction SilentlyContinue
        Write-Host "  --- stderr ---"; Get-Content $errLog -Tail 25 -Encoding UTF8 -ErrorAction SilentlyContinue
        Read-Host '  Press Enter to close'
        exit 1
    }

    Write-Host ""
    Write-Host "  Serving at $resolvedUrl" -ForegroundColor Green
    if (-not $NoBrowser) { Open-Browser $resolvedUrl }
    Write-Host ""
    Write-Host "  Keep this window open. Press Ctrl+C or close it to stop the server." -ForegroundColor DarkGray
    Write-Host "  ------------------------------------------------------------------" -ForegroundColor DarkGray

    # Tail the server log into this window so failures are visible.
    $sent = 0
    while (-not $server.HasExited) {
        $lines = @(Get-Content -Path $outLog -Encoding UTF8 -ErrorAction SilentlyContinue)
        if ($lines.Count -gt $sent) {
            $lines[$sent..($lines.Count - 1)] | ForEach-Object { Write-Host $_ }
            $sent = $lines.Count
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Warn "The dev server exited with code $($server.ExitCode)."
    Get-Content $errLog -Tail 20 -Encoding UTF8 -ErrorAction SilentlyContinue
    Read-Host '  Press Enter to close'
} finally {
    # Ctrl+C, window close, and a thrown error all land here. npm spawns Vite as
    # a grandchild, so killing the npm process alone would orphan the server and
    # leave the port bound for the next launch.
    if ($null -ne $server -and -not $server.HasExited) {
        Write-Host ""
        Write-Step 'Stopping the dev server...'
        & taskkill.exe /PID $server.Id /T /F 2>&1 | Out-Null
    }
}

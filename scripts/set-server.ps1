# scripts/set-server.ps1
# Tells THIS client laptop where the game server is, by writing frontend/server.json.
# After that, "npm run tcp" / "npm run udp" in frontend/ connect there with no --server flag.
#
#   powershell -ExecutionPolicy Bypass -File scripts\set-server.ps1 -Ip 100.101.102.103
#   powershell -ExecutionPolicy Bypass -File scripts\set-server.ps1 -TailscaleName server-laptop
#   powershell -ExecutionPolicy Bypass -File scripts\set-server.ps1 -Ip 10.147.17.5      (ZeroTier)
#
# Priority when the client starts: --server flag > GAME_SERVER env variable > server.json > 127.0.0.1
param(
    [string]$Ip,
    [string]$TailscaleName,
    [int]$TcpPort = 5000,
    [int]$UdpPort = 5001
)

if (-not $Ip -and $TailscaleName) {
    # "tailscale ip -4 <machine name>" prints that machine's 100.x address.
    $Ip = (& tailscale ip -4 $TailscaleName 2>$null | Select-Object -First 1)
    if (-not $Ip) {
        Write-Error "Could not find '$TailscaleName' in your tailnet. Check 'tailscale status' for the exact name."
        exit 1
    }
    $Ip = $Ip.Trim()
}
if (-not $Ip) {
    Write-Error "Give -Ip <address> or -TailscaleName <server machine name>."
    exit 1
}

$file = Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend\server.json'
$json = @{ server = $Ip; tcpPort = $TcpPort; udpPort = $UdpPort } | ConvertTo-Json
# No BOM: Node's JSON.parse would choke on it.
[System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $file"
Write-Host $json
Write-Host "Now: cd frontend; npm run tcp   (or npm run udp)"

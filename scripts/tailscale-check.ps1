# scripts/tailscale-check.ps1
# Run on each CLIENT laptop, on the network it will use for the demo. Checks that Tailscale reaches
# the server DIRECTLY (peer to peer over UDP), not through a DERP relay.
#   powershell -ExecutionPolicy Bypass -File scripts\tailscale-check.ps1 -Server server-laptop
#   powershell -ExecutionPolicy Bypass -File scripts\tailscale-check.ps1 -Server 100.101.102.103
#
# Why it matters: when no direct path exists, Tailscale relays through DERP servers, over HTTPS (TCP).
# Our UDP version would then travel as UDP inside a TCP tunnel, which hides exactly the
# TCP-vs-UDP difference we want to show. The game still works, but note it in the results.
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [int]$Count = 10
)

if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
    Write-Error "tailscale is not on PATH. Install it from https://tailscale.com/download and log in first."
    exit 1
}

Write-Host "== This laptop" -ForegroundColor Cyan
Write-Host ("Tailscale IP: " + ((& tailscale ip -4) | Select-Object -First 1))

Write-Host "`n== Network conditions (tailscale netcheck)" -ForegroundColor Cyan
# "UDP: true" is required for a direct path. "Nearest DERP" is the relay used as a fallback.
& tailscale netcheck 2>&1 | Select-String -Pattern 'UDP:|IPv4:|MappingVariesByDestIP|Nearest DERP|PortMapping' | ForEach-Object { $_.Line }

Write-Host "`n== tailscale ping $Server ($Count tries)" -ForegroundColor Cyan
# "pong from ... via 203.0.113.7:41641 in 12ms" = direct
# "pong from ... via DERP(fra) in 48ms"          = relayed
$out = & tailscale ping -c $Count $Server 2>&1
$out | ForEach-Object { Write-Host $_ }

$pongs = @($out | Where-Object { $_ -match 'pong from' })
$direct = @($pongs | Where-Object { $_ -notmatch 'via DERP' })
$last = if ($pongs.Count) { $pongs[-1] } else { '' }

Write-Host "`n== Verdict" -ForegroundColor Cyan
if ($pongs.Count -eq 0) {
    Write-Host "NO ANSWER: is the server laptop online in Tailscale? Check 'tailscale status'." -ForegroundColor Red
    exit 2
} elseif ($last -notmatch 'via DERP') {
    Write-Host "DIRECT path ($($direct.Count)/$($pongs.Count) pongs direct). Good for both versions." -ForegroundColor Green
    exit 0
} else {
    Write-Host "RELAYED via DERP. The game works, but UDP traffic is tunnelled over TCP." -ForegroundColor Yellow
    Write-Host "Try: another network (phone hotspot), wait 30 s and re-run, or switch to ZeroTier (docs/TAILSCALE.md section 8)."
    exit 3
}

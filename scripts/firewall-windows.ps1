# scripts/firewall-windows.ps1
# Opens the game ports on the SERVER laptop (Windows). Run once, in PowerShell AS ADMINISTRATOR:
#   powershell -ExecutionPolicy Bypass -File scripts\firewall-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\firewall-windows.ps1 -Remove     (undo)
# Clients need no rule: they only make outgoing connections.
param(
    [int]$TcpPort = 5000,
    [int]$UdpPort = 5001,
    [switch]$Remove
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Run this in PowerShell as Administrator (right-click PowerShell > Run as administrator)."
    exit 1
}

$tcpName = "Among Us Arena TCP $TcpPort"
$udpName = "Among Us Arena UDP $UdpPort"

# Remove old copies first, so running the script twice does not create duplicates.
Get-NetFirewallRule -DisplayName $tcpName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName $udpName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) {
    Write-Host "Removed the firewall rules for TCP $TcpPort and UDP $UdpPort."
    exit 0
}

# -Profile Any: the Tailscale / ZeroTier adapter is often classified as a "Public" network.
New-NetFirewallRule -DisplayName $tcpName -Direction Inbound -Protocol TCP -LocalPort $TcpPort -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName $udpName -Direction Inbound -Protocol UDP -LocalPort $UdpPort -Action Allow -Profile Any | Out-Null

Write-Host "Inbound TCP $TcpPort and UDP $UdpPort are now allowed:"
Get-NetFirewallRule -DisplayName "Among Us Arena*" | Format-Table DisplayName, Enabled, Direction, Action, Profile -AutoSize

# Same thing with netsh, if you prefer (or if the NetSecurity module is missing):
#   netsh advfirewall firewall add rule name="Among Us Arena TCP 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
#   netsh advfirewall firewall add rule name="Among Us Arena UDP 5001" dir=in action=allow protocol=UDP localport=5001 profile=any
#   netsh advfirewall firewall delete rule name="Among Us Arena TCP 5000"

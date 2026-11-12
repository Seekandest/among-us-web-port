# Cross-network play with Tailscale (bonus): runbook

Goal: 1 server laptop and 3 client laptops on **different networks** (for example campus Wi-Fi and two
phone hotspots) playing a full match, **in both versions** (TCP and UDP), with metrics recorded.

Tailscale puts the 4 laptops on one private virtual network. Every laptop gets a fixed `100.x.y.z`
address. The game server already listens on all interfaces (`0.0.0.0`), so the Tailscale interface is
included and the game code needs no change.

> **The one thing to watch:** Tailscale normally connects two laptops **directly**, with WireGuard over UDP.
> When a network blocks that, it falls back to a **DERP relay**, which runs over HTTPS (TCP). The game still
> works, but our UDP version then travels *inside TCP*, and the TCP-vs-UDP comparison means nothing.
> Section 5 shows how to check for this before the demo. If a client stays on DERP, change network or use
> ZeroTier (section 8).

| Step | Who | Time |
|---|---|---|
| 1. Install Tailscale, one account, key expiry off | all 4 laptops | 10 min |
| 2. Find the server's 100.x IP, point the clients at it | server + clients | 5 min |
| 3. Open the firewall | server | 2 min |
| 4. Smoke test on Tailscale | everyone | 5 min |
| 5. `tailscale ping`: direct or DERP? | each client, on its demo network | 5 min |
| 6. Full match + metrics, TCP then UDP | everyone | 2 × 10 min |
| 7. Pre-demo checklist | everyone | day before |
| 8. Backup: ZeroTier | if needed | 15 min |

---

## 1. Install Tailscale on the 4 laptops (same account, no key expiry)

Use **one shared account** for the team (for example a team Google or GitHub account). Every laptop
logs in with the same account, so all four are in the same tailnet with no invitations to manage.

**Windows (each laptop):**
1. Download and install from https://tailscale.com/download/windows.
2. Click the Tailscale icon in the system tray, then **Log in**. A browser opens: log in with the team account.
3. When asked, give the machine a clear name: `au-server`, `au-client1`, `au-client2`, `au-client3`.
   (Or later: admin console > Machines > `...` > *Edit machine name*.)
4. Check in PowerShell:
   ```powershell
   tailscale status      # lists the 4 machines once everyone is logged in
   tailscale ip -4       # this laptop's 100.x address
   ```

**macOS:** install from the App Store or https://tailscale.com/download/mac, log in from the menu bar icon.
**Linux:** `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up` and open the printed link.

**Turn key expiry off.** By default a machine's login expires after 180 days, or sooner depending on the
account settings. An expiry during the demo disconnects that laptop.
1. Open https://login.tailscale.com/admin/machines.
2. For **each** of the 4 machines: `...` menu > **Disable key expiry**.
3. The machine list now shows "Expiry disabled" under each name.

Also check **Settings > General** in the Tailscale app on Windows: enable *Run unattended* on the server,
so Tailscale keeps running when nobody is logged in to Windows.

## 2. The server's 100.x address, and pointing the clients at it

On the **server laptop**:
```powershell
tailscale ip -4          # e.g. 100.101.102.103: write it down
```
MagicDNS is on by default, so the machine name works too: `tailscale ip -4 au-server` on any laptop
prints the server's address.

Nothing is hard-coded. A client finds the server in this order (first one wins):

| Priority | How | Example |
|---|---|---|
| 1 | `--server` flag | `npm run udp -- --server 100.101.102.103` |
| 2 | `GAME_SERVER` (and `GAME_PORT`) env variable | `$env:GAME_SERVER = "100.101.102.103"; npm run udp` |
| 3 | `frontend/server.json` | written by `scripts/set-server.ps1` (below) |
| 4 | default | `127.0.0.1` (everything on one PC) |

The easiest way: on each **client laptop**, run once:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-server.ps1 -TailscaleName au-server
# or with the address: ... set-server.ps1 -Ip 100.101.102.103
```
It writes `frontend/server.json` (ignored by git, so every laptop has its own). From then on,
`npm run tcp` and `npm run udp` connect there with no extra flag. Linux/macOS: `bash scripts/set-server.sh --tailscale au-server`.

The server needs no address: it listens on `0.0.0.0`. Its port can come from `--port` or from `GAME_PORT`
(defaults: TCP 5000, UDP 5001).

## 3. Firewall on the server laptop

Clients only make outgoing connections and need no rule. On the **server**:

**Windows** (PowerShell **as Administrator**):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\firewall-windows.ps1
# undo: ... firewall-windows.ps1 -Remove
```
This is the same as:
```powershell
New-NetFirewallRule -DisplayName "Among Us Arena TCP 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "Among Us Arena UDP 5001" -Direction Inbound -Protocol UDP -LocalPort 5001 -Action Allow -Profile Any
# or with netsh:
netsh advfirewall firewall add rule name="Among Us Arena TCP 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
netsh advfirewall firewall add rule name="Among Us Arena UDP 5001" dir=in action=allow protocol=UDP localport=5001 profile=any
```
`-Profile Any` matters: Windows usually classifies the Tailscale adapter as a *Public* network. If Windows
pops up "Allow Node.js to communicate", allow it.

**Linux (ufw):**
```bash
sudo bash scripts/firewall-linux.sh tailscale0     # only on the Tailscale interface
# same as: sudo ufw allow in on tailscale0 to any port 5000 proto tcp
#          sudo ufw allow in on tailscale0 to any port 5001 proto udp
```

## 4. Smoke test over Tailscale

Server laptop:
```powershell
cd backend
npm run tcp
```
On one client, check that the port answers:
```powershell
Test-NetConnection 100.101.102.103 -Port 5000     # TcpTestSucceeded : True
cd frontend
npm run tcp
```
The network bar at the top of the game page must read `TCP → 100.101.102.103:5000 · connected`, and the server
prints `[TCP] + tcp-1 connected from 100.x.y.z:port` (the **client's Tailscale address**).

For UDP, `Test-NetConnection` cannot help (no handshake to test). Start `npm run udp` on both sides: the
network bar must reach `connected`, and the server prints `[UDP] + udp-1 connected from 100.x.y.z:port`.

## 5. Direct path or DERP relay? (run this from every demo network)

On **each client laptop, connected to the network it will use for the demo**:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\tailscale-check.ps1 -Server au-server
```
It runs `tailscale netcheck` and `tailscale ping -c 10 au-server`, then gives a verdict:

| `tailscale ping` output | Meaning |
|---|---|
| `pong from au-server (100.101.102.103) via 203.0.113.7:41641 in 14ms` | **Direct** (peer to peer over UDP). Good. |
| `pong from au-server (100.101.102.103) via DERP(fra) in 52ms` | **Relayed** through a DERP server over HTTPS. |

You can also check with `tailscale status`: a peer shows `direct 203.0.113.7:41641` or `relay "fra"`.

Notes:
- The first pings often go through DERP while the direct path is being set up. Only the **last** lines
  count: the script judges on the last pong.
- `tailscale netcheck` must show `UDP: true`. If it shows `false`, that network blocks outgoing UDP:
  Tailscale can only use DERP there, and **our UDP version may not work at all on that network without
  Tailscale**. Use another network (a phone hotspot usually works).
- Two phones on 4G/5G carrier NAT sometimes cannot reach each other directly. A laptop on a home or
  campus network as the **server** improves the odds. Test the exact combination you will use.

Write the results down for the slides (network, direct/DERP, RTT).

## 6. Full match across networks, both versions, with metrics

Metrics are recorded automatically:
- **Each client** writes one line per second to `frontend/netstats-<tcp|udp>-<pid>.csv`. Columns: time,
  protocol, server, state, `rttMs` (PING→PONG), `msgsOutPerSec` / `msgsInPerSec`, byte totals, and for UDP
  `fastLost` / `lossPct` (position datagrams that never arrived), `retransmits`, duplicates and reordering.
- **The server** prints per-client statistics every 10 s (`[stats]` lines), including retransmissions and
  positions lost per client in the UDP version.
- `F3` in the game shows the network HUD (protocol, RTT, msgs/s, retransmits).

**Run (TCP first, then UDP, same 3 players, about 5 minutes each):**
1. Server: `cd backend; npm run tcp 2>&1 | Tee-Object server-tcp.log`
2. Each client: `cd frontend; npm run tcp`
3. Play a full game: register, create/join a room, start, move a lot, one kill, one meeting with votes,
   end screen with the ranking, then **Play again** once.
4. Close the game tabs (or Ctrl+C in each agent terminal), stop the server (Ctrl+C).
5. Collect the CSV files into one folder per run, for example `runs/wan-tcp/`, named after the laptop.
6. Repeat with `npm run udp` on the server and the clients, into `runs/wan-udp/`.
7. Summarize:
   ```powershell
   node tools/summarize-netstats.mjs runs/wan-tcp/*.csv runs/wan-udp/*.csv
   node tools/summarize-netstats.mjs runs/wan-tcp/*.csv runs/wan-udp/*.csv --csv > runs/summary.csv
   ```
   It prints, per client: RTT avg / p95 / max, jitter, messages per second, and for UDP the loss %, retransmits,
   duplicates and reordered packets. Import `summary.csv` into a spreadsheet for the comparison slide.

Optional: run once more with the UDP loss simulation (`npm run udp -- --loss 0.1` on the server) to show the
reliability layer at work, and capture with Wireshark on the **Tailscale** interface
(`udp.port == 5001` / `tcp.port == 5000`). The physical interface only shows encrypted WireGuard packets.

## 7. Pre-demo checklist

**The day before**
- [ ] All 4 laptops: `git pull`, `cd backend; npm install`, `cd frontend; npm install; npm run build`.
- [ ] All 4 laptops in `tailscale status`, **key expiry disabled** on each (admin console).
- [ ] Server: firewall rules present (`Get-NetFirewallRule -DisplayName "Among Us Arena*"`).
- [ ] Each client: `scripts\set-server.ps1` run, `frontend/server.json` points to the server.
- [ ] `scripts\tailscale-check.ps1` gives **DIRECT** from each demo network (or plan B decided).
- [ ] A full rehearsal of both versions across networks, metrics collected and summarized.
- [ ] **Backup videos recorded**: one full match of the TCP version, one of the UDP version (screen
      recording of a client plus the server console). Keep them on a USB stick **and** on a laptop.
- [ ] Wireshark installed on one client, with a test capture on the Tailscale interface.

**On demo day**
- [ ] **Phone hotspots fully charged**, chargers and power banks packed; hotspot data plan has volume left.
- [ ] Laptops charged and on power; sleep and screen lock disabled during the demo.
- [ ] Windows Update paused, notifications off (Focus Assist).
- [ ] Tailscale running on all 4 (tray icon), `tailscale status` shows everyone.
- [ ] Rerun `scripts\tailscale-check.ps1` on each client: still direct?
- [ ] Start the server, then the 3 clients; check the 3 network bars say `connected`.
- [ ] If the venue's network fails: switch to hotspots; if Tailscale fails: ZeroTier (section 8); if
      everything fails: play the backup videos.

## 8. Backup: ZeroTier

ZeroTier does the same job (one virtual LAN), with its own relays. Use it if Tailscale cannot give a
direct path on some network, or if the Tailscale service is down.

1. One team member creates a network at https://my.zerotier.com (free account) > **Create A Network**.
   Copy the 16-character **Network ID**. Leave it **Private** (members must be approved).
2. On each laptop, install from https://www.zerotier.com/download/ and join:
   - Windows: tray icon > *Join New Network* > paste the ID; or, as Administrator:
     `& "C:\Program Files (x86)\ZeroTier\One\zerotier-cli.bat" join <NETWORK_ID>`
   - Linux: `curl -s https://install.zerotier.com | sudo bash`, then `sudo zerotier-cli join <NETWORK_ID>`
3. In my.zerotier.com > the network > **Members**: tick **Auth** for the 4 laptops and give them names.
   The *Managed IPs* column shows each laptop's address (for example `10.147.17.5`).
4. Firewall: the Windows rules from section 3 already cover it (`-Profile Any`). Linux:
   `sudo bash scripts/firewall-linux.sh zt+`.
5. **Switch the clients to the server's ZeroTier address:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\set-server.ps1 -Ip 10.147.17.5
   ```
   (or `npm run udp -- --server 10.147.17.5`, or `$env:GAME_SERVER = "10.147.17.5"`). Nothing changes on the
   server: it listens on every interface.
6. Check the path: `zerotier-cli peers` (Windows: `zerotier-cli.bat peers`). A `DIRECT` link for the server's
   node is what we want; `RELAY` means relayed (ZeroTier relays over UDP, so the UDP version stays UDP,
   with a higher RTT).
7. Wireshark: capture on the ZeroTier adapter.

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| Network bar stays on `connecting` | `tailscale ping au-server` works? Server running the same version (tcp/udp)? Firewall rule on the server? Right address in `frontend/server.json`? |
| `ECONNREFUSED` (TCP) | Server not started, or started with `udp`. |
| Works on LAN, not over Tailscale | Firewall rule without `-Profile Any` (Tailscale adapter = Public network). Rerun `scripts\firewall-windows.ps1`. |
| High RTT (> 100 ms) between nearby laptops | DERP relay: section 5. |
| `tailscale status` shows a machine as offline / expired | Log it in again; disable key expiry (section 1). |
| UDP works locally but never over a given network | `tailscale netcheck` shows `UDP: false` on that network: use another network. |

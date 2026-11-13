# Among Us Arena: presentation plan (demo day, Fri 13 Nov 2026)

Branch `feature-updates`. This plan is built from the code, the README and the current deck
(`dashboard/index.html`), plus a fresh run of the automated tests (13 Nov, one PC):
`ALL 38 CHECKS PASSED` on TCP, on UDP, and on UDP with 20% simulated loss on every side.

**Contents**
1. [What the jury grades, and where we cover it](#1-what-the-jury-grades-and-where-we-cover-it)
2. [Evaluation of the current deck](#2-evaluation-of-the-current-deck)
3. [Fix list before presenting (priority order)](#3-fix-list-before-presenting-priority-order)
4. [Recommended structure, style and roles](#4-recommended-structure-style-and-roles)
5. [Slide-by-slide plan with pitches](#5-slide-by-slide-plan-with-pitches)
6. [Live demo script](#6-live-demo-script)
7. [Backup slides (Q&A only)](#7-backup-slides-qa-only)
8. [Q&A preparation](#8-qa-preparation)
9. [Numbers cheat sheet](#9-numbers-cheat-sheet)
10. [Pre-show checklist](#10-pre-show-checklist)

---

## 1. What the jury grades, and where we cover it

> *Assessment priority: correct socket-based networking, a well-supported TCP versus UDP comparison,
> reliable multiplayer operation, and a clear technical demonstration.*

| Requirement (project brief) | Where we show it | Evidence the jury can see |
|---|---|---|
| Competitive game, not cooperative | S1 (rules + scoring), demo | 1 imposter vs 2 crew, personal points, ranking |
| Client-server, 1 server + 3 clients | S1, demo | Server log: `tcp-1..3` / `udp-1..3` from 3 different IPs |
| 4 separate computers | Demo | 4 laptops on the table, server log shows 3 remote IPs |
| Real network sockets (no simulation) | S1, S2, S3, demo | Only `net` + `dgram`; Wireshark capture |
| Two versions, same game, only transport changes | S1 | One `transport` interface, game rules shared, `--proto tcp\|udp` |
| UDP version has no TCP at all, own reliability + disconnection detection | S3, S4, demo | Wireshark filter `tcp` shows nothing from the game; HUD counters |
| Understanding of TCP and UDP, differences | S2, S3, S6 | What the OS gives vs. what we built, side by side |
| Feature: registration and login | Demo step 1, S5 | Wrong password refused, scrypt hash, server-issued id |
| Feature: lobby and room creation | Demo step 2 | Room appears on all 3 clients (pushed `rooms:list`) |
| Feature: join / leave a room | Demo step 3 | `player:joined` / `player:left` on the other screens |
| Feature: game start and end, session status | Demo steps 4 and 6 | Host-only start, private roles, end screen |
| Feature: real-time actions | Demo step 5, S3 | 20 Hz movement, kill, meeting, vote |
| Feature: scores, ranking, winner | Demo step 6, S1 | End screen ranking, points carried to "Play again" |
| Feature: player disconnection | Demo step 7, S4 | Others keep playing; detection times measured |
| 5 to 7 slides of technical explanation | S1 to S7 | Exactly 7 technical slides (title, demo divider and closing are bookends) |
| Socket architecture of each version | S1, S2, S3 | Diagram per version |
| Comparison with team-defined metrics | S6 | Measured table (detection times, loss, retransmits, bytes, code size) |
| Friction points, where each protocol was best, technical differences | S6, S7 | Advantages/drawbacks table, challenges and fixes |
| Simultaneous players and disconnections, per version | S4 | One slide answering exactly this |
| Submission: code + run instructions | Closing line | README sections 5 and 6, repo link |
| Bonus: cross-network | S7 (only if shown) | `tailscale status` + server log with `100.x` addresses |

---

## 2. Evaluation of the current deck

### 2.1 What is already strong (keep it)

- **Visual identity.** The arcade theme with TCP in one color and UDP in the other is memorable and
  consistent. Keep the colors: they let the jury read every comparison at a glance.
- **Real substance.** The TCP slide (OS does vs. we built), the UDP reliability slide with the lost-ACK
  sequence, and the head-of-line blocking race animation are exactly what "understanding of TCP and UDP"
  means. They are the best part of the deck.
- **Speaker notes exist for every slide** (`N` key) and are written in plain spoken English.
- **Honesty markers** ("by design, not measured") already show the right instinct. Push it further.

### 2.2 Factual errors: the deck says something the code does not do

These are the most urgent: a jury member who reads the code, or asks one follow-up question, will catch them.

| # | Deck says (location) | The code actually does | Fix |
|---|---|---|---|
| E1 | "Exponential backoff, like TCP: resend RTO, 2·RTO, 4·RTO… ≤ 1 s" (`dashboard/index.html` line 312-313, weaknesses slide line 439, notes line 356 "doubled on every resend") | `ReliableChannel.tick()` resends at a **fixed** RTO = 2 × SRTT, clamped to 100–1000 ms. There is no doubling ([shared/reliableUdp.cjs:160-172](../shared/reliableUdp.cjs#L160-L172)). | Change the text to "fixed adaptive RTO = 2 × SRTT (100–1000 ms)". Do not add backoff to the code today. If someone asks, present backoff as the next improvement (see E2). |
| E2 | "25 resends with no ACK: the peer is dead. **The 5 s heartbeat usually fires first.**" (line 322) | On a LAN the RTO sits at its 100 ms floor, so 25 resends take about **2.6 s**: the retransmission limit fires **before** the heartbeat whenever a reliable message is pending. Today's run at 20% loss: crash detected in 3.1 s by "too many retransmissions without ACK". | Say "two detectors, whichever fires first: 25 unanswered resends (≈ 2.6 s on a LAN) or 5 s of silence". Mention it as a known inconsistency on S5. |
| E3 | Client = "Electron main process" (architecture slide line 123, callout line 156, challenges slide line 528) | `npm run tcp` / `npm run udp` start the **web version**: a browser tab plus a local Node agent (`frontend/web/agent.cjs`) that owns the socket. Electron is the alternative (`npm run desktop:tcp`). | Redraw S1 with "Browser tab ↔ local agent (loopback, never on the network) → `net` / `dgram` socket". Mention Electron in one line. Show whichever you actually run in the demo. |
| E4 | "45 of 45 checks pass on TCP and on UDP" (line 410) | The smoke test prints **ALL 38 CHECKS PASSED** (fresh run, 13 Nov). The README says 34. | Use 38 everywhere, and fix the README line 521. |
| E5 | Demo slide: "Start: host only, **3 players**; roles sent privately; **3-minute clock**" (line 456) | There is **no game clock** in the code (only the 30 s meeting timer). `MIN_PLAYERS_TO_START = 2` ([backend/src/events/gameEvents.js:18](../backend/src/events/gameEvents.js#L18)). | Remove "3-minute clock". Either set the minimum to 3 (one-line change) or say "minimum 2, we play with 3". |
| E6 | RTT boxes show `__ ms` (lines 503-504) | Not filled in. | Fill them from the rehearsal on the 4 laptops (CSV + `tools/summarize-netstats.mjs`), or remove them. Loopback values (~1 ms) are meaningless for the comparison. |
| E7 | Bonus status "planned, not yet demonstrated" (line 566) | Unchanged. | Either demonstrate it (then show proof), or move the slide to the backup and do not claim the bonus. |
| E8 | UDP counters "retransmits 14–21, duplicates 23–35, out-of-order 17 (12 Nov)" | Fresh run 13 Nov: retransmits 14 / 6, duplicates 16 / 20, out-of-order 9 / 12, positions lost 41% / 37% per client. | Use the fresh numbers (section 9) and cite the date and the command. |

### 2.3 Structural problems

| Problem | Why it matters | Fix |
|---|---|---|
| **13 slides**, about 10 of them technical | The brief asks for **5 to 7** technical slides. Running long eats the demo time. | Merge to 7 (table below). Move the rest to backup. |
| No slide explains the **game rules and scoring** | "Competitive" and "scores, rankings, winner" are mandatory. The jury must know why there is a winner before the demo. | One strip on S1: roles, win conditions, points. |
| **No edge-case / inconsistency slide** | You asked for it, and it is the best proof of "reliable multiplayer operation". The audit found 16 defects in the original project; the deck mentions only 6 of them, mixed with network topics. | New S5: game-logic cases + network cases + honest known limits. |
| "Network weaknesses" and "Challenges faced" **overlap** | Same story told twice (framing, Nagle, heartbeat appear on both). | Merge into S7: challenges → fixes → optimizations with numbers. |
| No explicit **advantages / drawbacks** table | The brief asks "where each protocol performed best" and "technical differences". | Add to S6. |
| **TCP under loss is not measured** | The comparison is one-sided ("by design, not measured"). | 15 minutes with `clumsy` (section 3, F6). If not possible, keep the honest label. |
| No **team roles** | Each of the 4 must speak; the jury often asks "who did what". | Roles on the title slide; one speaker per slide (section 4.3). |
| Demo placed after almost all slides | The disconnection and comparison slides are more convincing *after* the jury has seen it live. | Demo in the middle: explain → show → measure and compare. |

### 2.4 Verdict per current slide

| Current slide | Verdict | Goes to |
|---|---|---|
| 1 Title (arcade cabinet) | Keep, add roles | Title |
| 2 Architecture | Keep, **fix E3**, add the rules/scoring strip | S1 |
| 3 Simultaneous players | Merge | S4 (left half) |
| 4 TCP | Keep; add the listen socket + per-client socket from slide 3 | S2 |
| 5 UDP reliability | Keep, **fix E1 and E2** | S3 |
| 6 Fast lane | Merge (one step at the end of S3); reuse the race animation in S6 | S3 / S6 |
| 7 Disconnections | Keep, fresh numbers, add the "two detectors" line | S4 (right half) |
| Weaknesses | Merge | S7 |
| Live demo | Keep as a divider, **fix E5** | Demo |
| Measured | Rebuild with fresh numbers + advantages/drawbacks | S6 |
| Challenges | Merge with Weaknesses, add optimizations | S7 |
| Bonus + close | Bonus strip on S7 if shown, else backup; closing line moves to the last slide | S7 / Closing |
| Thank you | Keep | Closing |
| *(new)* | Edge cases and inconsistencies | S5 |

---

## 3. Fix list before presenting (priority order)

The presentation is today, so this is sorted by value per minute. Stop wherever time runs out.

| # | Task | Time | Who |
|---|---|---|---|
| F1 | Fix the 5 wrong statements E1–E5 in `dashboard/index.html` (text only) and README line 521 (34 → 38) | 15 min | Israa |
| F2 | Rehearse the demo once on the **4 real laptops**, both versions, and keep the CSVs. Run `node tools/summarize-netstats.mjs frontend/netstats-*.csv` and fill the RTT boxes (E6) | 30 min | everyone |
| F3 | Reorder/merge slides to the structure in section 4 (hide merged slides, do not delete them: they become backup) | 30 min | Zeineb |
| F4 | Write the new S5 (edge cases) and the advantages/drawbacks table on S6 | 30 min | Nabila + Ilyes |
| F5 | Record a screen video of one full TCP game and one full UDP game (fallback if the room's network fails) | 15 min | Ilyes |
| F6 | *Optional:* measure TCP under loss with `clumsy` (Windows): drop 10% on one client, play 1 minute, read `tcp.analysis.retransmission` in Wireshark and the RTT max in the CSV | 15 min | Nabila |
| F7 | *Optional:* set `MIN_PLAYERS_TO_START = 3` (one line) so the rule matches the slides, then re-run `node tools/smoke-client.cjs --proto tcp` | 5 min | Israa |
| F8 | *Optional, only with a full re-test:* exponential backoff in `ReliableChannel.tick()`. It is a real improvement (fixes E2), but do not change networking code on demo day without re-running all 3 smoke tests | 30 min | Ilyes |

---

## 4. Recommended structure, style and roles

### 4.1 Flow: explain → show → measure → reflect

```
 Title (30 s)
   │
 S1 The game and the architecture ............ what we built, why it is competitive, where the sockets are
 S2 The TCP version ........................... what the OS gives, what we still built
 S3 The UDP version ........................... what we rebuilt, and what we chose NOT to make reliable
   │
 LIVE DEMO: TCP run, then UDP run (+ disconnection, + loss)
   │
 S4 Simultaneous players and disconnections ... "what you just saw", measured
 S5 Edge cases and inconsistencies handled .... why the game does not break
 S6 TCP vs UDP: measured comparison ........... metrics, advantages/drawbacks, where each won
 S7 Challenges, optimizations (and bonus) ..... what was hard, what we tuned, what we would do next
   │
 Closing + Q&A (backup slides ready)
```

Why this order: the jury first learns enough to read the demo (S1–S3), then sees it working, then gets
the evidence and the analysis (S4–S7) while the demo is fresh. Every claim in S4–S7 can point back to
"you just saw this".

### 4.2 Style rules (apply to every slide)

1. **The title is a claim, not a topic.** "TCP: reliable, but only a stream of bytes" instead of "TCP".
2. **Kicker = the requirement it answers** (small text above the title), e.g. *"Brief §2: socket architecture"*.
   The jury can tick its checklist while you talk.
3. **TCP always left and blue, UDP always right and orange** (keep the deck's `--tcp` / `--udp` colors).
4. **One takeaway line at the bottom of each slide**, in bold. If the jury remembers one sentence, it is that one.
5. **Every number has a source** in small text: "smoke test, 13 Nov, one PC" or "rehearsal, 4 laptops, LAN".
6. **Real wire examples** (`{"t":"MSG","seq":7,...}`) instead of abstract boxes: it proves the code is ours.
7. **At most ~40 words of body text per slide**; the rest goes into the pitch. Use step reveals (already in `deck.js`).
8. **Honest labels**: "measured", "by design", "known limit". Graders trust a team that knows its limits.

### 4.3 Roles and timing (target 20 min + Q&A; 15-min version in brackets)

| Part | Speaker | Time | (15-min version) |
|---|---|---|---|
| Title + S1 | Israa Daassi | 2:30 | 2:00 |
| S2 TCP | Zeineb Megaadi | 1:45 | 1:15 |
| S3 UDP | Ilyes Jammouci | 2:00 | 1:30 |
| Live demo (narrator) | Nabila Ben Ammar narrates; Israa runs the server PC; Zeineb, Ilyes, Nabila play | 6:00 | 4:30 |
| S4 Simultaneity + disconnections | Zeineb Megaadi | 1:30 | 1:15 |
| S5 Edge cases | Nabila Ben Ammar | 1:30 | 1:00 |
| S6 Comparison | Ilyes Jammouci | 2:00 | 1:45 |
| S7 Challenges + optimizations (+ bonus) | Israa Daassi | 1:45 | 1:15 |
| Closing | Israa Daassi | 0:30 | 0:30 |
| **Total** | | **≈ 19:30** | **≈ 15:00** |

Each member presents about 4–5 minutes and owns one protocol topic, so anyone can be asked a deep question
on their part. Swap names freely; keep one speaker per slide.

**Hand-offs** (say them out loud, they make the talk feel structured):
Israa → "Zeineb will show what TCP gave us, and what it did not." · Zeineb → "Ilyes, UDP gives none of that."
· Ilyes → "Enough theory: Nabila will drive the demo." · Nabila → "Zeineb, what exactly happened when we
pulled that client?" · Zeineb → "Nabila, what else could have broken?" · Nabila → "Ilyes, so which protocol
is better?" · Ilyes → "Israa, what did it cost us to get here?"

---

## 5. Slide-by-slide plan with pitches

Pitches are written to be spoken at a normal pace (about 140 words per minute). Learn the ideas, not the
words.

---

### Title: "Among Us Arena: one game, two transports"

**Speaker:** Israa · **Time:** 0:30 · **Reuse:** current arcade title slide

**On the slide:** title, course and date, the 4 names **with roles**:
Israa (server and game logic), Zeineb (TCP transport and clients), Ilyes (UDP reliability layer),
Nabila (testing, metrics and demo). *(Adjust roles to what each person actually built.)*
Footer: `TCP :5000 · UDP :5001 · Node net + dgram only · 0 networking libraries`.

**Pitch:**
> Good morning. We are Israa, Zeineb, Ilyes and Nabila, and this is Among Us Arena: a competitive
> multiplayer game for three players, built twice, once on TCP only and once on UDP only, with
> identical rules. We used no networking library at all: only Node's built-in `net` and `dgram` modules.
> In the next twenty minutes we will explain how each version works, play it live on four computers,
> and then compare the two protocols with numbers we measured.

---

### S1: "One game, two interchangeable transports"

**Kicker:** Brief §1–2: competitive game, client-server, real sockets, same game twice
**Speaker:** Israa · **Time:** 2:00 · **Reuse:** architecture slide, **with E3 fixed**

**On the slide (three bands):**

1. **The game in one line each** (left, small):
   - 3 players: 1 imposter (secret, rotates every game) vs 2 crewmates
   - Imposter wins by killing both crewmates; crew wins by voting the imposter out
   - Points: kill +1 · correct vote +1 · crew win +2 each · imposter win +3 → ranking, scores carry over to "Play again"
2. **Architecture diagram** (center):
   ```
   Client PC ×3                                          Server PC
   [Browser tab: React + Phaser]                         [Game rules: events/*.js  (shared)]
        │ loopback 127.0.0.1 (never leaves the PC)              │  4 operations:
   [Local agent, Node]                                   connect · message · disconnect · send
     tcpClient.cjs → net.Socket  ═══ TCP :5000 ═══▶  tcpServer.js (net)
     udpClient.cjs → dgram.Socket ═══ UDP :5001 ═══▶ udpServer.js (dgram)
   ```
3. **Three facts** (bottom, step reveals):
   - A browser cannot open raw sockets → a small local agent owns the real socket.
   - The game rules never mention `net` or `dgram`: `--proto tcp|udp` picks one file.
   - The server is **authoritative**: clients send requests, the server checks and decides.

**Takeaway:** *Same rules, same messages, same UI. Only one file changes: the transport.*

**Pitch:**
> First, the game, because it explains what the network has to carry. Three players, one of them is the
> imposter and only they know it. The imposter wins by killing both crewmates; the crew wins by voting
> the imposter out in an emergency meeting. Everyone earns personal points, so there is a ranking and a
> winner at the end, and the imposter role rotates when you play again.
>
> Now the architecture. One server computer, three client computers. A web page is not allowed to open a
> raw TCP or UDP socket, so on each client a small Node program, the agent, owns the real socket, and
> the browser talks to it over loopback, which never leaves the computer. Between computers there is
> only our own TCP or our own UDP traffic.
>
> On the server, both transports offer the same four operations: connect, message, disconnect and send.
> The game rules only use those four, so switching protocol means switching one file. That is how we
> guarantee the two versions have identical rules. And the server is authoritative: a client only asks
> "I want to kill this player"; the server checks the role, the distance and the cooldown with its own
> data, and then tells everyone what happened.
>
> Zeineb will show what TCP gave us, and what it did not.

---

### S2: "TCP: reliable and ordered, but only a stream of bytes"

**Kicker:** Brief §2: socket architecture of the TCP version · how it uses TCP
**Speaker:** Zeineb · **Time:** 1:45 · **Reuse:** current TCP slide + the TCP half of the "simultaneous players" slide

**On the slide:**

- **Left: socket architecture.** `net.createServer` on `0.0.0.0:5000` = 1 listening socket; each accepted
  connection = 1 dedicated socket = 1 session (`tcp-1`, `tcp-2`, `tcp-3`). Client connects, OS does
  SYN / SYN-ACK / ACK, then the server sends `{"type":"welcome","data":{"sessionId":"tcp-3"}}\n`.
- **Middle: "The OS does it"** (kernel): handshake, sequence numbers, ACKs, retransmission, in-order
  delivery, FIN/RST on close, flow and congestion control.
- **Right: "We still had to build"** (4 tiles, step reveal):
  1. **Framing**: one JSON object per line `\n`; `StringDecoder` for a UTF-8 character split across chunks; 64 KB guard.
  2. **No Nagle**: `socket.setNoDelay(true)` so small 20 Hz messages leave at once.
  3. **Heartbeat**: PING every 1 s, 5 s of silence = gone (a pulled cable sends nothing; TCP keep-alive ≈ 2 h).
  4. **Reconnect**: a dead connection cannot be reused → new handshake, new session every 2 s.
- **Last step: head-of-line blocking** race animation (already in the deck).

**Takeaway:** *TCP gives reliability for free, but not messages, not liveness, and not "skip the old position".*

**Pitch:**
> In the TCP version the server opens one listening socket on port 5000. Every client that completes the
> three-way handshake gets its own dedicated socket, and that socket is the player's session. The first
> thing the server sends is a welcome message with the session id: only then does the client consider
> itself connected.
>
> The operating system does a lot for us: sequence numbers, acknowledgements, retransmission and in-order
> delivery all happen in the kernel. Our code never sees a lost packet. But four things were still our job.
> First, TCP is a stream of bytes, not of messages: one read can contain half a message or two glued
> together, so we put exactly one JSON object per line. Second, Nagle's algorithm delays small writes to
> batch them, so we turn it off. Third, if a cable is pulled, nothing arrives to tell us, and TCP's
> keep-alive would take about two hours, so we added a one-second heartbeat with a five-second timeout.
> Fourth, a dead connection cannot be revived: the client opens a brand new one every two seconds.
>
> And the price of reliability: if one segment carrying a position is lost, every newer position waits
> behind it. That is head-of-line blocking. The newest position already makes the old one useless, but
> TCP delivers the old one first anyway.
>
> Ilyes, UDP gives us none of this.

---

### S3: "UDP: nothing is promised, so we built only what the game needs"

**Kicker:** Brief §2: UDP version without TCP, own reliability and disconnection detection
**Speaker:** Ilyes · **Time:** 2:00 · **Reuse:** UDP reliability slide (**E1, E2 fixed**) + fast-lane slide as the last step

**On the slide:**

- **Socket architecture (top strip):** one `dgram` socket on `0.0.0.0:5001` for **all** clients. A datagram
  only says who sent it (`rinfo.address:rinfo.port`), so a session = an `ip:port` that completed
  `HELLO → WELCOME {sessionId, tok}`. The random **token** is in every later datagram: a forged source
  address is not enough to impersonate a player.
- **Six tiles, our `ReliableChannel`** (`shared/reliableUdp.cjs`, used by both server and client):
  1. Sequence number per reliable message `{"t":"MSG","seq":7,...}`
  2. ACK for every MSG, even a duplicate (a duplicate means our ACK was lost)
  3. Retransmission after **RTO = 2 × smoothed RTT**, kept between 100 and 1000 ms; RTT measured with **Karn's rule** *(no backoff: say "fixed adaptive RTO")*
  4. De-duplication: `seq < expected` → ACK again, never deliver twice
  5. In-order delivery: seq 8 waits in a buffer for seq 7
  6. Give up after 25 unanswered resends (≈ 2.6 s on a LAN), or 5 s of silence: whichever comes first
- **Lost-ACK sequence animation** (already in the deck).
- **Last step: two lanes.** `MSG` reliable: register, join, start, kill, vote, game end. `FAST` unreliable:
  positions only, 20 per second, counter `n`, never resent; an older `n` than the last seen from that
  player is dropped. Datagrams always under 1200 bytes (no IP fragmentation).

**Takeaway:** *We rebuilt the parts of TCP the game needs, and deliberately left positions unreliable.*

**Pitch:**
> UDP gives each send as an independent datagram. It can be lost, duplicated or reordered, and there is
> no connection, so nobody tells you when the other side disappears. The server has one single socket for
> all players. A datagram only tells us the sender's IP and port, so we built sessions ourselves: the
> client sends HELLO every second until the server answers WELCOME with a session id and a random token.
> Every later datagram must carry that token, so spoofing someone's address is not enough to play as them.
>
> Then reliability, in one file used by both sides. Every important message gets a sequence number and
> must be acknowledged. If the ACK does not come back within the retransmission timeout, we resend. The
> timeout adapts: twice the measured round-trip time, between 100 milliseconds and one second, and like TCP
> we only measure on messages sent once: that is Karn's rule. Duplicates are acknowledged again but never
> delivered twice, and early arrivals wait until the gap is filled, so the game sees every event exactly
> once and in order. After 25 resends without an answer, or 5 seconds of silence, the peer is dead.
>
> And the deliberate choice: positions do not go through any of this. They are sent twenty times per
> second. If one is lost, the next one replaces it 50 milliseconds later, so resending it would only
> deliver the past. So events are reliable, and positions are fast.
>
> Enough theory: Nabila will drive the live demo.

---

### Live demo divider: "Same script, played twice"

**Speaker:** Nabila (narrator) · **Time:** 6:00 · **Reuse:** current demo slide, **E5 fixed**

**On the slide:** the 7-step script, the two command pairs, who sits where, and the Wireshark filters.
Leave it on screen while playing if the projector shows the slides; otherwise switch the projector input
(see section 6).

**Pitch (opening, then narrate each step as it happens):**
> One computer runs the server, the other three are players. We play the same script twice: first TCP,
> then UDP. Watch three things: the server log, which shows every session and every message type; the HUD
> in the corner of each client, which shows the protocol, the round-trip time and, in UDP, our own
> retransmissions; and Wireshark, which shows what really travels on the network.

Full script with narration lines: section 6.

---

### S4: "Three players at once, and what happens when one disappears"

**Kicker:** Brief §4: how simultaneous players and disconnections are handled in each version
**Speaker:** Zeineb · **Time:** 1:30 · **Reuse:** "simultaneous players" (left) + "disconnections" (right)

**On the slide:**

**Left: simultaneous players**

| | TCP | UDP |
|---|---|---|
| Sockets on the server | 1 listening + 1 per client | 1 for everyone |
| Session = | the accepted connection | `ip:port` after HELLO/WELCOME, + token |
| Room broadcast | 3 writes on 3 sockets | 3 datagrams to 3 addresses |
| Concurrency | one event loop: simultaneous actions are queued events, no locks, no races | same |
| Identity | from the session, never from the payload | same |

**Right: detection time, measured** (smoke test, 13 Nov, one PC)

| What happened | TCP | UDP |
|---|---|---|
| Player quits normally | 0.0 s (FIN) | 0.0 s (BYE) |
| Client process crashes | **0.0 s** (OS sends RST) | **5.0 s** (only silence) · 3.1 s at 20% loss (retransmission limit) |
| Cable pulled / Wi-Fi lost | 5.4 s (our heartbeat) | 5.1 s (our detectors) |
| Network back | new connection, new session in 1.7 s | new HELLO/WELCOME in 1.0 s |

**Bottom: same cleanup chain in both versions:** remove from room → tell the others (`player:left` + reason)
→ pass the host role → close the meeting if they were the last voter → end the game if a side has won
(imposter left = crew wins) → client reconnects by itself and returns to the menu.

**Takeaway:** *TCP knows at once when the OS can tell it. For a silent failure, both need our heartbeat.*

**Pitch:**
> What you just saw, in detail. With three players acting at the same time, TCP gives the server one socket
> per player, while UDP uses a single socket for everybody and tells players apart by address plus token.
> A room broadcast is not magic in either case: three players means three separate sends. And Node handles
> everything on one event loop, so two actions at the same instant are simply two events, one after the
> other. No locks and no race conditions: if a vote and a kill arrive together, whichever arrives first is
> applied, and the second is checked against the new state.
>
> Disconnections are where the protocols really differ. If a client process crashes, TCP knows instantly,
> because the operating system resets the connection. UDP has no connection, so only silence reveals it:
> five seconds, or about three seconds when messages are waiting for an ACK. If a cable is pulled, nobody
> sends anything, so both versions rely on our heartbeat. Whatever the cause, the same game code runs:
> the player is removed, the others are told why, the host role moves, and if the imposter left, the crew
> wins. Nothing crashes.

---

### S5: "Edge cases and inconsistencies we handle"

**Kicker:** Reliable multiplayer operation
**Speaker:** Nabila · **Time:** 1:30 · **New slide**

**On the slide (three columns, 4–5 lines each, step reveal):**

**Game logic (server-authoritative)**
- Imposter identity never in any public message; roles sent privately (the original project leaked it to everyone)
- Kill checked on the server: role, both alive, no meeting, 10 s cooldown, ≤ 100 px using **server** positions
- Moves outside the map are clamped; moves faster than the walking speed are rejected and corrected (`corrected: true`), with a small time "bank" so normal network jitter is not punished
- Meetings: once per player per game, dead players cannot vote, vote hidden until the end, tie = nobody ejected, only the server timer or "everyone voted" ends it
- Join refused if the game started, the room is full, or the name is taken; a taken color is replaced by a free one

**Network and session**
- Identity bound to the session: a player id in the payload is ignored; same account on two clients refused
- Leaver was the last voter → meeting ends now; host leaves → new host announced; imposter leaves → crew wins
- Login hashing (scrypt) runs off the main thread, and if the client vanished meanwhile, the reply is dropped
- UDP: HELLO from a known address = client restarted → fresh session; late WELCOME → client resets; datagram with wrong token dropped and **not** counted as a heartbeat
- Malformed JSON, unknown types, a handler bug: logged and ignored, never crash the server

**Known limits (honest)**
- A reconnecting player returns to the menu; they cannot resume a game in progress
- A player who leaves disappears from the final ranking (their score is removed with them)
- UDP: the retransmission limit (≈ 2.6 s on a LAN) can disconnect a player during a Wi-Fi hiccup shorter than the 5 s heartbeat. Next step: exponential backoff
- No segmentation in our UDP layer: a message over 1200 bytes would rely on IP fragmentation (ours stay far below)
- Rooms live in memory: a server restart ends all games (accounts persist on disk)

**Takeaway:** *Every rule is checked on the server, so a broken or malicious client cannot break the game for others.*

**Pitch:**
> The game we started from was fully client-trusted. Our first test with three scripted clients found
> sixteen defects: the imposter's identity was in the public room list, a crewmate could kill, anyone
> could rename another player or end a meeting, and a position of x equals ninety-nine thousand was
> accepted. Today the server checks everything with its own data. A kill is checked for role, cooldown and
> distance using the server's positions. A move that is too far or too fast is corrected, with a small
> tolerance so normal network jitter does not punish honest players.
>
> On the network side, every awkward timing is covered: a player leaving while they were the last voter,
> the host leaving, the imposter leaving, a client restarting in UDP, a stale packet from an old session,
> or a client disconnecting while its password is being checked.
>
> And here is what we know is not perfect. A reconnecting player cannot resume a running game. A leaver
> disappears from the ranking. And in UDP, because our retry timer has no backoff, a short Wi-Fi hiccup
> can disconnect a player a bit faster than in TCP. We know exactly why, and how we would fix it.

---

### S6: "TCP vs UDP: same game, different behaviour"

**Kicker:** Brief §4: comparison with our own metrics · where each protocol performed best
**Speaker:** Ilyes · **Time:** 2:00 · **Reuse:** "measured" slide, rebuilt with fresh numbers + race animation

**On the slide:**

**Top: our metrics (measured)**

| Metric | TCP | UDP | Source |
|---|---|---|---|
| Crash detection | 0.0 s | 5.0 s (3.1 s at 20% loss) | smoke test 13 Nov |
| Full scripted game at 20% loss | not testable with `--loss` *(or clumsy result, F6)* | completed, all 38 checks; +5.5 s vs. no loss | smoke test |
| Reliable-lane repairs at 20% loss (per client) | invisible to us (kernel) | 14 / 6 retransmits · 16 / 20 duplicates · 9 / 12 reordered | smoke test |
| Positions lost at 20% loss each side | 0 (but delayed) | 37–41% lost, game still playable | smoke test (theory: 1 − 0.8² = 36%) |
| App-level bytes, same script, one client | 20.7 KB out / 72.8 KB in | 43.7 KB out / 111.6 KB in | smoke test |
| RTT on the LAN (avg / p95) | __ / __ ms | __ / __ ms | rehearsal CSV (F2) |
| Transport code we wrote | ≈ 400 lines | ≈ 640 lines | `wc -l`, incl. comments |

**Bottom: advantages and drawbacks for *this* game**

| | TCP | UDP |
|---|---|---|
| **Advantages** | Reliability and order for free · instant detection of quit and crash (FIN/RST) · less code · built-in congestion control · smaller app messages | Message boundaries built in · we choose reliability per message · no head-of-line blocking for positions · one socket for all · we control every timer |
| **Drawbacks** | No message boundaries · Nagle · head-of-line blocking: a lost position delays everything behind it · silent dead peers · reconnect = new session | Everything to build (sessions, ACKs, order, liveness, token) · crash seen only by silence · no congestion control · bigger messages in our JSON design (token + envelope + separate ACKs) · fragmentation risk |
| **Performed best at** | Login, lobby, rooms, kill, vote, scores: everything that must arrive | Movement under loss: a lost position costs 50 ms, not a freeze |

**Takeaway:** *Reliable for events, unreliable for state that expires. TCP gives you a promise; UDP gives you a choice.*

**Pitch:**
> We compared the two versions on metrics we chose ourselves. First, detection: a crashed client is seen
> instantly in TCP and after up to five seconds in UDP. Second, behaviour under loss: with 20 percent of
> datagrams dropped on every side, the UDP version still finished a complete game and passed all 38
> checks. Each client repaired its events with a handful of retransmissions, ignored around twenty
> duplicates and re-ordered about ten messages, while 37 to 41 percent of positions were simply lost,
> which matches the theory of two independent 20-percent losses, and the game remained playable because
> the next position always comes 50 milliseconds later.
>
> UDP also cost us: our messages are bigger, because every datagram carries the token, its own envelope,
> and separate ACKs, and we wrote about 60 percent more transport code.
>
> So where did each win? TCP is the better fit for everything that must arrive: login, rooms, kills, votes
> and scores, with simpler code and instant crash detection. UDP wins for movement: on a lossy network a
> lost position costs one frame instead of freezing everything behind it. Our conclusion: reliable for
> events, unreliable for state that expires.

*(If F6 is done, add one sentence: "With clumsy dropping 10% on one TCP client, Wireshark counted N
retransmissions and the RTT peaked at M ms: that is head-of-line blocking, measured.")*

---

### S7: "What was hard, and what we optimized"

**Kicker:** Brief §4: friction points · technical differences · bonus
**Speaker:** Israa · **Time:** 1:45 · **Reuse:** merge "weaknesses" + "challenges"

**On the slide:**

**Left: challenges → fix** (6 rows, before / after)

| Challenge | Fix |
|---|---|
| Socket.IO + Express + fetch hid the sockets (all TCP) | Removed them all: only `net` and `dgram` |
| A web page cannot open raw sockets | Local agent (or Electron) owns the socket |
| TCP cut our JSON in pieces | Newline framing, UTF-8-safe |
| A silent peer stayed "connected" forever | Heartbeat 1 s / timeout 5 s in both versions |
| UDP: lost, duplicated, reordered, spoofable | seq + ACK + RTO + dedupe + order + session token |
| Client-trusted game (16 defects found) | Server-authoritative rules, identity from the session |

**Right: optimizations, with numbers**

- Positions: from **one per rendered frame (60–144/s)** to **20/s moving, 2/s idle**, immediate on start/stop
- No echo: a position is relayed only to the *other* players (−⅓ of the position traffic)
- Remote players glide 30% of the way per frame, snap beyond 200 px: 20 updates/s still look smooth
- `setNoDelay(true)` in TCP · `FAST` lane + stale drop in UDP
- RTO adapts to the measured RTT (Karn's rule) · datagrams < 1200 bytes
- Lobby list **pushed** on change, never polled · password hashing off the main thread

**Bottom strip (only if demonstrated):** Bonus: 4 laptops on 4 networks via Tailscale (`100.x` addresses),
server on `0.0.0.0`, direct path checked with `tailscale ping` (a DERP relay would carry our UDP inside TCP).

**Takeaway:** *The hardest part was not writing sockets; it was discovering what the libraries had been doing for us.*

**Pitch:**
> To finish, what was hard. The project we started from used Socket.IO, Express and HTTP: everything ran
> over TCP and the sockets were hidden. We removed all of it, and then found out how much it had been doing
> for us. TCP cut our JSON into pieces, so we added framing. A dead peer stayed connected forever, so we
> added a heartbeat. In UDP, we had to rebuild sessions, acknowledgements, ordering and protection against
> spoofed addresses.
>
> We also optimized. Positions used to be sent on every rendered frame, up to 144 times per second; now it
> is 20 per second while moving and 2 when standing still, the sender never receives its own echo, and
> remote players glide between updates so it still looks smooth. TCP sends without Nagle's delay, UDP sends
> positions on the fast lane, and its retransmission timer adapts to the measured round-trip time.
>
> *(If shown:)* And for the bonus, the same game ran across four different networks through a Tailscale
> overlay, with a direct path checked so our UDP stayed UDP.

---

### Closing: "TCP gives you a promise. UDP gives you a choice."

**Speaker:** Israa · **Time:** 0:30 · **Reuse:** closing line + thank-you slide

**On the slide:** the closing line, the 4 names, "Source code + run instructions: README §5 (TCP) and §6 (UDP)".

**Pitch:**
> TCP gives you a promise, and you pay for it with head-of-line blocking. UDP gives you a choice, and you
> pay for it with code. The source code and the instructions to run both versions are in the repository.
> Thank you; we are happy to answer questions, and we can open any file, log or Wireshark capture.

---

## 6. Live demo script

### 6.1 Set-up (before the jury enters)

- **Server PC (Israa):** start **both** servers now, in two terminals, so switching versions takes no time:
  ```powershell
  cd backend
  $env:ACCOUNTS_FILE="data/users-tcp.json"; npm run tcp     # terminal 1
  $env:ACCOUNTS_FILE="data/users-udp.json"; npm run udp     # terminal 2
  ```
  Separate account files, because two processes writing the same `users.json` would overwrite each other's
  new accounts. Wireshark open on the Wi-Fi interface, filters ready. Terminal font large.
- **Each client PC:** `npm run build` done. Agents started, but **one browser window per player** (not tabs:
  hidden tabs pause the game loop). Projector on Client 1 for gameplay.
  ```powershell
  cd frontend
  npm run tcp -- --server <SERVER_IP>        # opens localhost:8080
  npm run udp -- --server <SERVER_IP> --web-port 8090   # second agent, for run 2
  ```
- HUD visible (`F3`). Firewall rules for TCP 5000 / UDP 5001 on the server. Sleep disabled, chargers plugged.

### 6.2 Run 1: TCP (≈ 3 min)

| # | Action | Who | Narration (Nabila) | Requirement |
|---|---|---|---|---|
| 1 | Log in with a **wrong password**, then the right one | Client 1 | "The server refuses a wrong password; the id is created by the server, not the client." Show the log `tcp-1 registered`. | Registration and login |
| 2 | Create room `DEMO1` | Client 1 | "The room appears on the other two screens: the list is pushed, not polled." | Lobby and room creation |
| 3 | Client 2 joins, **leaves**, joins again; Client 3 joins | Clients 2, 3 | "Every join and leave is announced to the others." | Join / leave |
| 4 | Host starts | Client 1 | "Each player received a private message: only the imposter knows." | Game start |
| 5 | Move, kill, call a meeting, vote | all | "Positions 20 times a second; the kill and the votes are checked by the server." | Real-time actions |
| 6 | End screen, ranking | all | "Winner, points, ranking. Play again keeps the scores and rotates the imposter." | Scores and results |
| 7 | **Ctrl+C the agent of Client 3** (crash) | Client 3 | "The server log shows `connection reset` immediately: the OS told it. The others carry on." | Disconnection |
| W | Wireshark `tcp.port == 5000` → *Follow TCP Stream* | Israa | "Handshake, one JSON per line, a PING every second, then the reset." | Real sockets |

### 6.3 Run 2: UDP (≈ 3 min)

Same steps 1–6, faster (the jury knows the flow). Then:

| # | Action | Narration |
|---|---|---|
| 7 | **Ctrl+C Client 3's agent** | "No connection to reset: the server only notices the silence. Count with me… it is gone after about five seconds." |
| 8 | Wireshark `udp.port == 5001` | "One JSON per datagram: HELLO, WELCOME, MSG with a sequence number, ACK, FAST positions." |
| 9 | Wireshark filter `tcp` (or `tcp.port == 5000`) | "Nothing from the game: the UDP version uses no TCP at all." |
| 10 *(optional, 30 s)* | Restart Client 2's agent with `--loss 0.1` and move | "10% of datagrams dropped on purpose: look at the HUD, retransmits and duplicates go up, the game keeps working." |

### 6.4 Fallbacks

| Problem | Do this |
|---|---|
| Room network isolates devices | Phone hotspot (prepared), or Tailscale |
| A client will not connect | HUD reason: `ECONNREFUSED` = wrong IP or server down; UDP stuck on `connecting` = firewall UDP 5001 |
| Total network failure | Play the recorded video (F5), and run `node tools/smoke-client.cjs --proto udp --loss 0.2` live on one PC: 38 checks in 35 s, real sockets on loopback |
| Time is short | Skip run 2 steps 3 and 5; keep 7 (disconnection) and 8–9 (Wireshark) |

---

## 7. Backup slides (Q&A only)

Keep the hidden slides from the current deck, plus:

1. **Message catalogue**: client → server and server → client (README §3.5).
2. **Protocol constants**: heartbeat 1 s, timeout 5 s, RTO 100/200/1000 ms, 25 retries, 1200 bytes.
3. **Wireshark screenshots**: TCP stream, UDP MSG/ACK, `tcp.analysis.retransmission` under clumsy.
4. **Code map**: which file does what (README §11), line counts.
5. **Bonus set-up** (if not on S7): Tailscale, direct vs DERP, `tailscale status` screenshot.
6. **The 16 defects of the original project** (audit table) for "what did you change?".

---

## 8. Q&A preparation

| Likely question | Short answer | Who |
|---|---|---|
| "Your UDP version uses HTTP between the browser and the agent. Isn't that TCP?" | That hop is loopback inside one computer, the same role as Electron's IPC; it never touches the network, and Wireshark on the Wi-Fi shows no TCP from the game. The desktop version (`npm run desktop:udp`) has no HTTP at all. | Israa |
| Why not WebSocket or WebRTC? | WebSocket is TCP and would hide it; WebRTC adds its own layers (DTLS/SCTP). The point was raw `net` / `dgram`. | Israa |
| Why JSON and not binary? | Readable in Wireshark for the demo and the grading. Cost: bigger messages (shown on S6). Binary would be the next optimization. | Zeineb |
| Why a heartbeat in TCP if TCP is reliable? | Reliable delivery is not liveness: a pulled cable sends nothing, and keep-alive defaults to about 2 hours. | Zeineb |
| What if an ACK is lost? | The sender resends after the RTO; the receiver sees an old seq, ACKs it again and does not deliver it twice. | Ilyes |
| Why RTO = 2 × SRTT and not TCP's SRTT + 4·RTTVAR? | Simpler and enough on a LAN with clamping 100–1000 ms. TCP's formula and exponential backoff are the next step. | Ilyes |
| Is there head-of-line blocking in your UDP version? | Only inside the reliable lane (events wait for a missing event). Positions bypass it on the FAST lane. | Ilyes |
| Congestion control in UDP? | None beyond fixed, low send rates (20 Hz, ~1 KB/s per client) and the RTO floor. For a large game we would need it. | Ilyes |
| Can two players behind the same NAT collide in UDP? | No: the session key is `ip:port`, and the NAT gives each one a different port. The token also has to match. | Ilyes |
| How do you stop cheating or spoofing? | Identity comes from the socket (TCP) or address + token (UDP), never from the payload; every action is validated against server state. | Nabila |
| What if a kill and a vote arrive at the same time? | Single event loop: they are processed one after the other; the second is checked against the new state (e.g. no kill during a meeting). | Zeineb |
| Why 5 seconds? | Trade-off: 5 missed heartbeats avoids false alarms on Wi-Fi, still fast enough for a game. | Zeineb |
| Can a disconnected player rejoin the game? | They reconnect automatically and log in again, but return to the menu; resuming a running game is a known limit. | Nabila |
| How did you measure? | Automated test with 3 real clients (`tools/smoke-client.cjs`, 38 checks), per-second CSV on every client, `tools/summarize-netstats.mjs`, Wireshark. | Nabila |
| How did you simulate loss for TCP? | You cannot drop bytes inside a TCP stream from the application; we impair the network with clumsy and watch `tcp.analysis.retransmission`. *(Only if F6 done; otherwise: "we did not measure it, the stall follows from the design".)* | Nabila |
| Over Tailscale, is UDP still UDP? | Yes on a direct path (WireGuard over UDP). If Tailscale falls back to a DERP relay, it is tunnelled over TCP; we check with `tailscale ping`. | Israa |

---

## 9. Numbers cheat sheet

**Fresh smoke test, 13 Nov 2026, one PC (loopback), `node tools/smoke-client.cjs --proto ...`**

| | TCP | UDP 0% | UDP 20% loss |
|---|---|---|---|
| Checks | 38/38 | 38/38 | 38/38 |
| Scripted game finished at | 18.1 s | 18.1 s | 23.6 s |
| Clean quit seen | 0.0 s (FIN) | 0.0 s (BYE) | 0.1 s |
| Crash seen | 0.0 s (reset) | 5.0 s (timeout) | 3.1 s (retransmission limit) |
| Pulled cable seen (server) | 5.4 s | 5.1 s | 3.2 s |
| Reconnect, new session | 1.7 s | 1.0 s | 1.7 s |
| Retransmits (2 clients) | n/a (kernel) | 0 / 0 | 14 / 6 |
| Duplicates ignored | n/a | 0 / 0 | 16 / 20 |
| Out-of-order buffered | n/a | 0 / 0 | 9 / 12 |
| Positions lost | 0 | 0 | 160/393 (41%) · 151/410 (37%) |
| App bytes out / in (Alice) | 20.7 / 72.8 KB | 43.7 / 111.6 KB | 37.3 / 58.7 KB |

**Recorded CSVs (loopback, earlier runs):** TCP RTT avg 0.5–1.9 ms; UDP RTT avg 1.2–1.4 ms. Loopback RTT is
not a comparison: replace with the 4-laptop rehearsal values.

**Constants:** heartbeat 1 s · timeout 5 s · RTO 2 × SRTT in [100, 1000] ms, 200 ms initial · 25 retries
· datagram ≤ 1200 bytes · positions 20 Hz moving / 2 Hz idle · kill range 100 px · kill cooldown 10 s ·
meeting 30 s · speed 100 px/s in game, 350 px/s in lobby (+15% tolerance) · TCP reconnect every 2 s · UDP
HELLO every 1 s · tab close → leave after 5 s.

**Transport code (lines incl. comments):** TCP = `lineFramer` 69 + `tcpServer` 127 + `tcpClient` 205 ≈ 400.
UDP = `reliableUdp` 182 + `udpServer` 189 + `udpClient` 270 ≈ 640. Shared game logic (events + managers): ≈ 950,
identical for both.

---

## 10. Pre-show checklist

- [ ] E1–E5 fixed in the deck; README says 38 checks
- [ ] Slides reordered: Title, S1, S2, S3, Demo, S4, S5, S6, S7, Closing; the rest hidden as backup
- [ ] RTT boxes filled from the 4-laptop rehearsal, or removed
- [ ] Bonus: proven (screenshot of `tailscale status` + server log) or moved to backup
- [ ] Both servers running with separate `ACCOUNTS_FILE`; firewall rules TCP 5000 + UDP 5001
- [ ] Server IP written on a sticky note at each client
- [ ] `npm run build` done on every client; one browser **window** per player; HUD on (`F3`)
- [ ] Wireshark open with `tcp.port == 5000`, `udp.port == 5001`, `tcp` saved as filter buttons
- [ ] Backup video of both runs on the presenting laptop (offline)
- [ ] Phone hotspot ready as a fallback network
- [ ] Laptops on power, sleep and notifications off, terminal font enlarged
- [ ] Each speaker rehearsed their slide once out loud, with the hand-off line

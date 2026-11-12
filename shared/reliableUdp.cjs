// shared/reliableUdp.cjs
// Our own reliability layer on top of UDP. Used by the server (one channel per client)
// and by the client (one channel to the server).
//
// UDP gives us: datagrams that may be LOST, DUPLICATED or arrive OUT OF ORDER.
// For important game events (register, join room, kill, vote, game end...) that is not acceptable,
// so this file adds, only for those messages:
//   1. a sequence number on each reliable message           (seq)
//   2. an acknowledgement sent back for each one             (ACK)
//   3. retransmission when no ACK arrives in time            (RTO = 2 x measured RTT)
//   4. duplicate detection                                   (seq already delivered -> ignore)
//   5. in-order delivery                                     (seq 8 waits until seq 7 has arrived)
//
// Position updates do NOT use any of this (they are "FAST" packets): if one is lost, the next one,
// 50 ms later, replaces it. We only drop FAST packets that arrive after a newer one (stale).
//
// Packets on the wire (each one is a single UDP datagram containing JSON):
//   {"t":"MSG","seq":7,"type":"player:kill","data":{...}}    reliable message
//   {"t":"ACK","seq":7}                                      "I received seq 7"
//   {"t":"FAST","n":345,"type":"player:move","data":{...}}   unreliable message
// (HELLO / WELCOME / PING / PONG / BYE are handled by the transport files, not here.)

const {
    MIN_RTO_MS, MAX_RTO_MS, INITIAL_RTO_MS, MAX_RETRIES,
} = require('./protocol.cjs');

class ReliableChannel {
    /**
     * @param {object} opts
     * @param {(packet: object) => void} opts.sendPacket  writes one datagram to the peer
     * @param {(type: string, data: any) => void} opts.onMessage  delivers a message to the game
     */
    constructor({ sendPacket, onMessage }) {
        this.sendPacket = sendPacket;
        this.onMessage = onMessage;

        // --- sending side ---
        this.nextSeq = 1;              // seq number of the next reliable message we send
        this.unacked = new Map();      // seq -> { packet, lastSentAt, tries }  (waiting for an ACK)
        this.nextFastN = 1;            // counter for unreliable packets

        // --- receiving side ---
        this.expectedSeq = 1;          // the next seq we are allowed to deliver to the game
        this.waiting = new Map();      // seq -> packet that arrived too early (a gap before it)
        this.lastFastN = new Map();    // key -> highest FAST number seen (to drop stale positions)
        this.highestFastN = 0;         // highest FAST number seen on this channel (to count losses)

        // --- RTT estimate (used to choose how long to wait before resending) ---
        this.srtt = null;              // smoothed round-trip time in ms

        this.stats = {
            reliableSent: 0,
            fastSent: 0,
            retransmits: 0,
            acksReceived: 0,
            duplicatesIgnored: 0,
            outOfOrderBuffered: 0,
            staleDropped: 0,
            fastReceived: 0,   // unreliable packets that arrived
            fastLost: 0,       // unreliable packets that never arrived (gaps in their counter "n")
        };
    }

    /** Send a message that MUST arrive (and arrive in order). */
    sendReliable(type, data) {
        const packet = { t: 'MSG', seq: this.nextSeq++, type, data };
        this.unacked.set(packet.seq, { packet, lastSentAt: Date.now(), tries: 1 });
        this.stats.reliableSent++;
        this.sendPacket(packet);
    }

    /** Send a message that may be lost (positions). */
    sendUnreliable(type, data) {
        this.stats.fastSent++;
        this.sendPacket({ t: 'FAST', n: this.nextFastN++, type, data });
    }

    /** Called by the transport for every MSG / ACK / FAST packet received from the peer. */
    handlePacket(packet) {
        if (packet.t === 'MSG') this.onReliable(packet);
        else if (packet.t === 'ACK') this.onAck(packet);
        else if (packet.t === 'FAST') this.onFast(packet);
    }

    onReliable(packet) {
        if (!Number.isInteger(packet.seq)) return;

        // Always acknowledge, even a duplicate: if we receive it twice, it probably means
        // our previous ACK was lost, so the sender is still waiting for it.
        this.sendPacket({ t: 'ACK', seq: packet.seq });

        const alreadyDelivered = packet.seq < this.expectedSeq;
        if (alreadyDelivered || this.waiting.has(packet.seq)) {
            this.stats.duplicatesIgnored++;
            return;
        }

        if (packet.seq > this.expectedSeq) this.stats.outOfOrderBuffered++;
        this.waiting.set(packet.seq, packet);

        // Deliver everything that is now in order: expectedSeq, expectedSeq+1, ...
        while (this.waiting.has(this.expectedSeq)) {
            const next = this.waiting.get(this.expectedSeq);
            this.waiting.delete(this.expectedSeq);
            this.expectedSeq++;
            this.onMessage(next.type, next.data);
        }
    }

    onAck(packet) {
        const entry = this.unacked.get(packet.seq);
        if (!entry) return; // ACK for something already acknowledged (duplicate ACK)
        this.unacked.delete(packet.seq);
        this.stats.acksReceived++;

        // Karn's rule: measure the RTT only on messages that were sent once. If the message was
        // resent, we cannot know which copy this ACK answers.
        if (entry.tries === 1) {
            const sample = Date.now() - entry.lastSentAt;
            this.srtt = this.srtt === null ? sample : 0.875 * this.srtt + 0.125 * sample;
        }
    }

    onFast(packet) {
        if (!Number.isInteger(packet.n) || packet.n < 1) return;

        // Packet loss measurement. FAST packets are numbered 1, 2, 3... by the sender and never
        // resent, so a jump from n=10 to n=13 means 11 and 12 were lost (or are late). A late one
        // that shows up afterwards was not lost after all, so it is taken back out of the count.
        this.stats.fastReceived++;
        if (packet.n > this.highestFastN) {
            this.stats.fastLost += packet.n - this.highestFastN - 1;
            this.highestFastN = packet.n;
        } else if (this.stats.fastLost > 0) {
            this.stats.fastLost--;
        }

        // Positions are grouped per player, so an old position of player A never overwrites a
        // newer position of player A, but does not hide positions of player B.
        const key = packet.type + ':' + (packet.data && packet.data.id ? packet.data.id : '');
        const last = this.lastFastN.get(key) || 0;
        if (packet.n <= last) {
            this.stats.staleDropped++;
            return;
        }
        this.lastFastN.set(key, packet.n);
        this.onMessage(packet.type, packet.data);
    }

    /** Retransmission timeout: how long we wait for an ACK before resending. */
    rto() {
        if (this.srtt === null) return INITIAL_RTO_MS;
        return Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, 2 * this.srtt));
    }

    /**
     * Called by the transport every 50 ms. Resends what was not acknowledged in time.
     * @returns {boolean} false if a message was resent MAX_RETRIES times without ACK (peer is dead)
     */
    tick(now = Date.now()) {
        const timeout = this.rto();
        for (const entry of this.unacked.values()) {
            if (now - entry.lastSentAt < timeout) continue;
            if (entry.tries > MAX_RETRIES) return false;
            entry.tries++;
            entry.lastSentAt = now;
            this.stats.retransmits++;
            this.sendPacket(entry.packet);
        }
        return true;
    }

    snapshot() {
        return {
            ...this.stats,
            waitingForAck: this.unacked.size,
            rtoMs: Math.round(this.rto()),
        };
    }
}

module.exports = { ReliableChannel };

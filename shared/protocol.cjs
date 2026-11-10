// shared/protocol.cjs
// Constants used by BOTH the server (backend/) and the client (frontend/electron/).
// Keeping them in one file guarantees that both sides agree on the protocol.

module.exports = {
    DEFAULT_TCP_PORT: 5000,
    DEFAULT_UDP_PORT: 5001,

    // Disconnection detection (both versions):
    // the client sends a PING every second, the server answers PONG.
    // If one side hears NOTHING from the other for TIMEOUT_MS, the other side is considered gone.
    // (TCP's own keep-alive would take ~2 hours to notice a pulled cable, so we do it ourselves.)
    HEARTBEAT_INTERVAL_MS: 1000,
    TIMEOUT_MS: 5000,

    // UDP reliability (our own, because UDP has none):
    // a reliable message is resent until its ACK arrives.
    MIN_RTO_MS: 100,          // never resend faster than this
    MAX_RTO_MS: 1000,         // never wait longer than this before resending
    INITIAL_RTO_MS: 200,      // before we have measured the round-trip time
    MAX_RETRIES: 25,          // after this many resends without ACK, the peer is considered dead

    // Keep every datagram well below the usual 1500-byte Ethernet MTU (and the 1280-byte
    // Tailscale tunnel MTU) so IP never has to fragment it.
    MAX_DATAGRAM_BYTES: 1200,

    // Message types that do NOT need reliability in the UDP version.
    // Positions are sent 20 times per second: if one is lost, the next one replaces it 50 ms later,
    // so resending an old position would be useless (it would already be out of date).
    UNRELIABLE_TYPES: ['player:move', 'player:moved'],
};

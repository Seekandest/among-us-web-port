// shared/lineFramer.cjs
// Message framing for the TCP version.
//
// TCP is a BYTE STREAM, not a message protocol:
//   - one 'data' event can contain half a message,
//   - or several messages glued together,
//   - and message boundaries are NOT preserved between send() and receive().
// So we need our own rule to know where a message ends.
//
// Our rule: one message = one JSON object followed by a newline '\n'.
// JSON.stringify never puts a raw newline inside its output (newlines in strings become "\n"),
// so '\n' can only appear at the end of a message.

const { StringDecoder } = require('node:string_decoder');

const MAX_BUFFER_CHARS = 64 * 1024; // protection: a line longer than this is garbage or an attack

class LineFramer {
    /**
     * @param {(msg: object) => void} onMessage called once per complete message
     */
    constructor(onMessage) {
        this.onMessage = onMessage;
        this.buffer = '';
        // A UTF-8 character (é, ç, emoji...) uses several bytes and can be split between two
        // TCP chunks. StringDecoder keeps the incomplete bytes until the rest arrives.
        this.decoder = new StringDecoder('utf8');
    }

    /**
     * Feed raw bytes received from the socket.
     * @param {Buffer} chunk
     */
    push(chunk) {
        this.buffer += this.decoder.write(chunk);

        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIndex);
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (line.trim() === '') continue;

            let msg;
            try {
                msg = JSON.parse(line);
            } catch (err) {
                console.warn('[framing] dropped a line that is not valid JSON:', line.slice(0, 80));
                continue;
            }
            this.onMessage(msg);
        }

        if (this.buffer.length > MAX_BUFFER_CHARS) {
            console.warn('[framing] buffer too large without a newline, clearing it');
            this.buffer = '';
        }
    }
}

/**
 * Turn a message object into the bytes we write on the TCP socket.
 * @param {object} msg
 * @returns {string}
 */
function encodeLine(msg) {
    return JSON.stringify(msg) + '\n';
}

module.exports = { LineFramer, encodeLine };

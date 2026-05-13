/**
 * whatsapp-worker.js — powered by @whiskeysockets/baileys
 * Pure WebSocket. No Puppeteer, no browser.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");
const P = require("pino");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Log file lives in the OS temp dir so this works on Windows, macOS, and
// Linux without any platform-specific path. (Was hardcoded to /tmp/...)
const LOG_FILE = path.join(os.tmpdir(), "wa-worker.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

const sessionPath = process.env.WHATSAPP_SESSION_PATH;
if (!sessionPath) {
  log("[wa-worker] WHATSAPP_SESSION_PATH not set\n");
  process.exit(1);
}

const logger = P({ level: "silent" });

let sock = null;
let myJid = null;
let restarting = false;
const START_TIMESTAMP = Math.floor(Date.now() / 1000); // Unix seconds — ignore older messages

function send(msg) {
  if (process.send) {
    process.send(msg);
  } else {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }
}

// In-memory store of messages WE sent so Baileys can answer iOS WhatsApp's
// "resend please" request via getMessage(). Without this, iOS shows the
// "Waiting for this message" placeholder forever because the first decrypt
// attempt failed and the sender (us) had nothing to re-deliver. Android and
// WhatsApp Web are more lenient — they don't hit this bug.
const sentMessages = new Map();
const SENT_MESSAGES_CAP = 200;
function trackSent(messageId, content) {
  if (!messageId || !content) return;
  sentMessages.set(messageId, content);
  if (sentMessages.size > SENT_MESSAGES_CAP) {
    const oldestKey = sentMessages.keys().next().value;
    sentMessages.delete(oldestKey);
  }
}

async function connectToWhatsApp() {
  if (restarting) return;
  restarting = true;

  log("[wa-worker] Connecting...\n");

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["AIOS Desktop", "Chrome", "1.0.0"],
    connectTimeoutMs: 60000,
    // iOS WhatsApp resend-request handler — see comment on sentMessages above.
    getMessage: async (key) => {
      const cached = sentMessages.get(key.id);
      if (cached) return cached;
      return { conversation: "" };
    },
  });

  // Save credentials whenever updated
  sock.ev.on("creds.update", saveCreds);

  // Handle connection state
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    log(
      `[wa-worker] connection.update: conn=${connection} hasQR=${!!qr}\n`
    );

    if (qr) {
      try {
        const dataUrl = await qrcode.toDataURL(qr);
        send({ type: "qr", data: dataUrl });
        log("[wa-worker] QR sent to parent\n");
      } catch (e) {
        log(`[wa-worker] QR error: ${e.message}\n`);
      }
    }

    if (connection === "open") {
      myJid = sock.user?.id || sock.user?.jid || "";
      log(`[wa-worker] CONNECTED! myJid=${myJid}\n`);
      restarting = false;
      send({ type: "ready" });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      log(
        `[wa-worker] Connection closed. code=${statusCode} loggedOut=${loggedOut}\n`
      );

      if (loggedOut) {
        send({ type: "disconnected", reason: "loggedOut" });
        process.exit(0);
      } else {
        log("[wa-worker] Reconnecting in 3s...\n");
        send({ type: "authenticated" });
        restarting = false;
        setTimeout(connectToWhatsApp, 3000);
      }
    }
  });

  // Handle ALL incoming/outgoing messages
  sock.ev.on("messages.upsert", async (upsertData) => {
    const { messages, type } = upsertData;
    log(`[wa-worker] messages.upsert type=${type} count=${messages.length}`);

    // Skip "append" — these are echoes of messages WE just sent (causes infinite loop)
    if (type === "append") {
      log(`[wa-worker] Skipping append (echo of our own sent message)`);
      return;
    }

    for (const msg of messages) {
      // Ignore messages sent before this session started
      const msgTimestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) : 0;
      if (msgTimestamp < START_TIMESTAMP) {
        log(`[wa-worker] Skipping old message (ts=${msgTimestamp} < start=${START_TIMESTAMP})`);
        continue;
      }

      log(`[wa-worker] RAW MSG: fromMe=${msg.key.fromMe} remoteJid=${msg.key.remoteJid} keys=${Object.keys(msg.message || {}).join(",")}`);

      if (!msg.message) continue;

      const from = msg.key.remoteJid || "";
      const fromMe = !!msg.key.fromMe;

      // Extract text
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        ""
      ).trim();

      log(`[wa-worker] MSG from=${from} fromMe=${fromMe} text="${text}"`);

      if (!text) continue;

      // Accept this message as a self-chat command if EITHER:
      //   (a) fromMe=true — sent from the Baileys-linked device itself
      //   (b) it's a self-chat from another linked device of the same user
      //
      // WhatsApp's modern protocol assigns each linked device a distinct @lid
      // (Linked ID) for privacy. When the user types on their iPhone, Baileys
      // sees `fromMe=false` because iPhone is a different identity even though
      // it's the same account. Self-chat 1-1 messages always arrive on @lid
      // or the user's own @s.whatsapp.net JID. Groups (@g.us) and broadcasts
      // (@broadcast) are explicitly excluded so contact 1-1 messages can't
      // hijack the remote.
      const isGroup = from.endsWith("@g.us");
      const isBroadcast = from.endsWith("@broadcast");
      if (isGroup || isBroadcast) {
        log(`[wa-worker] Skipping group/broadcast: ${from}`);
        continue;
      }
      const myNumber = (myJid || "").split(":")[0].split("@")[0];
      const isSelfPhone = from === `${myNumber}@s.whatsapp.net`;
      const isLid = from.endsWith("@lid");
      const isContact = from.endsWith("@s.whatsapp.net") && !isSelfPhone;

      const isSelfChat = fromMe || isSelfPhone || (isLid && !isContact);
      if (!isSelfChat) {
        log(`[wa-worker] Ignored (not self-chat) from=${from} fromMe=${fromMe}`);
        continue;
      }

      let command = text;
      if (command.startsWith("/")) command = command.substring(1).trim();
      log(`[wa-worker] COMMAND ACCEPTED: "${command}" (fromMe=${fromMe} jid=${from})`);
      send({ type: "command", text: command, jid: from });
    }
  });
}



// Handle messages from parent (Electron main)
process.on("message", async (msg) => {
  if (!msg) return;

  if (msg.type === "reply") {
    log(`[wa-worker] Sending reply...`);
    try {
      if (sock && myJid) {
        // Always reply to own number @s.whatsapp.net — NOT @lid (LID is invisible in WhatsApp UI)
        const myNumber = myJid.split(":")[0].split("@")[0];
        const selfJid = `${myNumber}@s.whatsapp.net`;
        const sent = await sock.sendMessage(selfJid, { text: msg.text });
        // Cache the original payload so getMessage() can answer iOS WhatsApp's
        // resend-please request when its first decrypt attempt fails. Without
        // this, the iOS chat keeps showing "Waiting for this message" instead
        // of the actual reply text.
        if (sent && sent.key && sent.key.id && sent.message) {
          trackSent(sent.key.id, sent.message);
        }
        log(`[wa-worker] Reply sent to ${selfJid} (id=${sent?.key?.id})`);
      }
    } catch (e) {
      log(`[wa-worker] Reply failed: ${e.message}`);
    }

  } else if (msg.type === "stop") {
    log("[wa-worker] Stopping...\n");
    if (sock) {
      try { sock.end(undefined); } catch {}
    }
    process.exit(0);
  }
});

process.on("uncaughtException", (err) => {
  log(`[wa-worker] Uncaught: ${err.message}\n`);
});

process.on("unhandledRejection", (reason) => {
  log(`[wa-worker] Unhandled: ${reason}\n`);
});

connectToWhatsApp();

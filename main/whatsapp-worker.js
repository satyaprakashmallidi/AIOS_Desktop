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
let myNumber = null;
let myLid = null;
let restarting = false;

function normalizeJidUser(value) {
  if (!value) return "";
  // Strip the device suffix (":NN") and the domain ("@..."). Baileys gives us
  // values like "917013252723:46@s.whatsapp.net" or "100562414616608:1@lid";
  // we only want the unique-id portion for equality checks.
  return String(value).split(":")[0].split("@")[0];
}

// Persist the user's own LID to disk so we don't lose it across worker
// restarts. On a fresh QR pairing, Baileys often doesn't deliver `sock.user.lid`
// at the first `connection.open` — it backfills it later via creds.update.
// Without persistence, after every restart the filter starts empty and self-
// chat from any device that uses `@lid` JIDs gets rejected until the LID
// trickles in (or never does).
const MY_LID_FILE = sessionPath
  ? path.join(sessionPath, "..", "wa-my-lid.txt")
  : null;

function loadMyLidFromDisk() {
  if (!MY_LID_FILE) return;
  try {
    const value = fs.readFileSync(MY_LID_FILE, "utf8").trim();
    if (value) {
      myLid = value;
      log(`[wa-worker] Loaded myLid=${myLid} from disk`);
    }
  } catch {
    // No file yet — first run after fresh pairing. That's fine; we'll save
    // it as soon as Baileys gives us the value.
  }
}

function saveMyLidToDisk() {
  if (!MY_LID_FILE || !myLid) return;
  try {
    fs.writeFileSync(MY_LID_FILE, myLid);
  } catch (e) {
    log(`[wa-worker] Failed to save myLid: ${e.message}`);
  }
}

function captureMyLid(source, rawLid) {
  const next = normalizeJidUser(rawLid);
  if (!next) return;
  if (myLid === next) return;
  myLid = next;
  log(`[wa-worker] myLid captured via ${source}: ${myLid}`);
  saveMyLidToDisk();
}

loadMyLidFromDisk();
const START_TIMESTAMP = Math.floor(Date.now() / 1000); // Unix seconds — ignore older messages

function send(msg) {
  if (process.send) {
    process.send(msg);
  } else {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }
}

// De-duplicate commands across reconnects AND across worker restarts. When
// the WebSocket drops, WhatsApp replays recent messages on reconnect as
// `type=notify` — and when the user restarts the app, the brand-new worker
// process gets the same replay. Without a persistent record of "I've already
// run this command", every restart would re-fire every recent command.
//
// We keep a bounded LRU of `msg.key.id` values both in memory and on disk
// (`<userData>/wa-processed-ids.json`). The disk file is small (<50 KB at
// PROCESSED_IDS_CAP) and writes are debounced.
const PROCESSED_IDS_CAP = 500;
const PROCESSED_IDS_FILE = sessionPath
  ? path.join(sessionPath, "..", "wa-processed-ids.json")
  : null;
const processedMessageIds = new Set();
let saveScheduled = false;

function loadProcessedIds() {
  if (!PROCESSED_IDS_FILE) return;
  try {
    const content = fs.readFileSync(PROCESSED_IDS_FILE, "utf8");
    const ids = JSON.parse(content);
    if (Array.isArray(ids)) {
      for (const id of ids.slice(-PROCESSED_IDS_CAP)) processedMessageIds.add(id);
      log(`[wa-worker] Loaded ${processedMessageIds.size} processed message IDs from disk`);
    }
  } catch {
    // File doesn't exist on first run — that's fine.
  }
}

function scheduleSave() {
  if (!PROCESSED_IDS_FILE || saveScheduled) return;
  saveScheduled = true;
  setTimeout(() => {
    saveScheduled = false;
    try {
      fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify([...processedMessageIds]));
    } catch (e) {
      log(`[wa-worker] Failed to save processed IDs: ${e.message}`);
    }
  }, 200);
}

function markProcessed(messageId) {
  if (!messageId) return;
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > PROCESSED_IDS_CAP) {
    const oldest = processedMessageIds.values().next().value;
    processedMessageIds.delete(oldest);
  }
  scheduleSave();
}

function alreadyProcessed(messageId) {
  return !!messageId && processedMessageIds.has(messageId);
}

loadProcessedIds();

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

// HARD LOCK: the ONLY way to send a message from this worker. Every outbound
// payload (text, document, anything we add later) goes through this helper, and
// it ALWAYS targets the user's own number@s.whatsapp.net — never anyone else.
// This is a defense-in-depth backstop for the inbound self-chat filter: even if
// a hostile or buggy code path tried to pass a different recipient, this
// function ignores it and the message can only ever land in the user's own
// self-chat thread.
async function sendToSelfOnly(content) {
  if (!sock) {
    log(`[wa-worker] sendToSelfOnly refused — socket not connected`);
    return null;
  }
  if (!myNumber) {
    log(`[wa-worker] sendToSelfOnly refused — myNumber unknown (auth not complete)`);
    return null;
  }
  const selfJid = `${myNumber}@s.whatsapp.net`;
  const sent = await sock.sendMessage(selfJid, content);
  log(`[wa-worker] Sent to ${selfJid} (id=${sent?.key?.id})`);
  if (sent && sent.key && sent.key.id && sent.message) {
    trackSent(sent.key.id, sent.message);
  }
  return sent;
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

  // Save credentials whenever updated. Also opportunistically pick up the
  // user's own LID — on a fresh QR pairing Baileys doesn't always set
  // `sock.user.lid` at the first `connection.open`, but it fires a
  // `creds.update` shortly after with the LID populated. Listening here
  // catches that case so the inbound filter starts accepting self-chat.
  sock.ev.on("creds.update", () => {
    captureMyLid("creds.update", sock.authState?.creds?.me?.lid);
    return saveCreds();
  });

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
      myNumber = normalizeJidUser(myJid);
      // Try to capture the LID from sock.user OR creds directly. If neither
      // has it yet (fresh QR pairings often hit this window), `captureMyLid`
      // is a no-op and the value we already loaded from disk (if any) stays
      // in place. A subsequent creds.update will fill it in.
      captureMyLid("connection.open(sock.user)", sock.user?.lid);
      captureMyLid("connection.open(creds.me)", sock.authState?.creds?.me?.lid);
      log(`[wa-worker] CONNECTED! myJid=${myJid} myNumber=${myNumber} myLid=${myLid}\n`);
      restarting = false;
      // Include the user's phone number + LID in the ready message so the
      // parent process (scanner) can surface them on the Connectors card
      // without needing a separate IPC call.
      send({ type: "ready", myJid, myNumber, myLid });
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
      // Ignore messages sent before this worker session started. Baileys hands
      // `messageTimestamp` as either a number or a protobufjs Long; on Long,
      // `Number(long)` returns NaN — use `toNumber()` when it exists.
      const rawTs = msg.messageTimestamp;
      let msgTimestamp = 0;
      if (rawTs != null) {
        if (typeof rawTs === "number") msgTimestamp = rawTs;
        else if (typeof rawTs === "object" && typeof rawTs.toNumber === "function") msgTimestamp = rawTs.toNumber();
        else {
          const n = Number(rawTs);
          msgTimestamp = Number.isFinite(n) ? n : parseInt(String(rawTs), 10) || 0;
        }
      }
      if (msgTimestamp && msgTimestamp < START_TIMESTAMP) {
        log(`[wa-worker] Skipping old message (ts=${msgTimestamp} < start=${START_TIMESTAMP})`);
        continue;
      }

      log(`[wa-worker] RAW MSG: fromMe=${msg.key.fromMe} remoteJid=${msg.key.remoteJid} ts=${msgTimestamp} keys=${Object.keys(msg.message || {}).join(",")}`);

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

      // A message is the user's self-chat (the "Message yourself" thread) only
      // when BOTH conditions hold:
      //   (a) fromMe === true — the user's account sent it from one of their
      //       linked devices
      //   (b) the remoteJid is the user's OWN JID — either their phone-number
      //       JID (`<number>@s.whatsapp.net`) or their own LID (`<lid>@lid`)
      //
      // The previous filter accepted any `@lid` JID as self-chat, which was
      // catastrophically wrong: WhatsApp's modern privacy mode assigns EVERY
      // contact a LID, so messages the user typed TO a friend (fromMe=true,
      // friend's @lid as remoteJid) were forwarded to AIOS as if they were
      // commands. Groups (@g.us) and broadcasts (@broadcast) are also rejected.
      if (!fromMe) {
        log(`[wa-worker] Ignored (not from me) from=${from}`);
        continue;
      }
      const fromUser = normalizeJidUser(from);
      const fromDomain = from.includes("@") ? from.slice(from.indexOf("@")) : "";
      const isOwnPhone = fromDomain === "@s.whatsapp.net" && !!myNumber && fromUser === myNumber;
      const isOwnLid = fromDomain === "@lid" && !!myLid && fromUser === myLid;
      if (!isOwnPhone && !isOwnLid) {
        log(`[wa-worker] Ignored (not own JID — outgoing to another contact) from=${from} myNumber=${myNumber} myLid=${myLid}`);
        continue;
      }

      const messageId = msg.key.id || "";
      if (alreadyProcessed(messageId)) {
        log(`[wa-worker] Skipping duplicate (already processed) id=${messageId} text="${text}"`);
        continue;
      }
      markProcessed(messageId);

      let command = text;
      if (command.startsWith("/")) command = command.substring(1).trim();
      log(`[wa-worker] COMMAND ACCEPTED: "${command}" (fromMe=${fromMe} jid=${from} id=${messageId})`);
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
      // Any `jid` field on the incoming IPC message is intentionally ignored;
      // sendToSelfOnly hardcodes the destination to the user's own number.
      await sendToSelfOnly({ text: msg.text });
    } catch (e) {
      log(`[wa-worker] Reply failed: ${e.message}`);
    }

  } else if (msg.type === "document") {
    log(`[wa-worker] Sending document...`);
    try {
      if (!msg.path) throw new Error("Document path is required");
      const sent = await sendToSelfOnly({
        document: { url: msg.path },
        fileName: msg.filename || "AIOS.pdf",
        mimetype: msg.mimetype || "application/pdf",
        caption: msg.caption || "",
      });
      if (!sent) throw new Error("WhatsApp socket is not connected");
      send({ type: "document_sent", requestId: msg.requestId, filename: msg.filename });
    } catch (e) {
      log(`[wa-worker] Document failed: ${e.message}`);
      send({ type: "document_error", requestId: msg.requestId, error: e.message });
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

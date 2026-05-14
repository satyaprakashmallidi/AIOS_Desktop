/**
 * whatsapp-worker.js — powered by @whiskeysockets/baileys
 * Pure WebSocket. No Puppeteer, no browser.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
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

// WhatsApp wraps some messages in container types — e.g. a document sent
// with a caption arrives as `documentWithCaptionMessage` whose `.message`
// field holds the actual documentMessage. Same for view-once and ephemeral
// messages. Unwrap once so downstream code can rely on a flat structure.
// `downloadMediaMessage` needs the wrapped message too, so we rebuild the
// outer `msg` with the unwrapped inner content rather than just returning
// the inner payload.
function unwrapMessageContainers(msg) {
  if (!msg || !msg.message) return msg;
  let m = msg.message;
  for (let i = 0; i < 4; i++) {
    if (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message) {
      m = m.documentWithCaptionMessage.message;
      continue;
    }
    if (m.ephemeralMessage && m.ephemeralMessage.message) {
      m = m.ephemeralMessage.message;
      continue;
    }
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message) {
      m = m.viewOnceMessageV2.message;
      continue;
    }
    if (m.viewOnceMessage && m.viewOnceMessage.message) {
      m = m.viewOnceMessage.message;
      continue;
    }
    break;
  }
  if (m === msg.message) return msg;
  return { ...msg, message: m };
}

// Best-effort filename for an inbound media message. Documents carry their
// original filename; images / videos / audio don't, so we synthesize one
// using the mime type. The scanner re-sanitizes before writing to disk.
function inferMediaFilename(msg) {
  const m = msg.message || {};
  const ts = Date.now();
  if (m.documentMessage && m.documentMessage.fileName) return m.documentMessage.fileName;
  if (m.imageMessage) {
    const mime = m.imageMessage.mimetype || "image/jpeg";
    const ext = (mime.split("/")[1] || "jpg").split(";")[0];
    return `whatsapp-${ts}.${ext}`;
  }
  if (m.videoMessage) {
    const mime = m.videoMessage.mimetype || "video/mp4";
    const ext = (mime.split("/")[1] || "mp4").split(";")[0];
    return `whatsapp-${ts}.${ext}`;
  }
  if (m.audioMessage) {
    const mime = m.audioMessage.mimetype || "audio/ogg";
    const ext = (mime.split("/")[1] || "ogg").split(";")[0];
    return `whatsapp-${ts}.${ext}`;
  }
  if (m.stickerMessage) {
    const mime = m.stickerMessage.mimetype || "image/webp";
    const ext = (mime.split("/")[1] || "webp").split(";")[0];
    return `whatsapp-sticker-${ts}.${ext}`;
  }
  return `whatsapp-${ts}.bin`;
}

function sanitizeFilename(name) {
  // Allow letters, digits, dot, dash, underscore, space; replace the rest
  // with underscore. Strip leading/trailing dots so the file can't escape
  // the target directory on Windows.
  const cleaned = String(name)
    .replace(/[^a-zA-Z0-9._\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return cleaned || `wa-file-${Date.now()}`;
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
        // The server has invalidated this session. Without removing the auth
        // state on disk, every subsequent worker spawn would load the same
        // dead session and get the same 401, leaving the user's "Connect"
        // modal stuck on "Starting…" forever. Wipe it ourselves so the next
        // start lands on the fresh-QR path. Best-effort — if the unlink
        // fails, scanner-side cleanup still has a chance to run.
        try {
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            log("[wa-worker] Session folder cleaned after loggedOut\n");
          }
        } catch (e) {
          log(`[wa-worker] Session cleanup after loggedOut failed: ${e.message}\n`);
        }
        send({ type: "disconnected", reason: "loggedOut" });
        // Small delay so the IPC message is flushed to the parent before
        // the process exits. process.send is best-effort; without the
        // delay the message can be dropped mid-flight on exit.
        setTimeout(() => process.exit(0), 200);
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

    for (const rawMsg of messages) {
      // Unwrap container variants (documentWithCaptionMessage, ephemeral,
      // view-once) so the rest of the loop can rely on msg.message having
      // the actual content at the top level. Without this, captioned
      // documents arrive as `documentWithCaptionMessage` and our detection
      // sees text="" and hasMedia=false and drops the message silently.
      const msg = unwrapMessageContainers(rawMsg);
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

      // Pull caption-or-conversation text from any of the message variants we
      // know how to handle. A media message may have a caption (the user's
      // "save this" / @mention) OR no caption at all.
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.documentMessage?.caption ||
        msg.message.videoMessage?.caption ||
        ""
      ).trim();

      // Did this message arrive with attached media? Covers every media
      // variant WhatsApp's protocol exposes through Baileys. Note: audio
      // (voice notes) and stickers do reach this branch, but WhatsApp's
      // mobile UI doesn't let the user attach a caption to either, so they
      // can never express save-intent and will always fall to the friendly
      // "I couldn't tell" hint on the scanner side. That's a platform
      // limitation, not a code gap.
      const hasMedia = !!(
        msg.message.imageMessage ||
        msg.message.documentMessage ||
        msg.message.videoMessage ||
        msg.message.audioMessage ||
        msg.message.stickerMessage
      );

      log(`[wa-worker] MSG from=${from} fromMe=${fromMe} text="${text}" hasMedia=${hasMedia}`);

      // Nothing actionable
      if (!text && !hasMedia) continue;

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

      // If the message carries media, download it to the OS temp dir and
      // forward the local path to the scanner. The scanner reads the caption
      // for save-intent ("save this", "keep this", etc.) and either copies
      // the file into context/import/whatsapp/ or discards it. Text-only
      // messages take the existing run_task / slash-command path.
      if (hasMedia) {
        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const originalName = inferMediaFilename(msg);
          const safeName = sanitizeFilename(originalName);
          const tempPath = path.join(os.tmpdir(), `wa-media-${Date.now()}-${safeName}`);
          fs.writeFileSync(tempPath, buffer);
          log(`[wa-worker] MEDIA RECEIVED: name="${originalName}" size=${buffer.length} caption="${text}" tempPath=${tempPath}`);
          send({
            type: "media",
            caption: text,
            tempPath,
            filename: originalName,
            size: buffer.length,
            jid: from
          });
        } catch (e) {
          log(`[wa-worker] Media download failed: ${e.message}`);
          // If the user also wrote a caption, fall back to treating it as a
          // plain text command so we don't silently drop it.
          if (text) {
            send({ type: "command", text, jid: from });
          }
        }
        continue;
      }

      // Text-only path. NOTE: we no longer strip a leading "/" here — the
      // scanner needs the raw text to detect slash commands like /new,
      // /clear, /prime, /help. Backwards-compatible: Claude doesn't care
      // whether a prompt happens to start with a slash.
      log(`[wa-worker] COMMAND ACCEPTED: "${text}" (fromMe=${fromMe} jid=${from} id=${messageId})`);
      send({ type: "command", text, jid: from });
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

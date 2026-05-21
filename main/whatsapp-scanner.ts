import { app, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { fork, ChildProcess } from "child_process";
import { log } from "./logger";
import { ensureRuntimeWorkspace } from "./workspace";
import { renderMarkdownFileToPdf } from "./pdf-export";

let workerProcess: ChildProcess | null = null;
let qrCodeData: string | null = null;
let clientStatus: "disconnected" | "qr" | "authenticating" | "connected" = "disconnected";
// User's own WhatsApp phone number, surfaced from the worker once the link is
// established. Displayed on the Connectors page as the WhatsApp Personal
// account label. Cleared on disconnect so a re-link can refresh it.
let connectedPhoneNumber: string | null = null;
let currentHost: any = null;
let currentWindow: BrowserWindow | null = null;
// Tracks the reason for the most recent disconnect (set by the worker's
// "disconnected" IPC message before the worker exits). The exit handler
// reads it to decide whether to auto-respawn (only on server-side
// loggedOut — never on user-initiated stops). Cleared on consumption.
let lastDisconnectReason: string | null = null;
let respawnInFlight = false;

type MarkdownArtifact = {
  relativePath: string;
  absolutePath: string;
  modifiedMs: number;
};

type PendingDocumentSend = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const pendingDocumentSends = new Map<string, PendingDocumentSend>();

const WHATSAPP_IMPORTS_FOLDER = "whatsapp";
const WHATSAPP_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

// Save-intent detection — broad keyword + phrase match so the user doesn't
// have to learn a precise phrase. Catches inflected forms (saving / saved /
// kept / imports / etc.) AND natural English like "add this photo" or
// "put it in imports". When in doubt about a real edge case the worker
// will err on the side of saving — better to over-import the occasional
// photo than to drop one the user clearly meant to keep.
function captionWantsSave(caption: string): boolean {
  if (!caption) return false;
  const lower = caption.toLowerCase();
  // Single-word save verbs in any common inflected form.
  if (/\b(save|saved|saving|keep|keeping|kept|store|stored|storing|import|imports|imported|importing|attach|attached|attaching|upload|uploaded|uploading)\b/i.test(lower)) {
    return true;
  }
  // "add this" / "add to imports" / "put it in" / "put this here" — verb +
  // pointer/target combinations that read as save-intent in normal English.
  if (/\b(add|put)\s+(this|that|it|to|in|the|file|photo|pic|picture|image|doc|document|pdf|video)\b/i.test(lower)) {
    return true;
  }
  return false;
}

// Mirror of the worker-side filename sanitizer, run again on the scanner
// side as a safety net before any disk write.
function sanitizeWorkspaceFilename(name: string): string {
  const cleaned = String(name || "")
    .replace(/[^a-zA-Z0-9._\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return cleaned || `wa-file-${Date.now()}`;
}

const WHATSAPP_HELP_TEXT = [
  "*AIOS WhatsApp commands*",
  "",
  "/new — start a fresh chat",
  "/clear — clear conversation context",
  "/prime — refresh AIOS context",
  "/help — show this list",
  "",
  "Mention an agent:",
  "@CEO summarise my week",
  "@Marketing draft a tweet about X",
  "",
  "Save a file:",
  "Send the photo or document with a caption like \"save this\" or \"keep this\". It lands in Imports → whatsapp."
].join("\n");

// Clears the persisted Claude session id on the WhatsApp Remote thread so
// the next message starts a brand-new Claude conversation context.
async function clearWhatsAppClaudeSession(host: any): Promise<void> {
  if (!host) return;
  const sessionId = "thread-whatsapp-remote";
  try {
    const res = await host.invoke("get_sessions", {}) as any;
    if (!res?.ok || !Array.isArray(res.data)) return;
    const session = res.data.find((s: any) => s.id === sessionId);
    if (!session) return;
    session.claudeSessionId = null;
    await host.invoke("save_session", { session });
  } catch (e) {
    log("whatsapp", "clearWhatsAppClaudeSession failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

// Returns true if `text` matched a known slash command and the scanner
// already replied + persisted it. Caller should `return` early in that case.
async function handleWhatsAppSlashCommand(text: string, host: any): Promise<boolean> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed === "/" || lower === "/help") {
    workerProcess?.send({ type: "reply", text: WHATSAPP_HELP_TEXT });
    if (host) {
      try { await persistToHistory(host, text, WHATSAPP_HELP_TEXT); } catch { /* logged inside */ }
    }
    return true;
  }

  if (lower === "/new" || lower === "/clear") {
    await clearWhatsAppClaudeSession(host);
    const reply = "Started a new chat. Old context cleared.";
    workerProcess?.send({ type: "reply", text: reply });
    if (host) {
      try { await persistToHistory(host, text, reply, undefined); } catch { /* logged inside */ }
    }
    return true;
  }

  if (lower === "/prime") {
    workerProcess?.send({ type: "reply", text: "Priming AIOS context — one moment…" });
    if (!host) return true;
    try {
      const res = await host.invoke("run_prime", {}) as any;
      const reply = (typeof res?.data?.response === "string" ? res.data.response : "").trim()
        || "Primed AIOS context.";
      workerProcess?.send({ type: "reply", text: reply });
      try { await persistToHistory(host, text, reply); } catch { /* logged inside */ }
    } catch (e) {
      const errMsg = `Couldn't run /prime: ${e instanceof Error ? e.message : String(e)}`;
      workerProcess?.send({ type: "reply", text: errMsg });
      try { await persistToHistory(host, text, errMsg); } catch { /* logged inside */ }
    }
    return true;
  }

  return false;
}

// Detects a leading "@AgentName " mention. Returns { remaining text, system
// prompt overlay } when the agent exists; null otherwise. Falls back silently
// when the agent registry can't be fetched so a typo doesn't dead-end the
// message — it just goes through as a normal Claude prompt.
async function extractWhatsAppMention(
  text: string,
  host: any
): Promise<{ promptText: string; systemPrompt: string } | null> {
  if (!host) return null;
  const m = text.match(/^@([A-Za-z][A-Za-z0-9_\-]*)\s+([\s\S]+)$/);
  if (!m) return null;
  const requestedName = m[1];
  const remaining = m[2].trim();
  if (!remaining) return null;

  try {
    const res = await host.invoke("list_agents", {}) as any;
    if (!res?.ok || !Array.isArray(res.data)) return null;
    const agent = res.data.find(
      (a: any) => typeof a?.name === "string" && a.name.toLowerCase() === requestedName.toLowerCase()
    );
    if (!agent) return null;
    const personaOverlay =
      `${WHATSAPP_SYSTEM_PROMPT}\n\n` +
      `You are ${agent.name}, the ${agent.role || "specialist"} on this user's AI team. ` +
      `Stay in character throughout this reply. Be concise, conversational, and decisive — ` +
      `answer like a real ${agent.role || "specialist"} would in a quick chat. ` +
      `Skip any preamble about who you are; just answer the user's question. ` +
      `Do NOT emit [ASSIGN_TASK:], [SPAWN_AGENT:], [NEEDS_CONNECTOR:], or [BLOCKED:] ` +
      `sentinels — this is a direct chat, not a background task.`;
    return { promptText: remaining, systemPrompt: personaOverlay };
  } catch {
    return null;
  }
}

const WHATSAPP_SYSTEM_PROMPT = [
  "You are AIOS, talking to the user through WhatsApp on their phone.",
  "Reply conversationally — the same tone you'd use in any chat app, not an email or essay. Length should match the question: short for short, longer when the user actually wants detail.",
  "WhatsApp renders plain text well; simple **bold**, *italic* and `-` bullet lists are fine. Skip `# headings` and long ``` code blocks ``` — they look ugly there.",
  "",
  "APPROVAL GATE — important.",
  "For any OUTBOUND or DESTRUCTIVE action you're asked to take (sending an email, posting a Slack/Discord/Telegram message, creating a calendar invite, updating a CRM, scheduling, payment, deleting data, contacting a real person) — do NOT execute on the first turn. Instead:",
  "1. Prepare the action fully — exact recipient(s), subject, full body, channel, time, amount. No placeholders.",
  "2. Show the user the complete preview in your reply (To, Subject, Body, etc).",
  "3. End your reply with a single line on its own: 'Reply *approve* to send, or tell me what to change.'",
  "Then STOP. Don't call the send/post/create tool yet.",
  "",
  "On the user's next message: if they reply approve / yes / send it / go / ok → execute the action via the tool, then confirm what happened in plain language (e.g. 'Sent.'). If they describe changes → re-draft and gate again. If they say cancel / nevermind → drop it and acknowledge.",
  "",
  "READ-ONLY work (looking things up, summarising, searching, drafting that isn't going anywhere) does NOT need the gate — just answer.",
  "If the user explicitly says 'just send it' or 'no need to ask' in their original request, honour that and skip the gate for that one action.",
  "",
  "When the user asks you to create a plan: save it under plans/ (run `python python/save_plan.py --title \"Title\" --content \"<FULL MARKDOWN>\"`), then end your reply with one line on its own:",
  "[AIOS_ARTIFACT: plans/<the-filename>.md]",
  "AIOS will deliver that plan to WhatsApp as a PDF automatically — your text reply just needs a short summary (one or two sentences). Don't paste the full markdown of the plan back into the chat.",
  "",
  "When the user asks you to implement, execute, or produce an output: save ONE consolidated markdown file under outputs/ and end with:",
  "[AIOS_ARTIFACT: outputs/<the-filename>.md]",
  "Same rule — the PDF carries the body, your text reply summarizes what you did.",
  "",
  "For anything else (questions, status checks, casual chat), just answer naturally — no marker, no preamble.",
].join("\n");

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isArtifactPath(relativePath: string): boolean {
  const normalized = normalizeWorkspacePath(relativePath);
  return (
    /\.md$/i.test(normalized) &&
    (normalized.startsWith("plans/") || normalized.startsWith("outputs/")) &&
    !normalized.includes("..")
  );
}

const ARTIFACT_MARKER_RE = /\[AIOS_ARTIFACT:\s*([^\]\r\n]+\.md)\s*\]/gi;

function extractArtifactMarker(response: string): string | null {
  ARTIFACT_MARKER_RE.lastIndex = 0;
  const match = ARTIFACT_MARKER_RE.exec(response);
  if (!match) return null;
  const normalized = normalizeWorkspacePath(match[1].trim());
  return isArtifactPath(normalized) ? normalized : null;
}

function stripArtifactMarkers(response: string): string {
  return response
    .replace(/^[ \t]*\[AIOS_ARTIFACT:[^\]\r\n]+\][ \t]*\r?\n?/gim, "")
    .replace(/\[AIOS_ARTIFACT:[^\]\r\n]+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function artifactFromRelativePath(relativePath: string): MarkdownArtifact | null {
  if (!isArtifactPath(relativePath)) return null;
  const root = ensureRuntimeWorkspace();
  const normalized = normalizeWorkspacePath(relativePath);
  const absolutePath = path.resolve(root, normalized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(absolutePath)) return null;
  const stat = fs.statSync(absolutePath);
  return { relativePath: normalized, absolutePath, modifiedMs: stat.mtimeMs };
}

function resolveArtifactFromReply(response: string): MarkdownArtifact | null {
  const markedPath = extractArtifactMarker(response);
  if (!markedPath) return null;
  return artifactFromRelativePath(markedPath);
}

async function markdownArtifactToPdf(artifact: MarkdownArtifact, mainWindow: BrowserWindow): Promise<{ path: string; filename: string; caption: string }> {
  const result = await renderMarkdownFileToPdf({
    sourcePath: artifact.absolutePath,
    parentWindow: mainWindow,
  });
  return {
    path: result.path,
    filename: result.filename,
    // No caption — Claude's text reply (sent as a separate WhatsApp message
    // right before this PDF) carries the conversational summary; a caption
    // here would just be redundant noise like "Plan attached as PDF.".
    caption: "",
  };
}

function sendDocumentAndWait(payload: { path: string; filename: string; caption: string; mimetype: string }): Promise<void> {
  if (!workerProcess) return Promise.reject(new Error("WhatsApp worker is not running"));
  const requestId = `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingDocumentSends.delete(requestId);
      reject(new Error("Timed out while sending WhatsApp document"));
    }, 45_000);
    pendingDocumentSends.set(requestId, { resolve, reject, timeout });
    workerProcess?.send({ type: "document", requestId, ...payload });
  });
}

export async function autoStartWhatsApp(host: any, mainWindow: BrowserWindow) {
  if (workerProcess) return;

  currentHost = host;
  currentWindow = mainWindow;

  const userDataPath = app.getPath("userData");
  const whatsappSessionPath = path.join(userDataPath, "whatsapp-session");

  if (fs.existsSync(whatsappSessionPath)) {
    const files = fs.readdirSync(whatsappSessionPath);
    if (files.length > 0) {
      log("whatsapp", "Found existing session, auto-starting...");
      startWhatsApp(host, mainWindow);
    }
  }
}

export function getWhatsAppStatus() {
  return { status: clientStatus, qr: qrCodeData, phoneNumber: connectedPhoneNumber };
}

// Handles a media file forwarded from the worker. Three outcomes:
//   1. Caption has save intent + file is within size cap → copy from temp into
//      <workspace>/context/import/whatsapp/<sanitized> + reply with success.
//   2. Caption has save intent but file is too large → reply with the cap.
//   3. No save intent → discard temp file; nudge the user with the keywords
//      so they know how to opt in next time.
// The temp file is always cleaned up afterwards regardless of outcome.
async function handleInboundMedia(msg: any, host: any): Promise<void> {
  const tempPath: string = String(msg.tempPath || "");
  const filename: string = String(msg.filename || "");
  const size: number = Number(msg.size) || 0;
  const caption: string = String(msg.caption || "");

  const cleanupTemp = () => {
    if (!tempPath) return;
    try { fs.unlinkSync(tempPath); } catch { /* file may already be gone */ }
  };

  if (!tempPath || !fs.existsSync(tempPath)) {
    log("whatsapp", "Media missing temp file", { tempPath });
    return;
  }

  if (!captionWantsSave(caption)) {
    cleanupTemp();
    const hint = caption
      ? "I wasn't sure if you wanted me to save that file. Try a caption like \"save this\" or \"add this to imports\" and send it again."
      : "Send the file again with a caption like \"save this\" or \"keep this in imports\" and I'll add it to the Imports tab.";
    workerProcess?.send({ type: "reply", text: hint });
    if (host) {
      try {
        const summary = caption ? `${caption}\n[attachment: ${filename}]` : `[attachment: ${filename}]`;
        await persistToHistory(host, summary, hint);
      } catch { /* logged inside */ }
    }
    return;
  }

  if (size > WHATSAPP_MEDIA_MAX_BYTES) {
    cleanupTemp();
    const mb = (size / 1024 / 1024).toFixed(1);
    const reply = `That file is ${mb} MB — too large to import over WhatsApp (max 25 MB). Upload it directly from the AIOS Imports page instead.`;
    workerProcess?.send({ type: "reply", text: reply });
    if (host) {
      try {
        await persistToHistory(host, `${caption}\n[attachment too large: ${filename}, ${mb} MB]`, reply);
      } catch { /* logged inside */ }
    }
    return;
  }

  try {
    const workspaceRoot = ensureRuntimeWorkspace();
    // The Imports page lives at <workspace>/context/import/ — folders inside
    // surface as first-class entries on that screen via list_imports.
    const importsDir = path.join(workspaceRoot, "context", "import", WHATSAPP_IMPORTS_FOLDER);
    fs.mkdirSync(importsDir, { recursive: true });

    let candidate = sanitizeWorkspaceFilename(filename);
    let destPath = path.join(importsDir, candidate);
    // Don't overwrite existing files — append -1, -2, ... before the extension.
    if (fs.existsSync(destPath)) {
      const ext = path.extname(candidate);
      const base = path.basename(candidate, ext);
      let n = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(importsDir, `${base}-${n}${ext}`);
        n += 1;
      }
      candidate = path.basename(destPath);
    }

    fs.copyFileSync(tempPath, destPath);
    cleanupTemp();

    const reply = `Saved "${candidate}" to Imports → ${WHATSAPP_IMPORTS_FOLDER}.`;
    workerProcess?.send({ type: "reply", text: reply });
    log("whatsapp", "Media saved to imports", { destPath, size, caption });
    if (host) {
      try {
        const persistedPrompt = caption
          ? `${caption}\n[attachment: ${filename}]`
          : `[attachment: ${filename}]`;
        await persistToHistory(host, persistedPrompt, reply);
      } catch { /* logged inside */ }
    }
  } catch (e) {
    cleanupTemp();
    const errMsg = `Couldn't save the file: ${e instanceof Error ? e.message : String(e)}`;
    workerProcess?.send({ type: "reply", text: errMsg });
    log("whatsapp", "Media save failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleWorkerMessage(msg: any, host: any, mainWindow: BrowserWindow) {
  if (!msg?.type) return;
  log("whatsapp", "Worker message", { type: msg.type });

  if (msg.type === "document_sent" || msg.type === "document_error") {
    const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
    const pending = pendingDocumentSends.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingDocumentSends.delete(requestId);
    if (msg.type === "document_error") {
      pending.reject(new Error(String(msg.error || "WhatsApp document send failed")));
    } else {
      pending.resolve();
    }
  } else if (msg.type === "qr") {
    qrCodeData = msg.data;
    clientStatus = "qr";
    broadcastStatus(mainWindow);
  } else if (msg.type === "authenticated") {
    clientStatus = "authenticating";
    broadcastStatus(mainWindow);
  } else if (msg.type === "ready") {
    qrCodeData = null;
    clientStatus = "connected";
    connectedPhoneNumber = typeof msg.myNumber === "string" && msg.myNumber ? msg.myNumber : connectedPhoneNumber;
    broadcastStatus(mainWindow);
  } else if (msg.type === "disconnected") {
    clientStatus = "disconnected";
    connectedPhoneNumber = null;
    qrCodeData = null;
    // Track the reason so the exit handler can auto-respawn when WhatsApp
    // logs us out. The worker already wipes its own session in that case;
    // we just need to make sure the next spawn happens so the user sees a
    // fresh QR without manually clicking Connect again.
    lastDisconnectReason = typeof msg.reason === "string" ? msg.reason : null;
    if (lastDisconnectReason === "loggedOut") {
      log("whatsapp", "WhatsApp server logged us out — will respawn after worker exits");
      // Defensive: also clear the sidecar files in case the worker didn't.
      const userDataPath = app.getPath("userData");
      for (const sidecar of ["wa-my-lid.txt", "wa-processed-ids.json"]) {
        const file = path.join(userDataPath, sidecar);
        if (fs.existsSync(file)) {
          try { fs.unlinkSync(file); } catch { /* non-fatal */ }
        }
      }
    }
    broadcastStatus(mainWindow);
  } else if (msg.type === "media") {
    await handleInboundMedia(msg, host);
  } else if (msg.type === "command") {
    const text: string = msg.text;
    // `jid` is kept locally only so the audit log records which inbound JID this
    // command came from. It is NEVER forwarded to the worker — every outbound
    // send is hardcoded to the user's own number@s.whatsapp.net by the worker's
    // sendToSelfOnly helper.
    const inboundJid: string | undefined = msg.jid;
    console.log(`[whatsapp] Command received: "${text}" from ${inboundJid}`);
    log("whatsapp", "Command received", { text, inboundJid });

    if (text.toLowerCase() === "ping") {
      const reply = "AIOS is online 🟢";
      workerProcess?.send({ type: "reply", text: reply });
      if (host) {
        try { await persistToHistory(host, text, reply); } catch { /* logged inside */ }
      }
      return;
    }

    // Slash commands handled locally, no Claude roundtrip. Returns true when
    // the command matched + has been answered.
    if (await handleWhatsAppSlashCommand(text, host)) {
      return;
    }

    // @AgentName routing — strips the mention prefix and overlays the agent's
    // chat persona on the Claude system prompt. Falls back to a normal run
    // if the mention doesn't resolve to a real agent.
    const mention = await extractWhatsAppMention(text, host);
    const promptText = mention ? mention.promptText : text;
    const taskSystemPrompt = mention ? mention.systemPrompt : WHATSAPP_SYSTEM_PROMPT;

    if (host) {
      try {
        const claudeSessionId = await getWhatsAppClaudeSessionId(host);
        const runTaskArgs: Record<string, unknown> = {
          prompt: promptText,
          streamId: "whatsapp-remote", // Consistent ID for history grouping
          systemPrompt: taskSystemPrompt,
          // Haiku is built for low-latency conversational replies. On the
          // in-app chat we use the user's default model (Sonnet / Opus) because
          // they can see streaming and tolerate the wait, but on WhatsApp the
          // user is staring at a phone with no progress signal — a 10s gap
          // feels broken. Haiku 4.5 brings casual replies down to ~1-3s and
          // still handles plan / output generation through the same prompt.
          model: "haiku",
        };
        if (claudeSessionId) {
          runTaskArgs.sessionId = claudeSessionId;
        }
        const res = await host.invoke("run_task", runTaskArgs) as any;
        const rawReply = typeof res?.data?.response === "string" ? res.data.response : "";
        const nextClaudeSessionId = typeof res?.data?.sessionId === "string" ? res.data.sessionId : undefined;

        const artifact = resolveArtifactFromReply(rawReply);
        const cleanReply = stripArtifactMarkers(rawReply);

        // Send the natural text reply first (if there is one), then the PDF as
        // a follow-up attachment. This mirrors how a person would chat: a quick
        // message saying what they did, then the file.
        if (cleanReply) {
          workerProcess?.send({ type: "reply", text: cleanReply });
        }

        if (artifact) {
          try {
            const pdf = await markdownArtifactToPdf(artifact, mainWindow);
            await sendDocumentAndWait({
              path: pdf.path,
              filename: pdf.filename,
              caption: pdf.caption,
              mimetype: "application/pdf",
            });
            // The chat bubble now shows a file chip for this attachment, so the
            // assistant message no longer needs to spell out "[Sent foo.pdf]"
            // — the chip is more useful (clicks open the file in AIOS) and
            // less noisy than a bracketed filename in the text.
            const kind: "plan" | "output" = artifact.relativePath.startsWith("plans/") ? "plan" : "output";
            const sourceFilename = artifact.relativePath.split("/").pop() || pdf.filename;
            const persistedText = cleanReply || (kind === "plan" ? "Saved the plan." : "Saved the output.");
            await persistToHistory(host, text, persistedText, nextClaudeSessionId, [
              { kind, path: artifact.relativePath, filename: sourceFilename }
            ]);
            return;
          } catch (pdfError) {
            log("whatsapp", "PDF delivery failed", {
              artifact: artifact.relativePath,
              error: pdfError instanceof Error ? pdfError.message : String(pdfError),
            });
            const fallback = "I saved the file but couldn't send the PDF — you can open it in AIOS.";
            workerProcess?.send({ type: "reply", text: fallback });
            const persisted = cleanReply ? `${cleanReply}\n\n${fallback}` : fallback;
            await persistToHistory(host, text, persisted, nextClaudeSessionId);
            return;
          }
        }

        if (!cleanReply) {
          log("whatsapp", "run_task returned empty response", {
            ok: Boolean(res?.ok),
            dataKeys: res?.data && typeof res.data === "object" ? Object.keys(res.data) : [],
          });
          const fallback = "Hmm, I didn't have a reply for that — try asking another way?";
          workerProcess?.send({ type: "reply", text: fallback });
          await persistToHistory(host, text, fallback, nextClaudeSessionId);
          return;
        }

        await persistToHistory(host, text, cleanReply, nextClaudeSessionId);
      } catch (e) {
        workerProcess?.send({ type: "reply", text: `AIOS Error: ${e instanceof Error ? e.message : String(e)}` });
      }
    } else {
      workerProcess?.send({ type: "reply", text: "AIOS Host is disconnected." });
    }
  }
}

async function getWhatsAppClaudeSessionId(host: any): Promise<string | undefined> {
  const sessionId = "thread-whatsapp-remote";
  try {
    const sessionsRes: any = await host.invoke("get_sessions", {});
    if (!sessionsRes?.ok || !Array.isArray(sessionsRes.data)) return undefined;
    const session = sessionsRes.data.find((s: any) => s.id === sessionId);
    return typeof session?.claudeSessionId === "string" && session.claudeSessionId
      ? session.claudeSessionId
      : undefined;
  } catch (e) {
    log("whatsapp", "getWhatsAppClaudeSessionId failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}

type PersistedAttachment = { kind: "plan" | "output"; path: string; filename: string };

async function persistToHistory(
  host: any,
  userPrompt: string,
  assistantResponse: string,
  claudeSessionId?: string,
  attachments?: PersistedAttachment[]
) {
  try {
    const sessionId = "thread-whatsapp-remote";

    // 1. Get existing sessions, with one retry. If BOTH reads fail we bail —
    //    overwriting the saved thread with a fresh empty session would wipe
    //    every prior WhatsApp exchange (which is what was happening before).
    let sessionsRes: any = await host.invoke("get_sessions", {});
    if (!sessionsRes?.ok) {
      await new Promise((r) => setTimeout(r, 150));
      sessionsRes = await host.invoke("get_sessions", {});
    }
    if (!sessionsRes?.ok || !Array.isArray(sessionsRes.data)) {
      log("whatsapp", "persistToHistory aborted — get_sessions failed twice", { sessionId });
      return;
    }
    const sessions: any[] = sessionsRes.data;

    // 2. Find existing session OR create fresh. The find-or-create is safe
    //    now because we only get here when the read succeeded — if the
    //    thread genuinely doesn't exist yet, it's truly empty.
    let session = sessions.find((s: any) => s.id === sessionId);
    if (!session) {
      session = {
        id: sessionId,
        title: "WhatsApp Remote",
        messages: [],
        updatedAt: new Date().toISOString(),
        claudeSessionId: null
      };
    }

    // 3. Append messages
    const now = new Date().toISOString();
    if (!session.messages) session.messages = [];
    session.messages.push({
      id: `msg-${Date.now()}-u`,
      role: "user",
      content: userPrompt,
      createdAt: now
    });
    const assistantMessage: Record<string, unknown> = {
      id: `msg-${Date.now()}-a`,
      role: "assistant",
      content: assistantResponse,
      createdAt: now
    };
    if (attachments && attachments.length > 0) {
      assistantMessage.attachments = attachments;
    }
    session.messages.push(assistantMessage);
    session.updatedAt = now;
    if (claudeSessionId) {
      session.claudeSessionId = claudeSessionId;
    }

    // 4. Save back
    const saveRes = await host.invoke("save_session", { session }) as any;
    if (!saveRes?.ok) {
      log("whatsapp", "persistToHistory save_session failed", { sessionId, len: session.messages.length });
    }
    
    // 5. Notify UI to refresh history (so it pops up in the sidebar immediately)
    if (currentWindow && !currentWindow.isDestroyed()) {
      console.log(`[whatsapp] Broadcasting session_updated for ${sessionId}`);
      currentWindow.webContents.send("aios:host-event", { event: "session_updated", sessionId });
    }
  } catch (e) {
    console.error(`[whatsapp] History persistence error:`, e);
  }
}




export function startWhatsApp(host: any, mainWindow: BrowserWindow) {
  if (workerProcess) return { status: clientStatus };

  currentHost = host;
  currentWindow = mainWindow;

  const userDataPath = app.getPath("userData");
  const sessionPath = path.join(userDataPath, "whatsapp-session");
  // The worker is a plain .js file — in dev it lives in main/, in prod it lives next to compiled main files
  const workerScript = app.isPackaged
    ? path.join(__dirname, "whatsapp-worker.js")
    : path.join(app.getAppPath(), "main", "whatsapp-worker.js");

  if (!fs.existsSync(workerScript)) {
    log("whatsapp", "Worker script not found", { workerScript });
    clientStatus = "disconnected";
    broadcastStatus(mainWindow);
    return { status: "disconnected", error: "Worker not found" };
  }

  log("whatsapp", "Spawning WhatsApp worker process", { workerScript, sessionPath });

  workerProcess = fork(workerScript, [], {
    env: {
      ...process.env,
      WHATSAPP_SESSION_PATH: sessionPath,
      ELECTRON_RUN_AS_NODE: "1",
    },
    silent: true,
    execArgv: [], // Don't pass --inspect or other flags that break IPC
  });

  // stdout: worker sends JSON lines as fallback when process.send isn't available
  workerProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        log("whatsapp.worker.ipc", `Got message via stdout: ${msg.type}`);
        handleWorkerMessage(msg, host, mainWindow);
      } catch {
        log("whatsapp.worker.stdout", line);
      }
    }
  });

  workerProcess.stderr?.on("data", (data) => {
    log("whatsapp.worker", data.toString().trim());
  });

  workerProcess.on("message", async (msg: any) => {
    handleWorkerMessage(msg, host, mainWindow);
  });

  // Mirror of the python-host fix: fork() can fail asynchronously on
  // 'error' with no exit event. Common failure modes on Mac:
  //   - ENOENT if the worker script path resolved wrong (packaged vs
  //     dev path mismatch)
  //   - EACCES if the worker script lost its exec bit during DMG copy
  //   - ELECTRON_RUN_AS_NODE not honored on some Electron versions
  // Without this listener the error bubbles up as an uncaughtException
  // and crashes the main process — taking the whole app down on Mac
  // anytime WhatsApp auto-start ran into trouble.
  workerProcess.on("error", (err) => {
    log("whatsapp", "Worker process error", { error: err.message });
    workerProcess = null;
    clientStatus = "disconnected";
    connectedPhoneNumber = null;
    for (const [, pending] of pendingDocumentSends) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`WhatsApp worker error: ${err.message}`));
    }
    pendingDocumentSends.clear();
    broadcastStatus(mainWindow);
  });

  workerProcess.on("exit", (code) => {
    log("whatsapp", "Worker process exited", { code });
    workerProcess = null;
    clientStatus = "disconnected";
    connectedPhoneNumber = null;
    // Reject any in-flight document sends so the caller's catch block fires
    // immediately instead of waiting out the 45s timeout against a dead worker.
    for (const [, pending] of pendingDocumentSends) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("WhatsApp worker exited before the document was sent"));
    }
    pendingDocumentSends.clear();
    broadcastStatus(mainWindow);

    // Auto-respawn once after a server-side loggedOut. The worker already
    // cleaned its session folder in that case, so the new spawn lands on
    // the fresh-QR pairing path — the user's open "Connect" modal goes
    // straight from "Starting…" to showing a QR without a manual retry.
    // Guarded by `respawnInFlight` so we never get stuck in a tight loop.
    if (lastDisconnectReason === "loggedOut" && !respawnInFlight && currentHost && currentWindow) {
      respawnInFlight = true;
      lastDisconnectReason = null;
      const respawnHost = currentHost;
      const respawnWindow = currentWindow;
      setTimeout(() => {
        respawnInFlight = false;
        if (!workerProcess && respawnHost && respawnWindow && !respawnWindow.isDestroyed()) {
          log("whatsapp", "Auto-respawning after server loggedOut (session was cleaned)");
          startWhatsApp(respawnHost, respawnWindow);
        }
      }, 500);
    } else {
      lastDisconnectReason = null;
    }
  });

  clientStatus = "authenticating";
  broadcastStatus(mainWindow);

  return { status: clientStatus };
}

export async function stopWhatsApp(mainWindow: BrowserWindow) {
  if (workerProcess) {
    try { workerProcess.send({ type: "stop" }); } catch {}
    workerProcess.kill();
    workerProcess = null;
  }
  clientStatus = "disconnected";
  qrCodeData = null;
  connectedPhoneNumber = null;

  // Delete the saved session so the next Start Scanner shows a fresh QR.
  // Also clear the sidecar dedup + LID files — they belong to the account
  // that just disconnected; carrying them over to a re-pair (potentially
  // under a different number) would silently leak state across identities.
  const userDataPath = app.getPath("userData");
  const sessionPath = path.join(userDataPath, "whatsapp-session");
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    log("whatsapp", "Session folder deleted — user will re-scan QR next time");
  }
  for (const sidecar of ["wa-my-lid.txt", "wa-processed-ids.json"]) {
    const file = path.join(userDataPath, sidecar);
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); log("whatsapp", `Removed ${sidecar}`); }
      catch { /* non-fatal */ }
    }
  }

  broadcastStatus(mainWindow);
  return { ok: true };
}


function broadcastStatus(mainWindow: BrowserWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("aios:update-state", {
      state: "whatsapp_update",
      status: clientStatus,
      qr: qrCodeData,
      phoneNumber: connectedPhoneNumber,
    });
  }
}

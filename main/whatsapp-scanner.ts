import { app, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { fork, ChildProcess } from "child_process";
import { log } from "./logger";
import { ensureRuntimeWorkspace } from "./workspace";

let workerProcess: ChildProcess | null = null;
let qrCodeData: string | null = null;
let clientStatus: "disconnected" | "qr" | "authenticating" | "connected" = "disconnected";
// User's own WhatsApp phone number, surfaced from the worker once the link is
// established. Displayed on the Connectors page as the WhatsApp Personal
// account label. Cleared on disconnect so a re-link can refresh it.
let connectedPhoneNumber: string | null = null;
let currentHost: any = null;
let currentWindow: BrowserWindow | null = null;

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

const WHATSAPP_SYSTEM_PROMPT = [
  "You are AIOS, talking to the user through WhatsApp on their phone.",
  "Reply conversationally — the same tone you'd use in any chat app, not an email or essay. Length should match the question: short for short, longer when the user actually wants detail.",
  "WhatsApp renders plain text well; simple **bold**, *italic* and `-` bullet lists are fine. Skip `# headings` and long ``` code blocks ``` — they look ugly there.",
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${renderInlineMarkdown((unordered || ordered)![1])}</li>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  closeList();
  return html.join("\n");
}

function pdfHtmlForMarkdown(markdown: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; margin: 0; padding: 40px; line-height: 1.58; }
    main { max-width: 760px; margin: 0 auto; }
    h1 { font-size: 28px; margin: 0 0 18px; letter-spacing: -0.02em; }
    h2 { font-size: 20px; margin: 28px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 16px; margin: 22px 0 8px; }
    h4 { font-size: 14px; margin: 18px 0 6px; color: #374151; }
    p { margin: 8px 0 13px; }
    ul, ol { margin: 8px 0 14px; padding-left: 24px; }
    li { margin: 4px 0; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-size: 0.92em; }
    pre { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; overflow: hidden; white-space: pre-wrap; }
    blockquote { margin: 14px 0; padding: 8px 14px; border-left: 3px solid #6b7d72; background: #f8faf7; color: #374151; }
  </style>
</head>
<body><main>${markdownToHtml(markdown)}</main></body>
</html>`;
}

async function markdownArtifactToPdf(artifact: MarkdownArtifact, mainWindow: BrowserWindow): Promise<{ path: string; filename: string; caption: string }> {
  const markdown = fs.readFileSync(artifact.absolutePath, "utf8");
  const baseName = path.basename(artifact.relativePath, path.extname(artifact.relativePath));
  const filename = `${baseName}.pdf`;
  const pdfDir = path.join(app.getPath("userData"), "whatsapp-pdfs");
  fs.mkdirSync(pdfDir, { recursive: true });
  const outputPath = path.join(pdfDir, filename);

  const html = pdfHtmlForMarkdown(markdown, baseName);
  const pdfWindow = new BrowserWindow({
    show: false,
    parent: mainWindow,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await pdfWindow.loadURL(`data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`);
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: "default" },
      pageSize: "A4",
    });
    fs.writeFileSync(outputPath, pdf);
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
  }

  return {
    path: outputPath,
    filename,
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
    broadcastStatus(mainWindow);
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

    if (host) {
      try {
        const claudeSessionId = await getWhatsAppClaudeSessionId(host);
        const runTaskArgs: Record<string, unknown> = {
          prompt: text,
          streamId: "whatsapp-remote", // Consistent ID for history grouping
          systemPrompt: WHATSAPP_SYSTEM_PROMPT,
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

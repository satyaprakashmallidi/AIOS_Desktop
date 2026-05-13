import { app, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { fork, ChildProcess } from "child_process";
import { log } from "./logger";

let workerProcess: ChildProcess | null = null;
let qrCodeData: string | null = null;
let clientStatus: "disconnected" | "qr" | "authenticating" | "connected" = "disconnected";
let currentHost: any = null;
let currentWindow: BrowserWindow | null = null;

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
  return { status: clientStatus, qr: qrCodeData };
}

async function handleWorkerMessage(msg: any, host: any, mainWindow: BrowserWindow) {
  if (!msg?.type) return;
  log("whatsapp", "Worker message", { type: msg.type });

  if (msg.type === "qr") {
    qrCodeData = msg.data;
    clientStatus = "qr";
    broadcastStatus(mainWindow);
  } else if (msg.type === "authenticated") {
    clientStatus = "authenticating";
    broadcastStatus(mainWindow);
  } else if (msg.type === "ready") {
    qrCodeData = null;
    clientStatus = "connected";
    broadcastStatus(mainWindow);
  } else if (msg.type === "disconnected") {
    clientStatus = "disconnected";
    broadcastStatus(mainWindow);
  } else if (msg.type === "command") {
    const text: string = msg.text;
    const jid: string | undefined = msg.jid;
    console.log(`[whatsapp] Command received: "${text}" from ${jid}`);
    log("whatsapp", "Command received", { text });


    if (text.toLowerCase() === "ping") {
      const reply = "AIOS is online 🟢";
      workerProcess?.send({ type: "reply", text: reply, jid });
      // Persist the ping exchange to the WhatsApp Remote thread too — without
      // this every ping was silently missing from the in-app history.
      if (host) {
        try { await persistToHistory(host, text, reply); } catch { /* logged inside */ }
      }
      return;
    }

    if (host) {
      try {
        const res = await host.invoke("run_task", {
          prompt: text,
          streamId: "whatsapp-remote", // Consistent ID for history grouping
        }) as any;
        const reply = res?.ok && res.data?.response
          ? res.data.response
          : "AIOS completed but returned no text.";

        // Persist to local history so it shows in the UI
        await persistToHistory(host, text, reply);

        workerProcess?.send({ type: "reply", text: reply, jid });
      } catch (e) {
        workerProcess?.send({ type: "reply", text: `AIOS Error: ${e instanceof Error ? e.message : String(e)}`, jid });
      }
    } else {
      workerProcess?.send({ type: "reply", text: "AIOS Host is disconnected.", jid });
    }
  }
}

async function persistToHistory(host: any, userPrompt: string, assistantResponse: string) {
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
    session.messages.push({
      id: `msg-${Date.now()}-a`,
      role: "assistant",
      content: assistantResponse,
      createdAt: now
    });
    session.updatedAt = now;

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

  // Delete the saved session so the next Start Scanner shows a fresh QR
  const sessionPath = path.join(app.getPath("userData"), "whatsapp-session");
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    log("whatsapp", "Session folder deleted — user will re-scan QR next time");
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
    });
  }
}

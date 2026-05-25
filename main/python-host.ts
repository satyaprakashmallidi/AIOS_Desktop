import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { app } from "electron";
import type { AiosCommand, HostEvent, HostResponse } from "./types";
import { log } from "./logger";

interface PendingCall {
  resolve: (value: HostResponse) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

interface PythonCommand {
  command: string;
  argsPrefix: string[];
}

export class PythonHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private pending = new Map<string, PendingCall>();
  private eventHandlers = new Set<(event: HostEvent) => void>();
  private seq = 0;

  constructor(
    private readonly workspaceRoot: string,
    private readonly starterKitRoot: string
  ) {}

  start(): void {
    if (this.child) return;
    // In a packaged build prefer the bundled PyInstaller binary so users
    // never need Python installed. Fall back to system Python in dev.
    const bundled = this.findBundledHost();
    if (bundled) {
      this.child = spawn(bundled, [], {
        cwd: this.workspaceRoot,
        env: {
          ...process.env,
          AIOS_WORKSPACE_ROOT: this.workspaceRoot,
          AIOS_STARTER_KIT_ROOT: this.starterKitRoot
        },
        stdio: "pipe",
        windowsHide: true
      });
    } else {
      const candidates = [
        path.join(app.getAppPath(), "python", "host.py"),
        path.resolve(__dirname, "..", "..", "python", "host.py"),
        path.resolve(process.cwd(), "python", "host.py")
      ];
      const pythonHostPath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!pythonHostPath) {
        throw new Error(`Python host script was not found. Checked: ${candidates.join(", ")}`);
      }
      const python = this.findPythonCommand();
      this.child = spawn(python.command, [...python.argsPrefix, pythonHostPath], {
        cwd: this.workspaceRoot,
        env: {
          ...process.env,
          AIOS_WORKSPACE_ROOT: this.workspaceRoot,
          AIOS_STARTER_KIT_ROOT: this.starterKitRoot
        },
        stdio: "pipe",
        windowsHide: true
      });
    }

    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk: Buffer) => log("python.stderr", chunk.toString("utf8")));

    // Catch spawn errors. Without this listener Node would either crash
    // the process on the next tick (uncaught 'error') OR — depending on
    // the failure mode — silently leave us with a broken ChildProcess
    // and every IPC call would hang for the full 700 s timeout before
    // rejecting. On Mac the most common spawn failures are:
    //   - PyInstaller binary missing from the bundle (build regression)
    //   - Binary's exec bit dropped (codesign or DMG copy stripped it)
    //   - Quarantine attribute on a fresh download that Gatekeeper
    //     hasn't cleared yet
    //   - ENOENT on the resolved path (broken symlink, etc.)
    // We reject every pending IPC immediately so the renderer's
    // warmup retry can stop spinning, and we null out `this.child`
    // so the next .invoke() call respawns cleanly.
    this.child.on("error", (err) => {
      log("python", "host spawn error", { error: err.message });
      this.child = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Python host failed to start: ${err.message}`));
      }
      this.pending.clear();
    });

    // EPIPE / write errors when the sidecar has died but Node hasn't
    // observed the exit yet. Without this listener the error would
    // surface as an uncaughtException and crash the main process.
    this.child.stdin.on("error", (err) => {
      log("python", "stdin error", { error: err.message });
    });

    this.child.on("exit", (code) => {
      log("python", "host exited", { code });
      this.child = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Python host exited before responding to ${id}`));
      }
      this.pending.clear();
    });
  }

  // Look for the PyInstaller-built sidecar binary inside the packaged app.
  // electron-builder places extraResources at:
  //   macOS:   <app>/Contents/Resources/aios-host/aios-host
  //   Windows: <app>/resources/aios-host/aios-host.exe
  //   Linux:   <app>/resources/aios-host/aios-host
  // If we're in dev (unpackaged) this returns null and we fall back to
  // system Python.
  private findBundledHost(): string | null {
    if (!app.isPackaged) return null;
    const exeName = process.platform === "win32" ? "aios-host.exe" : "aios-host";
    const candidate = path.join(process.resourcesPath, "aios-host", exeName);
    return fs.existsSync(candidate) ? candidate : null;
  }

  private pythonCandidates(): PythonCommand[] {
    if (process.env.AIOS_PYTHON) {
      return [{ command: process.env.AIOS_PYTHON, argsPrefix: [] }];
    }
    return process.platform === "win32"
      ? [
          { command: "py", argsPrefix: ["-3"] },
          { command: "python", argsPrefix: [] },
          { command: "python3", argsPrefix: [] }
        ]
      : [
          { command: "python3", argsPrefix: [] },
          { command: "python", argsPrefix: [] }
        ];
  }

  private findPythonCommand(): PythonCommand {
    const candidates = this.pythonCandidates();
    for (const candidate of candidates) {
      const result = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
        encoding: "utf8",
        windowsHide: true
      });
      if (!result.error && result.status === 0) return candidate;
    }
    const tried = candidates.map((candidate) => [candidate.command, ...candidate.argsPrefix].join(" ")).join(", ");
    throw new Error(`Python interpreter was not found. Set AIOS_PYTHON or install one of: ${tried}`);
  }

  // Aggressive termination — the previous version sent SIGTERM and returned
  // synchronously. PyInstaller-bundled Python ignores SIGTERM during startup
  // and spawns helper subprocesses that need to die individually. Worst-case
  // symptom (reported v0.2.51): after closing the app, the next launch can't
  // start because a stale aios-host process is still holding the SQLite WAL
  // lock. User had to restart their laptop to recover.
  //
  // Fix: SIGTERM → wait 300ms → SIGKILL if still alive → wait for exit event
  // up to 800ms. On Windows, taskkill /F /T /pid kills the whole process tree
  // (PyInstaller bootloader + child).
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return;
    const pid = child.pid;
    try {
      if (process.platform === "win32" && pid) {
        // Single hard kill of the whole tree; ignore non-zero exit (process
        // may already be dead).
        const { spawn } = await import("node:child_process");
        spawn("taskkill", ["/F", "/T", "/pid", String(pid)], { windowsHide: true, stdio: "ignore" }).unref();
      } else {
        child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!child.killed && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }
      // Wait for actual exit (up to 800ms) so we don't return while the
      // process still holds file locks.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 800);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    } catch {
      // Never throw from cleanup — the app is quitting anyway.
    }
  }

  onEvent(callback: (event: HostEvent) => void): () => void {
    this.eventHandlers.add(callback);
    return () => this.eventHandlers.delete(callback);
  }

  emitEvent(event: HostEvent): void {
    for (const handler of this.eventHandlers) handler(event);
  }

  invoke<T = unknown>(cmd: AiosCommand, args: Record<string, unknown> = {}, timeoutMs = 700000): Promise<HostResponse<T>> {
    this.start();
    if (!this.child) return Promise.reject(new Error("Python host did not start"));

    const id = `main-${Date.now()}-${++this.seq}`;
    const payload = JSON.stringify({ id, cmd, args });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Python host timed out for ${cmd}`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolve as (value: HostResponse) => void, reject, timeout });

      // Guard the write. If the sidecar died but Node hasn't observed
      // the exit yet, stdin may be unwritable (.writable === false) or
      // .write() may throw EPIPE synchronously. Without this guard the
      // IPC would sit in the pending map for the full 700 s timeout
      // before rejecting — the renderer would freeze that long. Reject
      // fast with a specific reason instead.
      const child = this.child;
      if (!child || child.killed || !child.stdin || !child.stdin.writable) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error(`Python host stdin is not writable for ${cmd}`));
        return;
      }
      try {
        child.stdin.write(`${payload}\n`);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleStdout(data: string): void {
    this.buffer += data;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let response: HostResponse | HostEvent;
    try {
      response = JSON.parse(line) as HostResponse | HostEvent;
    } catch {
      log("python.stdout", "non-json output", { line });
      return;
    }

    if ("event" in response) {
      for (const handler of this.eventHandlers) handler(response);
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      log("python", "unexpected response", response);
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    pending.resolve(response);
  }
}

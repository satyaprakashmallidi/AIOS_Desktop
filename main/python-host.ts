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

  constructor(private readonly workspaceRoot: string) {}

  start(): void {
    if (this.child) return;
    // In a packaged build prefer the bundled PyInstaller binary so users
    // never need Python installed. Fall back to system Python in dev.
    const bundled = this.findBundledHost();
    if (bundled) {
      this.child = spawn(bundled, [], {
        cwd: this.workspaceRoot,
        env: { ...process.env, AIOS_WORKSPACE_ROOT: this.workspaceRoot },
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
        env: { ...process.env, AIOS_WORKSPACE_ROOT: this.workspaceRoot },
        stdio: "pipe",
        windowsHide: true
      });
    }

    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk: Buffer) => log("python.stderr", chunk.toString("utf8")));
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

  stop(): void {
    this.child?.kill();
    this.child = null;
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
      this.child?.stdin.write(`${payload}\n`);
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

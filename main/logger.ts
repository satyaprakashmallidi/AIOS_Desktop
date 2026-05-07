import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

let logFile: string | null = null;

export function initLogger(workspaceRoot: string): void {
  const logsDir = path.join(workspaceRoot, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  logFile = path.join(logsDir, "desktop.log");
}

export function log(scope: string, message: string, meta?: unknown): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    scope,
    message,
    meta: meta ?? null
  });
  if (!logFile) {
    const fallback = path.join(app.getPath("userData"), "desktop.log");
    fs.appendFileSync(fallback, `${line}\n`);
    return;
  }
  fs.appendFileSync(logFile, `${line}\n`);
}

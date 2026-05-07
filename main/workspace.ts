import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const ignoredCopyNames = new Set([".DS_Store", "__MACOSX"]);

function copyDirClean(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignoredCopyNames.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirClean(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

export function getWorkspaceRoot(): string {
  const legacyRoot = path.join(app.getPath("home"), "Library", "Application Support", "aios-desktop", "ai-sales-os");
  const currentRoot = path.join(app.getPath("userData"), "ai-sales-os");
  if (process.platform === "darwin" && fs.existsSync(path.join(legacyRoot, "CLAUDE.md"))) {
    return legacyRoot;
  }
  return currentRoot;
}

export function getSourceStarterKit(): string {
  const appPath = app.getAppPath();
  const candidates = [
    path.resolve(appPath, "..", "aios-starter-kit"),
    path.resolve(appPath, "..", "..", "aios-starter-kit"),
    path.resolve(process.cwd(), "..", "aios-starter-kit"),
    path.resolve(process.cwd(), "aios-starter-kit")
  ];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, "CLAUDE.md")));
  if (!found) {
    throw new Error(`Unable to locate aios-starter-kit. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

export function ensureRuntimeWorkspace(): string {
  const workspaceRoot = getWorkspaceRoot();
  const marker = path.join(workspaceRoot, "CLAUDE.md");
  if (!fs.existsSync(marker)) {
    copyDirClean(getSourceStarterKit(), workspaceRoot);
  }
  fs.mkdirSync(path.join(workspaceRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "logs"), { recursive: true });
  return workspaceRoot;
}

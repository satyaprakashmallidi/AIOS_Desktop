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
  // Path resolution differs by build mode:
  // - Packaged: appPath is <install>/resources/app.asar; aios-starter-kit
  //   is at <install>/resources/aios-starter-kit (sibling, via extraResources).
  // - Dev: appPath is the repo root; aios-starter-kit is at <repo>/aios-starter-kit
  //   (in-tree). The `../aios-starter-kit` path would point ONE level above
  //   the repo, which may contain a stray/leftover starter kit (we hit this
  //   in dev with an old `-v1`-suffixed copy at the grandparent dir).
  // So: dev always uses in-tree; packaged always uses sibling.
  const candidates = app.isPackaged
    ? [
        path.resolve(appPath, "..", "aios-starter-kit"),
        path.resolve(appPath, "..", "..", "aios-starter-kit"),
        path.resolve(appPath, "aios-starter-kit")
      ]
    : [
        path.resolve(appPath, "aios-starter-kit"),
        path.resolve(appPath, "..", "aios-starter-kit"),
        path.resolve(appPath, "..", "..", "aios-starter-kit")
      ];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, "CLAUDE.md")));
  if (!found) {
    throw new Error(`Unable to locate aios-starter-kit. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

// App-shipped infrastructure directories that should always be present in the
// runtime workspace. These are template/code, not user data — safe to re-copy
// from the starter kit when missing. NEVER add user-data dirs here (context,
// data, outputs, plans, shares, gtd, imports — those belong to the user).
const INFRA_DIRS = ["module-installs", ".claude", "reference"];

export function ensureRuntimeWorkspace(): string {
  const workspaceRoot = getWorkspaceRoot();
  const marker = path.join(workspaceRoot, "CLAUDE.md");
  const starterKit = getSourceStarterKit();
  if (!fs.existsSync(marker)) {
    copyDirClean(starterKit, workspaceRoot);
  } else {
    // Idempotent infrastructure resync. Older workspaces (from earlier app
    // versions, or partial first-launch copies) can be missing module-installs/
    // — without this, the Modules page shows every row as "Source missing".
    // Only copies dirs that are entirely absent; never overwrites existing files.
    for (const dir of INFRA_DIRS) {
      const source = path.join(starterKit, dir);
      const target = path.join(workspaceRoot, dir);
      if (fs.existsSync(source) && !fs.existsSync(target)) {
        copyDirClean(source, target);
      }
    }
  }
  fs.mkdirSync(path.join(workspaceRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "logs"), { recursive: true });
  return workspaceRoot;
}

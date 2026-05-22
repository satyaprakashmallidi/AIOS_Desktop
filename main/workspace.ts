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

// Like copyDirClean, but never overwrites existing files. Heals partial
// workspaces: if a prior first-launch copy aborted mid-flight (TCC denial,
// ENOSPC, interrupted quit), the resulting partial module-installs/ would
// stay broken forever because a top-level fs.existsSync check thinks the
// dir is already populated. copyDirMerge recurses through every level and
// restores only the pieces that are missing — user-edited files (markdown,
// context) are preserved.
function copyDirMerge(source: string, target: string): string[] {
  const created: string[] = [];
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignoredCopyNames.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      created.push(...copyDirMerge(from, to));
    } else if (entry.isFile() && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      created.push(to);
    }
  }
  return created;
}

// FAST path used at startup. Creates the directories the Python sidecar
// needs to open the SQLite DB and start logging. ALSO runs the starter-kit
// copy inline on first launch (when CLAUDE.md is missing) so the very first
// `list_modules` call sees a populated module-installs/ — without this,
// there's a race where the renderer fetches the module list before the
// deferred backfillStarterKit completes and every row shows "Source missing"
// for up to 60 s. On subsequent launches CLAUDE.md exists and this block
// is skipped, preserving v0.1.19's fast cold-boot.
export function ensureRuntimeWorkspace(): string {
  const workspaceRoot = getWorkspaceRoot();
  fs.mkdirSync(path.join(workspaceRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "logs"), { recursive: true });

  const marker = path.join(workspaceRoot, "CLAUDE.md");
  if (!fs.existsSync(marker)) {
    try {
      copyDirClean(getSourceStarterKit(), workspaceRoot);
    } catch (err) {
      // Don't block boot if the starter kit is truly missing from the bundle.
      // The deferred backfillStarterKit will retry.
      // eslint-disable-next-line no-console
      console.error("first-launch starter kit copy failed:", err);
    }
  }
  return workspaceRoot;
}

// BACKGROUND path called after the BrowserWindow is on screen. Two jobs:
//   (1) If ensureRuntimeWorkspace's inline first-launch copy failed (or
//       didn't run for some reason), full copy here as a fallback.
//   (2) Self-heal partial / corrupt INFRA_DIRS via copyDirMerge — restores
//       any missing file under module-installs/, .claude/, or reference/
//       without touching user-edited content. This is what fixes existing
//       v0.2.19 users whose first-launch copy aborted mid-flight; auto-
//       update to a fixed version triggers the heal on next launch.
// Returns the list of top-level INFRA_DIRS that had something copied (or
// "__full__" for the full first-launch path). Empty array = nothing
// happened, no event broadcast needed.
export function backfillStarterKit(): { copied: string[] } {
  const copied: string[] = [];
  try {
    const workspaceRoot = getWorkspaceRoot();
    const marker = path.join(workspaceRoot, "CLAUDE.md");
    const starterKit = getSourceStarterKit();
    if (!fs.existsSync(marker)) {
      copyDirClean(starterKit, workspaceRoot);
      copied.push("__full__");
      return { copied };
    }
    for (const dir of INFRA_DIRS) {
      const source = path.join(starterKit, dir);
      const target = path.join(workspaceRoot, dir);
      if (fs.existsSync(source)) {
        const createdFiles = copyDirMerge(source, target);
        if (createdFiles.length > 0) copied.push(dir);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("backfillStarterKit failed:", err);
  }
  return { copied };
}

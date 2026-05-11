import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClaudeDetection } from "./types";

const execFileAsync = promisify(execFile);

function searchPath(): string {
  const home = os.homedir();
  const current = process.env.PATH ?? "";
  const additions = process.platform === "win32"
    ? unique([
        process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "nodejs") : null,
        "C:\\Program Files\\nodejs",
        "C:\\Program Files (x86)\\nodejs"
      ])
    : [
        path.join(home, ".npm-global", "bin"),
        path.join(home, ".volta", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin"
      ];
  return unique([...additions, ...current.split(path.delimiter)]).join(path.delimiter);
}

function executionEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: searchPath()
  };
}

export async function validateClaude(candidate: string): Promise<{ ok: boolean; version: string | null; error?: string }> {
  if (!candidate) return { ok: false, version: null, error: "Empty path" };
  try {
    const { stdout, stderr } = await execFileAsync(candidate, ["--version"], {
      timeout: 8000,
      windowsHide: true,
      env: executionEnv()
    });
    const version = `${stdout}${stderr}`.trim() || "version unavailable";
    return { ok: true, version };
  } catch (error) {
    return {
      ok: false,
      version: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function commandCandidates(command: string, args: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 5000,
      windowsHide: true,
      env: executionEnv()
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function shellCandidates(platform: NodeJS.Platform): Promise<string[]> {
  if (platform === "win32") {
    return commandCandidates("cmd.exe", ["/d", "/s", "/c", "where claude"]);
  }
  // Honour the user's actual login shell (zsh / bash / fish / etc.). Falls
  // back to zsh (macOS default since Catalina). The -ilc combo sources both
  // login files (~/.bash_profile, ~/.zprofile) AND interactive files
  // (~/.bashrc, ~/.zshrc) so PATH additions defined in either are picked up.
  const userShell = process.env.SHELL || "/bin/zsh";
  return commandCandidates(userShell, ["-ilc", "command -v claude || which claude"]);
}

function unique(items: Array<string | null | undefined>): string[] {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))));
}

export async function findClaude(savedPath?: string | null, platform: NodeJS.Platform = process.platform): Promise<ClaudeDetection> {
  const home = os.homedir();
  const checked: string[] = [];
  const pathCandidates: string[] = [];

  if (platform === "win32") {
    pathCandidates.push(...(await commandCandidates("where", ["claude"])));
    pathCandidates.push(...unique([
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "claude.cmd") : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "claude.ps1") : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe") : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "claude", "claude.exe") : null,
      path.join(home, "AppData", "Roaming", "npm", "claude.cmd")
    ]));
    pathCandidates.push(...(await shellCandidates(platform)));
  } else {
    pathCandidates.push(...(await commandCandidates("which", ["claude"])));
    pathCandidates.push(
      // Standard system + Homebrew locations
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      // npm with custom prefix
      path.join(home, ".npm-global", "bin", "claude"),
      // npm globals at default prefix (Homebrew node, system node, etc.)
      "/opt/homebrew/lib/node_modules/.bin/claude",
      "/usr/local/lib/node_modules/.bin/claude",
      "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude",
      "/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude",
      // Node version managers
      path.join(home, ".volta", "bin", "claude"),
      path.join(home, ".fnm", "aliases", "default", "bin", "claude"),
      path.join(home, ".mise", "shims", "claude"),
      path.join(home, ".asdf", "shims", "claude"),
      // Bun + user-local
      path.join(home, ".bun", "bin", "claude"),
      path.join(home, ".local", "bin", "claude")
    );
    // nvm doesn't reliably create a `current` symlink — scan every installed
    // node version so we find claude regardless of which version is active.
    try {
      const nvmVersionsDir = path.join(home, ".nvm", "versions", "node");
      if (fs.existsSync(nvmVersionsDir)) {
        for (const v of fs.readdirSync(nvmVersionsDir)) {
          pathCandidates.push(path.join(nvmVersionsDir, v, "bin", "claude"));
        }
      }
    } catch { /* nvm not installed; ignore */ }
    // Best-effort: ask npm where its global bin is, in case the user has a
    // custom prefix we don't hardcode. Silently skipped if npm isn't on PATH
    // or doesn't respond — npm reliability on Mac is variable.
    const npmPrefix = await commandCandidates("npm", ["config", "get", "prefix"]);
    for (const p of npmPrefix) {
      if (p && p !== "undefined") pathCandidates.push(path.join(p, "bin", "claude"));
    }
    pathCandidates.push(...(await shellCandidates(platform)));
  }

  if (savedPath) pathCandidates.push(savedPath);

  for (const candidate of unique(pathCandidates)) {
    checked.push(candidate);
    if (!fs.existsSync(candidate) && !candidate.endsWith("claude") && !candidate.endsWith("claude.cmd")) continue;
    const validation = await validateClaude(candidate);
    if (validation.ok) {
      return {
        found: true,
        path: candidate,
        version: validation.version,
        checked
      };
    }
  }

  return {
    found: false,
    path: null,
    version: null,
    checked,
    error: "Claude Code CLI was not found or did not respond to --version."
  };
}

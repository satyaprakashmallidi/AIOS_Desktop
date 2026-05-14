import React, { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

// Auto-update banner — Windows only. Sits at the top of the app shell and
// surfaces the existing `aios:update-state` events as a non-blocking nudge so
// the user doesn't have to dig into Settings to find out an update is ready.
//
// Lifecycle handled here:
//   "available"   → "Update vX.Y.Z available · [Download now] [Skip]"
//   "downloading" → progress strip with percent
//   "ready"       → "Update vX.Y.Z is ready · [Install & restart] [Later]"
// Anything else (checking / up-to-date / idle / error without message) renders
// nothing. macOS builds never render this — the manual-download fallback in
// Settings → General stays as the Mac path.
//
// Skip persistence: skipping a specific version writes to localStorage so the
// banner stays hidden for that version. A newer announced version clears the
// skip and shows the banner again.

const SKIP_STORAGE_KEY = "aios.autoUpdate.skippedVersion";

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "up-to-date";

interface AutoUpdateEvent {
  state: string;
  version?: string;
  percent?: number;
  message?: string;
}

interface AutoUpdateBannerProps {
  platform?: string | null;
}

export function AutoUpdateBanner({ platform }: AutoUpdateBannerProps) {
  const [state, setState] = useState<UpdateState>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [percent, setPercent] = useState<number>(0);
  // `dismissedForVersion`: user clicked Skip/Later for this version this
  // session. Differs from the localStorage "skip" which persists across runs.
  const [dismissedForVersion, setDismissedForVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  // Only the Windows packaged path has working in-place auto-update. On Mac
  // (unsigned) and on dev builds the banner shouldn't promise anything.
  const isWindows = platform === "win32";

  useEffect(() => {
    if (!isWindows) return;
    const unsubscribe = window.aios?.onUpdateState?.((event: AutoUpdateEvent) => {
      const next = event.state as UpdateState;
      setState(next);
      if (event.version) setVersion(event.version);
      if (typeof event.percent === "number") setPercent(event.percent);
      // Clear the per-session dismiss when a new version comes in or when the
      // flow advances past "available" (the user committed to it).
      if (next === "ready" || next === "downloading") {
        setDismissedForVersion(null);
      }
    });
    return () => unsubscribe?.();
  }, [isWindows]);

  // When a new version is announced that's newer than the persisted skip,
  // clear the persisted skip so the banner appears again.
  useEffect(() => {
    if (!version) return;
    try {
      const persistedSkip = localStorage.getItem(SKIP_STORAGE_KEY);
      if (persistedSkip && persistedSkip !== version) {
        localStorage.removeItem(SKIP_STORAGE_KEY);
      }
    } catch {
      // localStorage may be unavailable in some sandbox configurations.
    }
  }, [version]);

  if (!isWindows) return null;
  if (state === "idle" || state === "checking" || state === "up-to-date" || state === "error") return null;

  // Treat session-level Skip and persisted localStorage Skip the same way.
  let persistedSkip: string | null = null;
  try { persistedSkip = localStorage.getItem(SKIP_STORAGE_KEY); } catch { /* ignore */ }
  if (state === "available" && version && (dismissedForVersion === version || persistedSkip === version)) {
    return null;
  }

  function handleSkip() {
    if (!version) return;
    try { localStorage.setItem(SKIP_STORAGE_KEY, version); } catch { /* ignore */ }
    setDismissedForVersion(version);
  }

  function handleLater() {
    if (!version) return;
    setDismissedForVersion(version);
  }

  function handleDownload() {
    // electron-updater is already auto-downloading on Windows; clicking
    // Download just acknowledges the user's intent and bumps the banner into
    // the downloading state (the next progress event will take over).
    setState("downloading");
  }

  async function handleInstall() {
    setInstalling(true);
    try {
      await window.aios?.installUpdate?.();
      // App will quit + relaunch via quitAndInstall — no further UI needed.
    } catch {
      setInstalling(false);
    }
  }

  // Unified slim layout — same 36px strip for every state. The progress bar
  // for "downloading" is a 2px line at the very bottom of the strip so the
  // banner height doesn't change between states.
  const versionLabel = version ? `v${version}` : "";
  const clampedPercent = Math.max(0, Math.min(100, percent));

  let icon: React.ReactNode = <Download size={13} />;
  let message: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (state === "available") {
    message = (
      <>
        Update {versionLabel ? `${versionLabel} ` : ""}is available.
        <span className="auto-update-banner-hint"> A new version is ready to download.</span>
      </>
    );
    actions = (
      <>
        <button type="button" className="auto-update-banner-secondary" onClick={handleSkip}>Skip</button>
        <button type="button" className="auto-update-banner-primary" onClick={handleDownload}>Download</button>
      </>
    );
  } else if (state === "downloading") {
    icon = <RefreshCw size={13} className="spin" />;
    message = (
      <>
        Downloading update{versionLabel ? ` ${versionLabel}` : ""}… <strong>{clampedPercent}%</strong>
      </>
    );
  } else if (state === "ready") {
    message = (
      <>
        Update {versionLabel ? `${versionLabel} ` : ""}is ready to install.
      </>
    );
    actions = (
      <>
        <button type="button" className="auto-update-banner-secondary" onClick={handleLater} disabled={installing}>
          Later
        </button>
        <button
          type="button"
          className="auto-update-banner-primary"
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? "Installing…" : "Install & restart"}
        </button>
      </>
    );
  }

  return (
    <div
      className={`auto-update-banner state-${state}${state === "ready" ? " is-ready" : ""}`}
      role="status"
    >
      <div className="auto-update-banner-text">
        {icon}
        <span>{message}</span>
      </div>
      {actions && <div className="auto-update-banner-actions">{actions}</div>}
      {state === "downloading" && (
        <div className="auto-update-banner-progress" aria-hidden="true">
          <div
            className="auto-update-banner-progress-fill"
            style={{ width: `${clampedPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}

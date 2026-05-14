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
  // STRICT whitelist of states that have content to show. Anything else —
  // including unexpected event names from electron-updater, manual-available
  // (Mac only), or partial/transient broadcasts — renders nothing. Without
  // this guard v0.1.21 surfaced an empty husk (just the download icon with
  // no message or buttons) whenever any unexpected state value arrived.
  if (state !== "available" && state !== "downloading" && state !== "ready") return null;

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

  // Floating bottom-right popup card — pops up over the app content instead of
  // pushing it down with a top-of-window banner. Same three states (available
  // / downloading / ready) rendered inside the same card shape, so the popup
  // size stays consistent as the state transitions.
  const versionLabel = version ? `v${version}` : "";
  const clampedPercent = Math.max(0, Math.min(100, percent));

  let title = "";
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  let canDismiss = false;

  if (state === "available") {
    title = "Update available";
    body = (
      <>
        AIOS Desktop {versionLabel || "(new version)"} is ready to download.
      </>
    );
    footer = (
      <>
        <button type="button" className="auto-update-toast-secondary" onClick={handleSkip}>
          Skip
        </button>
        <button type="button" className="auto-update-toast-primary" onClick={handleDownload}>
          Download
        </button>
      </>
    );
    canDismiss = true;
  } else if (state === "downloading") {
    title = "Downloading update";
    body = (
      <>
        <span className="auto-update-toast-version">{versionLabel || "new version"}</span>
        <span className="auto-update-toast-percent">{clampedPercent}%</span>
      </>
    );
    footer = (
      <div className="auto-update-toast-progress" aria-hidden="true">
        <div
          className="auto-update-toast-progress-fill"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    );
    canDismiss = false; // keep the card open so the user sees progress
  } else if (state === "ready") {
    title = "Update ready to install";
    body = (
      <>
        AIOS Desktop {versionLabel || "(new version)"} is downloaded. The app will close, install, and reopen.
      </>
    );
    footer = (
      <>
        <button
          type="button"
          className="auto-update-toast-secondary"
          onClick={handleLater}
          disabled={installing}
        >
          Later
        </button>
        <button
          type="button"
          className="auto-update-toast-primary"
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? "Installing…" : "Install & restart"}
        </button>
      </>
    );
    canDismiss = true;
  }

  return (
    <div
      className={`auto-update-toast state-${state}`}
      role="status"
      aria-live="polite"
    >
      <div className="auto-update-toast-card">
        <div className="auto-update-toast-head">
          <div className="auto-update-toast-icon">
            {state === "downloading" ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
          </div>
          <div className="auto-update-toast-title">{title}</div>
          {canDismiss ? (
            <button
              type="button"
              className="auto-update-toast-close"
              onClick={state === "ready" ? handleLater : handleSkip}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="auto-update-toast-body">{body}</div>
        {footer ? <div className="auto-update-toast-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { ConfirmModal } from "./ui";

// Auto-update popup — fires on Windows AND Mac now that Mac builds are
// signed + notarized (v0.2.7+). Single centered modal that opens when an
// update is detected. Two buttons:
//   - Skip      → dismiss + remember this version in localStorage
//   - Download  → close the popup and route the user to Settings → General,
//                 where the "Restart & install" / "Check for updates"
//                 button lives. The download/install path is unchanged;
//                 this component is purely the entry-point nudge.
//
// Idle / checking / up-to-date / error states never trigger the popup —
// only "available" or "ready" signal an actionable update.

const SKIP_STORAGE_KEY = "aios.autoUpdate.skippedVersion";

interface AutoUpdateEvent {
  state: string;
  version?: string;
}

interface AutoUpdateBannerProps {
  platform?: string | null;
  onNavigateToSettings: () => void;
}

export function AutoUpdateBanner({ platform, onNavigateToSettings }: AutoUpdateBannerProps) {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [dismissedForVersion, setDismissedForVersion] = useState<string | null>(null);

  // Auto-update is supported on the desktop OS targets we ship signed
  // installers for. Linux/headless dev modes are excluded.
  const isSupportedOs = platform === "win32" || platform === "darwin";

  useEffect(() => {
    if (!isSupportedOs) return;
    const unsubscribe = window.aios?.onUpdateState?.((event: AutoUpdateEvent) => {
      // Treat "available" and "ready" identically — both mean an update
      // exists. The actual download happens silently in the background; from
      // the user's perspective the only thing they need to know is "there's
      // an update, click Download to act on it."
      if (event.state === "available" || event.state === "ready") {
        setHasUpdate(true);
        if (event.version) setVersion(event.version);
      }
    });
    return () => unsubscribe?.();
  }, [isSupportedOs]);

  // Clear the persisted skip when a newer version comes in so the popup
  // shows again for the new version.
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

  if (!isSupportedOs || !hasUpdate || !version) return null;

  let persistedSkip: string | null = null;
  try { persistedSkip = localStorage.getItem(SKIP_STORAGE_KEY); } catch { /* ignore */ }
  if (dismissedForVersion === version || persistedSkip === version) return null;

  function handleSkip() {
    if (!version) return;
    try { localStorage.setItem(SKIP_STORAGE_KEY, version); } catch { /* ignore */ }
    setDismissedForVersion(version);
  }

  function handleDownload() {
    if (version) setDismissedForVersion(version);
    onNavigateToSettings();
  }

  return (
    <ConfirmModal
      open={true}
      title="Update available"
      message={`AIOS Desktop v${version} is available. Open Settings to download and install.`}
      confirmLabel="Download"
      cancelLabel="Skip"
      onConfirm={handleDownload}
      onCancel={handleSkip}
    />
  );
}

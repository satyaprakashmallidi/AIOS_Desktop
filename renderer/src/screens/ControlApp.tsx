import React, { useEffect, useState } from "react";
import { invoke } from "../lib/api";
import { VoiceControlPanel } from "./VoiceControlPanel";
import type { ClaudeStatus, WorkspaceInfo } from "../types";

// ControlApp is the minimal renderer for the Computer Control popup
// window (top-right floating BrowserWindow opened by main/control-popup).
// It mounts only the VoiceControlPanel, sized to fill the popup window
// at TipTour-style dark rounded aesthetic.
//
// State setup is intentionally lightweight: we read the cached
// claude_path from get_workspace_info (no subprocess spawn) and pass an
// optimistic ClaudeStatus into the panel. The popup is meant to open
// instantly; if claude_path is stale, voice_control_start will surface
// the error at action time.

export function ControlApp() {
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  // Bumped every time the global voice shortcut fires. VoiceControlPanel
  // watches this signal and toggles between startListening / stopListening
  // when it changes — so a Ctrl+Alt+V (Win) / Cmd+Ctrl+V (Mac) press from
  // anywhere on the desktop kicks off mic capture immediately.
  const [voiceToggle, setVoiceToggle] = useState(0);

  useEffect(() => {
    const unsub = window.aios?.window?.onShortcutVoiceToggle?.(() => {
      setVoiceToggle((n) => n + 1);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await invoke<WorkspaceInfo>("get_workspace_info");
        if (res?.claudePath) {
          setClaude({
            found: true,
            path: res.claudePath,
            version: res.claudeVersion ?? null,
            checked: [],
            error: undefined,
            runtimeOk: true,
            runtimeError: undefined,
          });
        } else {
          setClaude({
            found: false,
            path: null,
            version: null,
            checked: [],
            error: "Claude CLI not configured. Open AIOS Settings to set up Claude.",
            runtimeOk: false,
            runtimeError: "Claude CLI not configured.",
          });
        }
      } catch {
        setClaude({
          found: false,
          path: null,
          version: null,
          checked: [],
          error: "Failed to read workspace info.",
          runtimeOk: false,
          runtimeError: "Failed to read workspace info.",
        });
      }
    })();
  }, []);

  // Close-on-Escape inside the popup: ask main to hide the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void invoke("control_panel_close");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="control-popup-root">
      <VoiceControlPanel
        claude={claude}
        toggleSignal={voiceToggle}
        onClose={() => { void invoke("control_panel_close"); }}
        popupMode
      />
    </div>
  );
}

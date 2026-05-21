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
    // Three-phase Claude resolution with warmup retry.
    //
    //   Phase A (fast, cached): read claude_path from get_workspace_info.
    //     If present, paint an optimistic ClaudeStatus immediately so the
    //     popup is usable. This is the same trick App.tsx uses.
    //
    //   Phase B (background, authoritative): if Phase A returned nothing
    //     OR the cached path was stale, call find_claude ourselves —
    //     the popup may have been opened BEFORE the main window's
    //     detectClaude background pass ran. Without this fallback the
    //     popup would say "Claude CLI is not configured" even though
    //     detection would succeed if anyone bothered to run it.
    //
    //   Warmup retry: if the Python sidecar isn't ready yet (the popup
    //     can be opened within 2-3s of launch via auto-show bubble +
    //     Cmd+Option hotkey), every IPC call fails with HOST_MISSING.
    //     We retry quietly for up to 20s so the popup eventually loads
    //     cleanly even from a cold start, matching App.tsx's behavior.
    let cancelled = false;
    const deadline = Date.now() + 20000;

    async function withWarmupRetry<T>(call: () => Promise<T>): Promise<T> {
      let lastErr: unknown;
      while (!cancelled && Date.now() < deadline) {
        try { return await call(); }
        catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }

    (async () => {
      try {
        const res = await withWarmupRetry(() => invoke<WorkspaceInfo>("get_workspace_info"));
        if (cancelled) return;
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
          // No cached path. Run detection ourselves — same call the main
          // window makes. Surfaces clear errors (which paths were
          // checked) if claude really isn't installed.
          try {
            const detected = await withWarmupRetry(() => invoke<ClaudeStatus>("find_claude"));
            if (cancelled) return;
            setClaude({
              ...detected,
              runtimeOk: detected.found && !!detected.path,
              runtimeError: detected.found ? undefined : detected.error ?? "Claude executable was not found.",
            });
          } catch (err) {
            setClaude({
              found: false,
              path: null,
              version: null,
              checked: [],
              error: err instanceof Error ? err.message : "Claude detection failed.",
              runtimeOk: false,
              runtimeError: "Claude detection failed.",
            });
          }
        }
      } catch (err) {
        if (cancelled) return;
        setClaude({
          found: false,
          path: null,
          version: null,
          checked: [],
          error: err instanceof Error ? err.message : "Failed to read workspace info.",
          runtimeOk: false,
          runtimeError: "Failed to read workspace info.",
        });
      }
    })();

    return () => { cancelled = true; };
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

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { invoke } from "../lib/api";

// Renderer for the Computer Control bubble window. Renders the AIOS
// italic "a" wordmark in a dark circle. Pointer events are routed
// through three IPCs:
//
//   pointerdown   → control_bubble_drag_start
//                   Main starts polling the cursor at 60Hz and moves
//                   the bubble window to stick to it.
//
//   pointerup     → control_bubble_drag_end
//                   Main stops the polling loop.
//                   If the cursor barely moved between down and up,
//                   we also fire control_panel_toggle (it was a click).
//
//   pointercancel → control_bubble_drag_end
//                   Defensive: pointer captures can drop on app switch.
//
// We don't send any IPCs during pointermove — main has full visibility
// of the cursor via screen.getCursorScreenPoint(), and renderer
// pointermove doesn't fire once the cursor leaves the 56px window.

// Total cursor movement during the gesture under which we treat
// pointerup as a click. 8px lets typical hand-tremor pass as a click
// (4px was too tight — users were seeing clicks register as drags
// because of unavoidable micro-movement during the press).
const CLICK_MOVEMENT_THRESHOLD_PX = 8;

function BubbleMark() {
  // fill="currentColor" so the mark inherits the parent CSS color, which
  // is theme-tokened via var(--ink). Light theme → black mark on white
  // circle; dark theme → light mark on near-black circle.
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <text
        x="12"
        y="19"
        textAnchor="middle"
        fontFamily="'Instrument Serif', Georgia, serif"
        fontStyle="italic"
        fontWeight={400}
        fontSize="22"
        fill="currentColor"
      >
        a
      </text>
    </svg>
  );
}

// Cross-window theme sync. The main window writes `aios-theme` to
// localStorage on every theme change. We listen via the `storage` event
// (fires across same-origin BrowserWindows) AND poll localStorage every
// 1s as a bulletproof fallback in case the event doesn't propagate for
// some reason (Electron version, session quirks, etc.). First-paint
// hydration is already handled by the inline script in index.html.
function useThemeSync(): void {
  useEffect(() => {
    function applyFromStorage() {
      let value: string | null = null;
      try { value = localStorage.getItem("aios-theme"); } catch { /* ignore */ }
      const next = value || "light";
      const current = document.documentElement.getAttribute("data-theme");
      if (current !== next) document.documentElement.setAttribute("data-theme", next);
    }
    const handler = (e: StorageEvent) => {
      if (e.key !== "aios-theme") return;
      applyFromStorage();
    };
    window.addEventListener("storage", handler);
    const poll = window.setInterval(applyFromStorage, 1000);
    return () => {
      window.removeEventListener("storage", handler);
      window.clearInterval(poll);
    };
  }, []);
}

interface VoiceStateEvent {
  event: "voice_state";
  state:
    | { kind: "idle" }
    | { kind: "thinking"; turn: number }
    | { kind: "executing"; turn: number; action: { type: string; args: Record<string, string> }; rationale?: string }
    | { kind: "done"; summary: string }
    | { kind: "blocked"; reason: string }
    | { kind: "aborted" }
    | { kind: "error"; message: string };
}

export function BubbleApp() {
  useThemeSync();
  const [running, setRunning] = useState(false);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const unsub = window.aios?.onHostEvent?.((event: unknown) => {
      const e = event as VoiceStateEvent;
      if (!e || e.event !== "voice_state") return;
      const k = e.state.kind;
      setRunning(k === "thinking" || k === "executing");
    });
    return () => unsub?.();
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return; // left-click only
    // Capture so pointerup fires here even if the cursor briefly leaves.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* harmless */ }
    downAt.current = { x: e.screenX, y: e.screenY };
    void invoke("control_bubble_drag_start");
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const start = downAt.current;
    downAt.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    void invoke("control_bubble_drag_end");
    if (!start) return;
    const dx = e.screenX - start.x;
    const dy = e.screenY - start.y;
    if (Math.hypot(dx, dy) <= CLICK_MOVEMENT_THRESHOLD_PX) {
      void invoke("control_panel_toggle");
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    if (!downAt.current) return;
    downAt.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    void invoke("control_bubble_drag_end");
  }

  return (
    <button
      type="button"
      className={`control-bubble${running ? " is-running" : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      aria-label="Open Computer Control"
      title="Computer Control"
    >
      {running ? <Loader2 size={18} className="spin" /> : <BubbleMark />}
    </button>
  );
}

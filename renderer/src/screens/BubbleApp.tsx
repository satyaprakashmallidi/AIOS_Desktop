import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { invoke } from "../lib/api";

// Tiny renderer for the Computer Control bubble window. Renders the AIOS
// italic "a" wordmark inside a dark circle. Clicking it toggles the panel
// below. While a voice loop is mid-run, the mark swaps for a spinner so
// the bubble doubles as a live status indicator.

function BubbleMark() {
  // Italic lowercase "a" — AIOS signature glyph. Sized to fill the 44px
  // bubble circle without crowding the edges.
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
        fill="#ECEEED"
      >
        a
      </text>
    </svg>
  );
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
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unsub = window.aios?.onHostEvent?.((event: unknown) => {
      const e = event as VoiceStateEvent;
      if (!e || e.event !== "voice_state") return;
      const k = e.state.kind;
      setRunning(k === "thinking" || k === "executing");
    });
    return () => unsub?.();
  }, []);

  function onClick() {
    void invoke("control_panel_toggle");
  }

  return (
    <button
      type="button"
      className={`control-bubble${running ? " is-running" : ""}`}
      onClick={onClick}
      aria-label="Open Computer Control"
      title="Computer Control"
    >
      {running ? <Loader2 size={18} className="spin" /> : <BubbleMark />}
    </button>
  );
}

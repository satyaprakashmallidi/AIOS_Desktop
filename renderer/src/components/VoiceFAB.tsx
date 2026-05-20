import React from "react";
import { Bot, X } from "lucide-react";

// Right-edge floating action button for AIOS Computer Control.
// Single, always-visible entry point — replaces the prior bottom-left
// sidebar Control button. Hotkey (Ctrl+Alt+V) still opens the same panel.
//
// Visual states:
//   - Idle (panel closed): sage bot icon in a circular pill.
//   - Active (panel open): inverted ink fill with a close X.

export function VoiceFAB({
  active,
  onToggle
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`voice-fab${active ? " is-active" : ""}`}
      onClick={onToggle}
      title={active ? "Close Computer Control" : "Open Computer Control (Ctrl+Alt+V)"}
      aria-label={active ? "Close Computer Control" : "Open Computer Control"}
      aria-pressed={active}
    >
      {active ? <X size={18} /> : <Bot size={18} />}
    </button>
  );
}

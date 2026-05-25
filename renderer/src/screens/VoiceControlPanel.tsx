import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, CheckCircle2, History, Loader2, MessageSquare, Mic, MicOff, MousePointer2, Settings as SettingsIcon, Square, X } from "lucide-react";
import { invoke } from "../lib/api";
import type { ClaudeStatus } from "../types";

// Voice Control panel — bottom-left floating UI for the voice→Claude→action
// loop. Self-contained: owns its mic capture, transcription, IPC kickoff,
// and host-event subscription for live state updates.

type Phase =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "transcribing" }
  | { kind: "thinking"; turn: number }
  | { kind: "executing"; turn: number; action: { type: string; args: Record<string, string> }; rationale?: string }
  | { kind: "done"; summary: string }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string };

interface HistoryEntry {
  id: string;
  text: string;
  ts: number;
}

const HISTORY_KEY = "aios.controlHistory";
const HISTORY_CAP = 20;

// True on macOS — switches the displayed shortcut hint to Mac chords
// and the title-attribute tooltip on the mic button. navigator.platform
// is deprecated for spec purposes but still the only reliable way to
// tell Mac apart inside an Electron renderer with no Node access.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");
// How long after a clarifying [BLOCKED] question the next user input is
// treated as a CONTINUATION instead of a fresh task. Two minutes covers
// people reading + typing without trapping them in continuation mode if
// they wander off and come back later with something unrelated.
const CONTINUATION_WINDOW_MS = 2 * 60 * 1000;

function looksLikeClarifyingQuestion(reason: string): boolean {
  // Heuristic: the agent prefixes clarifying blocks with phrases like
  // "User asked... but did not specify" / "Please provide" / "What would
  // you like" and usually ends with a question mark. Hard "I can't do
  // this" blocks read more like "no app named X exists".
  const lower = reason.toLowerCase();
  if (lower.includes("?")) return true;
  if (lower.includes("did not specify") || lower.includes("didn't specify")) return true;
  if (lower.includes("please provide") || lower.includes("please clarify")) return true;
  if (lower.includes("what would you like") || lower.includes("what do you want")) return true;
  if (lower.includes("could you tell me") || lower.includes("could you clarify")) return true;
  if (lower.includes("more details")) return true;
  return false;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_CAP) : [];
  } catch { return []; }
}

function persistHistory(entries: HistoryEntry[]): void {
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_CAP))); } catch { /* quota / disabled — non-fatal */ }
}

function timeAgo(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
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

export function VoiceControlPanel({
  claude,
  toggleSignal,
  onClose,
  popupMode = false
}: {
  claude: ClaudeStatus | null;
  // Bumped by App on each Ctrl+Alt+V press. On mount (signal > 0) we auto-
  // start listening; on every subsequent bump we toggle. This keeps the
  // hotkey logic in one place (App) and avoids two competing subscribers.
  toggleSignal: number;
  onClose: () => void;
  // True when rendered inside the top-right Computer Control popup window
  // (TipTour-style dark, rounded, fills its window). False (default) is
  // the legacy in-app bottom-left positioning — kept so the component can
  // still be reused in other UI surfaces later if needed.
  popupMode?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [transcript, setTranscript] = useState("");
  const [inputText, setInputText] = useState("");
  const [cursorFollow, setCursorFollow] = useState(false);
  const [cursorColor, setCursorColor] = useState<string>("#9caf9b");
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  // Top-level tab routing in the popup: Chat (status + composer), Recent
  // (history list), Settings (cursor companion + Quit). Defaults to Chat
  // so first-open lands on the primary surface.
  const [activeTab, setActiveTab] = useState<"chat" | "recent" | "settings">("chat");
  // When the agent BLOCKs with a clarifying question, we stash the original
  // transcript + the question here. The next user message gets prefixed
  // with this context so Claude continues the original task with the
  // answer, instead of starting a fresh unrelated task. Cleared after the
  // next runText, or after CONTINUATION_WINDOW_MS elapses.
  const pendingClarificationRef = useRef<{ transcript: string; reason: string; ts: number } | null>(null);
  const recorderRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const baselineSignalRef = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Sync cursor-overlay state on mount so the in-popup toggle reflects
  // the actual overlay state across reopens. Dock pin button is gone — the
  // popup always auto-docks to the bubble; drag the popup to free-float.
  useEffect(() => {
    if (!popupMode) return;
    (async () => {
      try {
        const cr = await invoke<{ active: boolean }>("cursor_overlay_get_active");
        if (cr?.active !== undefined) setCursorFollow(!!cr.active);
      } catch { /* non-fatal */ }
      try {
        const ccr = await invoke<{ color: string }>("cursor_overlay_get_color");
        if (ccr?.color) setCursorColor(ccr.color);
      } catch { /* non-fatal */ }
    })();
  }, [popupMode]);

  async function pickCursorColor(color: string) {
    setCursorColor(color);
    try { await invoke("cursor_overlay_set_color", { color }); } catch { /* non-fatal */ }
  }

  // Load history from localStorage on mount (popup re-opens land here too).
  useEffect(() => {
    setHistoryEntries(loadHistory());
  }, []);

  function addToHistory(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setHistoryEntries((prev) => {
      // Drop any prior identical entry so the new one floats to the top.
      const filtered = prev.filter((e) => e.text !== clean);
      const next = [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: clean, ts: Date.now() }, ...filtered].slice(0, HISTORY_CAP);
      persistHistory(next);
      return next;
    });
  }

  function clearHistory() {
    setHistoryEntries([]);
    persistHistory([]);
  }

  async function quitControl() {
    await invoke("control_close_all");
  }

  function openCommand(text: string) {
    // Open (don't auto-execute) a past command — load the text into the
    // Chat composer and switch tabs so the user can review/edit before
    // deciding whether to send. Previous behaviour auto-submitted, which
    // ran agent actions immediately on every click — surprising.
    setInputText(text);
    setActiveTab("chat");
  }

  async function runText(text: string) {
    const cmd = text.trim();
    if (!cmd) return;
    if (!claude?.path) {
      setPhase({ kind: "error", message: "Claude CLI isn't configured. Open AIOS Settings to set it up." });
      return;
    }

    // Continuation: if the agent just BLOCKED with a clarifying question
    // within the last CONTINUATION_WINDOW_MS, the user's reply should
    // continue that task rather than start a new one. Build a prompt
    // that gives Claude the original ask + its own pause-reason + the
    // user's answer.
    let promptToSend = cmd;
    const pending = pendingClarificationRef.current;
    if (pending && Date.now() - pending.ts < CONTINUATION_WINDOW_MS) {
      promptToSend = [
        `Earlier the user asked: "${pending.transcript}"`,
        ``,
        `You paused and asked the user to clarify:`,
        `"${pending.reason}"`,
        ``,
        `The user has now replied with the missing info:`,
        `"${cmd}"`,
        ``,
        `Continue the ORIGINAL task using this answer. Do not start a new task.`,
      ].join("\n");
      pendingClarificationRef.current = null;
    }

    setTranscript(cmd);
    setInputText("");
    addToHistory(cmd);
    setPhase({ kind: "thinking", turn: 1 });
    try {
      const start = await invoke<{ ok: boolean; accepted?: boolean }>("voice_control_start", { transcript: promptToSend, claudePath: claude.path });
      if (!start?.ok) setPhase({ kind: "error", message: "Couldn't start the voice loop." });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Failed to start." });
    }
  }

  async function toggleCursorFollow() {
    const next = !cursorFollow;
    setCursorFollow(next);
    try { await invoke("cursor_overlay_set_active", { active: next }); } catch { /* non-fatal */ }
  }

  // Subscribe to host events for action-loop state from main/voice-control.ts
  useEffect(() => {
    const unsub = window.aios?.onHostEvent?.((event: unknown) => {
      const e = event as VoiceStateEvent;
      if (!e || e.event !== "voice_state") return;
      const s = e.state;
      if (s.kind === "idle") setPhase({ kind: "idle" });
      else if (s.kind === "thinking") setPhase({ kind: "thinking", turn: s.turn });
      else if (s.kind === "executing") setPhase({ kind: "executing", turn: s.turn, action: s.action, rationale: s.rationale });
      else if (s.kind === "done") setPhase({ kind: "done", summary: s.summary });
      else if (s.kind === "blocked") {
        setPhase({ kind: "blocked", reason: s.reason });
        // If the block looks like a clarifying question, stash context so
        // the user's next reply continues this task instead of starting
        // a fresh one. Use the LAST transcript we have (the input that
        // triggered this loop).
        if (looksLikeClarifyingQuestion(s.reason)) {
          const lastTranscript = transcript || "";
          if (lastTranscript) {
            pendingClarificationRef.current = {
              transcript: lastTranscript,
              reason: s.reason,
              ts: Date.now(),
            };
          }
        }
      }
      else if (s.kind === "aborted") setPhase({ kind: "idle" });
      else if (s.kind === "error") setPhase({ kind: "error", message: s.message });
    });
    return () => unsub?.();
  }, []);

  // Capture the signal value on first mount as a baseline; only act when a
  // subsequent bump pushes it past the baseline. This means opening the panel
  // (sidebar click or hotkey-while-closed) never auto-starts the mic — user
  // chooses voice vs text. Pressing Ctrl+Alt+V again while the panel is open
  // still toggles the mic, which is the useful power-user gesture.
  useEffect(() => {
    if (baselineSignalRef.current === null) {
      baselineSignalRef.current = toggleSignal;
      return;
    }
    if (toggleSignal === baselineSignalRef.current) return;
    const k = phaseRef.current.kind;
    if (k === "listening") stopListening();
    else if (k === "idle" || k === "done" || k === "error" || k === "blocked") startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleSignal]);

  async function startListening() {
    if (!claude?.path) {
      setPhase({ kind: "error", message: "Claude CLI isn't configured. Set it up in Settings → Claude CLI." });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ kind: "error", message: "Microphone not available in this runtime." });
      return;
    }
    setTranscript("");
    setPhase({ kind: "listening" });

    // Popup-mode prep (Mac-critical, no-op on Windows):
    //   1. Lower the popup's alwaysOnTop level from "screen-saver" to
    //      "floating" so macOS's TCC mic permission dialog appears
    //      above the popup the first time we request the mic. Without
    //      this the user never sees the dialog and the request silently
    //      fails.
    //   2. Focus the popup's webContents so Chromium's permission
    //      policy considers the popup the active requesting frame —
    //      `type: "panel"` non-activating windows can otherwise have
    //      getUserMedia rejected by some macOS versions.
    if (popupMode) {
      try { await invoke("control_panel_prepare_mic", {}); } catch { /* non-fatal */ }
      // Give macOS / Chromium ~120ms to propagate the app-activation +
      // window-focus change (from prepareControlPopupForMic, which
      // calls app.focus({steal:true}) and popupWindow.focus() on Mac)
      // before requesting the mic. Without this, on cold Mac launches
      // getUserMedia fires while Chromium still thinks the popup
      // webContents isn't the active frame and TCC silently rejects.
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (popupMode) {
        try { await invoke("control_panel_release_mic", {}); } catch { /* non-fatal */ }
      }
      const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");
      const name = err instanceof Error ? err.name : "";
      // Map Chromium's mic-permission rejection codes to actionable text
      // on Mac. The bare err.message ("Permission denied" / "NotAllowed
      // Error") tells the user nothing about how to recover. Same hint
      // as the silence-detection path further down — single source of
      // truth for "go to System Settings".
      const macHint = "Open System Settings → Privacy & Security → Microphone, enable AIOS Desktop, then quit AIOS (Cmd+Q) and reopen so the audio pipeline picks up the permission.";
      const message = isMac && (name === "NotAllowedError" || name === "SecurityError")
        ? `Microphone permission denied. ${macHint}`
        : err instanceof Error ? err.message : "Microphone permission denied.";
      setPhase({ kind: "error", message });
      return;
    }
    audioStreamRef.current = stream;

    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = (audioCtx as any).createScriptProcessor(4096, 1, 1) as ScriptProcessorNode;
    const muteNode = audioCtx.createGain();
    muteNode.gain.value = 0;
    const collected: Float32Array[] = [];
    let totalLen = 0;
    let stopped = false;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      collected.push(copy);
      totalLen += copy.length;
    };
    source.connect(processor);
    processor.connect(muteNode);
    muteNode.connect(audioCtx.destination);

    const stop = async () => {
      if (stopped) return;
      stopped = true;
      try { processor.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      try { muteNode.disconnect(); } catch { /* noop */ }
      try { await audioCtx.close(); } catch { /* noop */ }
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;

      // Restore the popup's always-on-top level now that the TCC dialog
      // (if it was going to show) has come and gone. Mirrors the
      // prep call in startListening.
      if (popupMode) {
        try { await invoke("control_panel_release_mic", {}); } catch { /* non-fatal */ }
      }

      if (totalLen === 0) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "transcribing" });
      try {
        const merged = new Float32Array(totalLen);
        let off = 0;
        for (const arr of collected) { merged.set(arr, off); off += arr.length; }

        // Audio level guard. If the captured buffer is below the noise
        // floor across its entire length, the mic captured silence —
        // commonly because Chromium-on-Electron-on-Mac didn't refresh
        // its audio pipeline after the user granted Mic permission for
        // the first time, or because the system default input device
        // is wrong (e.g. "Aggregate Device" with no real source).
        // Surfacing an actionable error here is far more useful than
        // shipping silence to Google STT and getting "Didn't catch
        // that — try again." as the generic UnknownValueError fallback.
        let peak = 0;
        for (let i = 0; i < merged.length; i++) {
          const a = Math.abs(merged[i]);
          if (a > peak) peak = a;
        }
        if (peak < 0.01) {
          const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");
          setPhase({
            kind: "error",
            message: isMac
              ? "Microphone captured silence. Open System Settings → Privacy & Security → Microphone, make sure AIOS Desktop is enabled, then quit AIOS (Cmd+Q) and reopen it so the audio pipeline picks up the permission."
              : "Microphone captured silence. Check your input device in system sound settings and try again."
          });
          return;
        }

        const wavB64 = samplesToWavBase64(merged, audioCtx.sampleRate);
        const res = await invoke<{ text: string }>("transcribe_audio", {
          audio: wavB64,
          engine: "google",
          language: "en-US"
        });
        const text = (res?.text ?? "").trim();
        if (!text) {
          setPhase({ kind: "error", message: "Didn't catch that — try again." });
          return;
        }
        // Hand off to runText so the clarification-continuation logic
        // applies to spoken answers too — when the agent just paused to
        // ask a clarifying question and the user speaks the answer.
        await runText(text);
        return;
      } catch (err) {
        setPhase({ kind: "error", message: err instanceof Error ? err.message : "Transcription failed." });
      }
    };

    recorderRef.current = { stop };
  }

  async function stopListening() {
    if (recorderRef.current) {
      await recorderRef.current.stop();
      recorderRef.current = null;
    }
  }

  async function submitText() {
    await runText(inputText);
  }

  function abortLoop() {
    // Fire-and-forget: the main-process abort waits for the in-flight
    // Claude call to drain (can take 10-30s), so awaiting it here would
    // freeze the Stop button. Snap the UI to idle immediately; the
    // background abort will arrive via host-event in the meantime.
    void invoke("voice_control_abort", {});
    setPhase({ kind: "idle" });
    setTranscript("");
  }

  const isActive =
    phase.kind === "listening" ||
    phase.kind === "transcribing" ||
    phase.kind === "thinking" ||
    phase.kind === "executing";

  const placeholder = (() => {
    if (phase.kind === "listening") return "Listening…";
    if (phase.kind === "transcribing") return "Transcribing…";
    if (phase.kind === "thinking") return "Thinking…";
    if (phase.kind === "executing") return "Working…";
    return claude?.path ? "Tell Claude what to do…" : "Configure Claude CLI first";
  })();

  return (
    <div className="voice-popup" role="dialog" aria-label="Computer Control">
      {/* Slim drag bar: grabber affordance on the left, close X on the right. */}
      <div className="voice-popup-dragbar">
        <span className="voice-popup-grabber" aria-hidden="true" />
        <button
          type="button"
          className="voice-popup-close"
          onClick={() => { if (isActive) abortLoop(); onClose(); }}
          aria-label="Close"
        >
          <X size={12} />
        </button>
      </div>

      {/* Header — sage italic "Control" heading + a live status row that
          only renders when something is actually happening. In idle state
          the heading sits alone (no "Ready" noise). */}
      <div className="voice-popup-head">
        <span className="voice-popup-eyebrow">Control</span>
        {phase.kind !== "idle" ? (
          <div className="voice-popup-status">
            <span className={`status-dot ${statusToneClass(phase)}`} aria-hidden="true" />
            <span className="voice-popup-status-text">{statusTextFor(phase)}</span>
            {(phase.kind === "thinking" || phase.kind === "executing") && (
              <span className="voice-popup-status-meta">turn {phase.turn}</span>
            )}
          </div>
        ) : null}
      </div>

      {/* Three top-level tabs. Each pane below renders only when its tab
          is active. Chat (default) holds the conversational surface;
          Recent holds replayable command history; Settings holds cursor
          companion + Quit. */}
      <div className="voice-popup-tabs" role="tablist" aria-label="Computer Control sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chat"}
          className={`voice-popup-tab${activeTab === "chat" ? " is-active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          <MessageSquare size={13} />
          <span>Chat</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "recent"}
          className={`voice-popup-tab${activeTab === "recent" ? " is-active" : ""}`}
          onClick={() => setActiveTab("recent")}
        >
          <History size={13} />
          <span>Recent</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "settings"}
          className={`voice-popup-tab${activeTab === "settings" ? " is-active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          <SettingsIcon size={13} />
          <span>Settings</span>
        </button>
      </div>

      {/* ─── CHAT TAB ─────────────────────────────────────────────────── */}
      {activeTab === "chat" ? (
        <div className="voice-popup-pane is-chat" role="tabpanel">
          {/* Activity card — transcript + action label + result. Only renders
              when there's something to show (i.e. not idle with no transcript). */}
          {(transcript ||
            phase.kind === "executing" ||
            phase.kind === "done" ||
            phase.kind === "blocked" ||
            phase.kind === "error") ? (
            <div className="voice-popup-activity">
              {transcript ? (
                <div className="voice-popup-transcript">
                  <span className="voice-popup-transcript-label">You said</span>
                  <p className="voice-popup-transcript-text">"{transcript}"</p>
                </div>
              ) : null}
              {phase.kind === "executing" ? (
                <div className="voice-popup-action">
                  <span className="voice-popup-action-line">
                    <ActionLabel action={phase.action} />
                  </span>
                  {phase.rationale ? (
                    <span className="voice-popup-action-rationale">{phase.rationale}</span>
                  ) : null}
                </div>
              ) : null}
              {phase.kind === "done" ? (
                <p className="voice-popup-result is-done">
                  <CheckCircle2 size={12} /> {phase.summary || "Done."}
                </p>
              ) : null}
              {phase.kind === "blocked" ? (
                <p className="voice-popup-result is-blocked">
                  <AlertCircle size={12} /> {phase.reason}
                </p>
              ) : null}
              {phase.kind === "error" ? (
                <p className="voice-popup-result is-error">
                  <AlertCircle size={12} /> {phase.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Spacer pushes composer to bottom of pane. */}
          <div className="voice-popup-pane-spacer" />

          {/* Composer pill — input + inline mic + send. */}
          <div className="voice-popup-composer">
            <input
              type="text"
              className="voice-popup-input"
              placeholder={placeholder}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              disabled={!claude?.path || isActive}
              aria-label="Type a command"
            />
            {isActive ? (
              <button
                type="button"
                className="voice-popup-composer-btn is-stop"
                onClick={phase.kind === "listening" ? stopListening : abortLoop}
                aria-label={phase.kind === "listening" ? "Stop listening" : "Stop"}
                title={phase.kind === "listening" ? "Stop & send" : "Stop"}
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="voice-popup-composer-btn is-mic"
                  onClick={startListening}
                  disabled={!claude?.path}
                  aria-label="Start listening"
                  title={!claude?.path ? "Claude CLI not configured" : `Talk (${IS_MAC ? "⌘+⌥" : "Ctrl+Alt+V"})`}
                >
                  {claude?.path ? <Mic size={13} /> : <MicOff size={13} />}
                </button>
                <button
                  type="button"
                  className={`voice-popup-composer-btn is-send${inputText.trim().length > 0 ? " is-ready" : ""}`}
                  onClick={submitText}
                  disabled={!claude?.path || inputText.trim().length === 0}
                  aria-label="Send command"
                  title="Send"
                >
                  <ArrowUp size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ─── RECENT TAB ───────────────────────────────────────────────── */}
      {activeTab === "recent" ? (
        <div className="voice-popup-pane is-recent" role="tabpanel">
          <div className="voice-popup-section-head">
            <span className="voice-popup-section-eyebrow"><History size={10} /> Recent chats</span>
            {historyEntries.length > 0 ? (
              <button
                type="button"
                className="voice-popup-section-action"
                onClick={clearHistory}
                aria-label="Clear history"
              >
                Clear
              </button>
            ) : null}
          </div>
          {historyEntries.length === 0 ? (
            <p className="voice-popup-empty">No commands yet — head to Chat and try one.</p>
          ) : (
            <ul className="voice-popup-recent">
              {historyEntries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="voice-popup-recent-item"
                    onClick={() => openCommand(entry.text)}
                    title="Open in chat (does not auto-send)"
                  >
                    <span className="voice-popup-recent-text">{entry.text}</span>
                    <span className="voice-popup-recent-ts">{timeAgo(entry.ts)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* ─── SETTINGS TAB ─────────────────────────────────────────────── */}
      {activeTab === "settings" ? (
        <div className="voice-popup-pane is-settings" role="tabpanel">
          <div className="voice-popup-section">
            <button
              type="button"
              className="voice-popup-row-toggle"
              onClick={toggleCursorFollow}
              role="switch"
              aria-checked={cursorFollow}
            >
              <span className="voice-popup-row-icon"><MousePointer2 size={12} /></span>
              <span className="voice-popup-row-text">Cursor companion</span>
              <span className={`voice-popup-switch${cursorFollow ? " is-on" : ""}`}>
                <span className="voice-popup-switch-knob" />
              </span>
            </button>
            {cursorFollow ? (
              <div className="voice-popup-swatches">
                {[
                  "#9caf9b", "#60a5fa", "#a78bfa", "#f87171",
                  "#fbbf24", "#34d399", "#0d0d0d"
                ].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`voice-popup-swatch${c.toLowerCase() === cursorColor.toLowerCase() ? " is-selected" : ""}`}
                    style={{ background: c }}
                    onClick={() => pickCursorColor(c)}
                    aria-label={`Set cursor color ${c}`}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="voice-popup-rule" />

          <div className="voice-popup-settings-foot">
            <span className="voice-popup-hotkey">
              {IS_MAC ? (<><kbd>⌘</kbd><kbd>⌥</kbd></>) : (<><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd></>)}
            </span>
            <button
              type="button"
              className="voice-popup-quit"
              onClick={quitControl}
              title="Hide bubble + panel + cursor companion"
            >
              Quit
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function statusTextFor(phase: Phase): string {
  switch (phase.kind) {
    case "idle": return "Ready";
    case "listening": return "Listening";
    case "transcribing": return "Transcribing";
    case "thinking": return `Thinking · turn ${phase.turn}`;
    case "executing": return `Acting · turn ${phase.turn}`;
    case "done": return "Done";
    case "blocked": return "Blocked";
    case "error": return "Error";
    default: return "";
  }
}

function statusToneClass(phase: Phase): string {
  switch (phase.kind) {
    case "idle": return "is-idle";
    case "listening": return "is-listening";
    case "transcribing":
    case "thinking":
    case "executing": return "is-active";
    case "done": return "is-done";
    case "blocked": return "is-blocked";
    case "error": return "is-error";
    default: return "";
  }
}

function ActionLabel({ action }: { action: { type: string; args: Record<string, string> } }) {
  const t = action.type;
  if (t === "CLICK") {
    const label = action.args.label;
    const button = (action.args.button || "left").toLowerCase();
    const clicks = Number(action.args.clicks) || 1;
    const verb = clicks >= 2 ? "Double-click" : button === "right" ? "Right-click" : "Click";
    const targetId = action.args.target_id ?? action.args.targetId;
    if (targetId !== undefined && targetId !== "") {
      return (
        <>
          <MousePointer2 size={12} /> {verb}{label ? <> <em>{label}</em></> : null} <span className="voice-coords">[#{targetId}]</span>
        </>
      );
    }
    return (
      <>
        <MousePointer2 size={12} /> {verb}{label ? <> <em>{label}</em></> : null} <span className="voice-coords">({action.args.x},{action.args.y})</span>
      </>
    );
  }
  if (t === "CONTINUE") return <>Requesting more turns: <em>{action.args.reason}</em></>;
  if (t === "TYPE") {
    const text = action.args.text ?? "";
    const preview = text.length > 40 ? text.slice(0, 40) + "…" : text;
    return <>Type <em>"{preview}"</em>{action.args.clear ? <span className="voice-coords"> (clearing first)</span> : null}</>;
  }
  if (t === "HOTKEY") return <>Press <em>{action.args.keys}</em></>;
  if (t === "SCROLL") return <>Scroll {action.args.dy}</>;
  if (t === "OPEN") return <>Open <em>{action.args.target ?? action.args.app}</em></>;
  if (t === "MOVE") return <>Move cursor <span className="voice-coords">({action.args.x},{action.args.y})</span></>;
  if (t === "DRAG") return <>Drag <span className="voice-coords">({action.args.x1},{action.args.y1}) → ({action.args.x2},{action.args.y2})</span></>;
  if (t === "CLIPBOARD_SET") return <>Copy to clipboard</>;
  if (t === "CLIPBOARD_GET") return <>Read clipboard</>;
  if (t === "WAIT") return <>Wait {action.args.seconds}s</>;
  return <>{t}</>;
}

// PCM → WAV (16-bit, mono). Copy of CommandScreen's helper — will dedupe once
// we have more callers.
function samplesToWavBase64(samples: Float32Array, sampleRate: number): string {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return window.btoa(binary);
}

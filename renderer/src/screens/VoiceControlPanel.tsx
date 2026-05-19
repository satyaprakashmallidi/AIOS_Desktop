import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, Loader2, Mic, MicOff, MousePointer2, Square, X } from "lucide-react";
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
  onClose
}: {
  claude: ClaudeStatus | null;
  // Bumped by App on each Ctrl+Alt+V press. On mount (signal > 0) we auto-
  // start listening; on every subsequent bump we toggle. This keeps the
  // hotkey logic in one place (App) and avoids two competing subscribers.
  toggleSignal: number;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [transcript, setTranscript] = useState("");
  const recorderRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const initialisedRef = useRef(false);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

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
      else if (s.kind === "blocked") setPhase({ kind: "blocked", reason: s.reason });
      else if (s.kind === "aborted") setPhase({ kind: "idle" });
      else if (s.kind === "error") setPhase({ kind: "error", message: s.message });
    });
    return () => unsub?.();
  }, []);

  // React to the App-level hotkey signal. First mount with signal>0 = start.
  // Subsequent bumps toggle current state.
  useEffect(() => {
    if (toggleSignal === 0) return;
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      startListening();
      return;
    }
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

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Microphone permission denied." });
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

      if (totalLen === 0) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "transcribing" });
      try {
        const merged = new Float32Array(totalLen);
        let off = 0;
        for (const arr of collected) { merged.set(arr, off); off += arr.length; }
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
        setTranscript(text);
        // Kick off the action loop. State updates arrive via host-event.
        const start = await invoke<{ ok: boolean; accepted?: boolean }>("voice_control_start", {
          transcript: text,
          claudePath: claude.path
        });
        if (!start?.ok) {
          setPhase({ kind: "error", message: "Couldn't start the voice loop." });
        }
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

  async function abortLoop() {
    await invoke("voice_control_abort", {});
    setPhase({ kind: "idle" });
    setTranscript("");
  }

  const isActive =
    phase.kind === "listening" ||
    phase.kind === "transcribing" ||
    phase.kind === "thinking" ||
    phase.kind === "executing";

  return (
    <div className="voice-panel" role="dialog" aria-label="Voice Control">
      <header className="voice-panel-head">
        <div className="voice-panel-title">
          <Mic size={13} />
          Voice control
        </div>
        <button
          type="button"
          className="voice-panel-close"
          onClick={() => {
            if (isActive) abortLoop();
            onClose();
          }}
          aria-label="Close voice control"
        >
          <X size={14} />
        </button>
      </header>

      <div className="voice-panel-body">
        {phase.kind === "idle" && (
          <p className="voice-panel-hint">
            Tap the mic and tell AIOS what to do on your screen. Hotkey: <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd>.
          </p>
        )}
        {phase.kind === "listening" && (
          <div className="voice-panel-status listening">
            <span className="voice-pulse" />
            Listening… tap mic to send.
          </div>
        )}
        {phase.kind === "transcribing" && (
          <div className="voice-panel-status">
            <Loader2 size={14} className="spin" />
            Transcribing…
          </div>
        )}
        {phase.kind === "thinking" && (
          <div className="voice-panel-status">
            <Loader2 size={14} className="spin" />
            Thinking… <span className="voice-turn">turn {phase.turn}</span>
          </div>
        )}
        {phase.kind === "executing" && (
          <div className="voice-panel-status executing">
            <Activity size={14} />
            <div className="voice-panel-action">
              <span className="voice-action-line">
                <ActionLabel action={phase.action} />
              </span>
              {phase.rationale && <span className="voice-action-rationale">{phase.rationale}</span>}
            </div>
          </div>
        )}
        {phase.kind === "done" && (
          <div className="voice-panel-status done">
            <CheckCircle2 size={14} />
            {phase.summary || "Done."}
          </div>
        )}
        {phase.kind === "blocked" && (
          <div className="voice-panel-status blocked">
            <AlertCircle size={14} />
            {phase.reason}
          </div>
        )}
        {phase.kind === "error" && (
          <div className="voice-panel-status error">
            <AlertCircle size={14} />
            {phase.message}
          </div>
        )}

        {transcript && (
          <div className="voice-panel-transcript">
            <span className="voice-panel-transcript-label">You said:</span>
            <span className="voice-panel-transcript-text">{transcript}</span>
          </div>
        )}
      </div>

      <footer className="voice-panel-foot">
        {phase.kind === "listening" ? (
          <button type="button" className="voice-mic-btn is-recording" onClick={stopListening} aria-label="Stop listening">
            <Square size={14} fill="currentColor" />
            Send
          </button>
        ) : isActive ? (
          <button type="button" className="voice-mic-btn is-stop" onClick={abortLoop} aria-label="Abort">
            <Square size={14} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="voice-mic-btn"
            onClick={startListening}
            disabled={!claude?.path}
            aria-label="Start listening"
            title={!claude?.path ? "Claude CLI not configured" : "Hold to talk (Ctrl+Alt+V)"}
          >
            {claude?.path ? <Mic size={14} /> : <MicOff size={14} />}
            Talk
          </button>
        )}
      </footer>
    </div>
  );
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

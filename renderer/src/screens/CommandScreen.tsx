import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  ChevronDown,
  Check,
  Command,
  Copy,
  Cpu,
  FileText,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Sparkles,
  X
} from "lucide-react";
import { invoke, newId } from "../lib/api";
import { formatRelativeTime } from "../lib/workspace-view";
import { PanelHeader, StatusBadge } from "../components/ui";
import type {
  ChatMessage,
  ChatSession,
  ClaudeStreamEvent,
  ClaudeStatus,
  ConnectionStatus,
  ContextSummary,
  ModuleInfo,
  RecentActivityEntry,
  WorkspaceEntry
} from "../types";
import type { OnboardingState, Screen } from "../ui";

function friendlyActivityLabel(activity: { tool: string; summary: string }): string {
  const tool = activity.tool;
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return "Running a command";
    case "Read":
      return "Reading a file";
    case "Write":
      return "Writing a file";
    case "Edit":
    case "MultiEdit":
      return "Editing a file";
    case "Glob":
      return "Searching files";
    case "Grep":
      return "Searching code";
    case "WebFetch":
      return "Fetching a web page";
    case "WebSearch":
      return "Searching the web";
    case "TodoWrite":
    case "Task":
      return "Updating to-do list";
    case "Agent":
      return "Spawning a sub-agent";
    case "NotebookEdit":
      return "Editing a notebook";
    default:
      if (tool.startsWith("mcp__")) return `Calling ${tool.replace(/^mcp__/, "").replace(/__/g, " · ")}`;
      return `Running ${tool || "tool"}`;
  }
}

const starterPrompts = [
  { label: "Generate my first workspace summary", icon: Command, prompt: "/prime" },
  { label: "Review my AIOS context files", icon: FileText, prompt: "Review my AIOS context files and tell me what is strong, thin, or missing." },
  { label: "Find the best next action", icon: Sparkles, prompt: "Summarize the workspace and tell me the single highest leverage next action." },
  { label: "Create a plan from my workspace", icon: Bot, prompt: "Create a practical plan from my current AIOS workspace context." }
];

// Model picker options. "default" omits --model from the spawn so Claude CLI
// uses whatever the user has configured. The other three pass the short alias
// that Claude Code CLI accepts.
const CHAT_MODELS = [
  { id: "default", label: "Default",     description: "Use your Claude CLI default" },
  { id: "haiku",   label: "Haiku 4.5",   description: "Fastest · best for simple tasks" },
  { id: "sonnet",  label: "Sonnet 4.6",  description: "Balanced · everyday default" },
  { id: "opus",    label: "Opus 4.7",    description: "Smartest · slowest, most capable" }
] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="copy-code-btn" onClick={handleCopy} title="Copy code">
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="message-actions">
      <button
        className="message-action"
        onClick={async () => {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        }}
        title="Copy response"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

const CodeBlock = React.memo(function CodeBlock({ children }: { children?: React.ReactNode }) {
  const text = useMemo(() => {
    if (typeof children === "string") return children;
    if (Array.isArray(children)) return children.map((c) => (typeof c === "string" ? c : "")).join("");
    return "";
  }, [children]);
  return (
    <div className="code-block-wrapper">
      <pre>
        <code>{text}</code>
      </pre>
      <CopyButton text={text} />
    </div>
  );
});

// Stable components map so ReactMarkdown doesn't see a new prop reference each
// render — fresh object identity makes it re-instantiate plugins every time.
const MARKDOWN_COMPONENTS = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const isInline = !className;
    if (isInline) return <code {...props}>{children}</code>;
    return <CodeBlock>{String(children).replace(/\n$/, "")}</CodeBlock>;
  }
} as const;
const MARKDOWN_PLUGINS = [remarkGfm] as const;

// Memoised so streaming a new chunk into the LAST message doesn't re-parse
// every prior message's markdown. Re-renders only when its content/role flips.
const MessageMarkdown = React.memo(function MessageMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS as any} components={MARKDOWN_COMPONENTS as any}>
      {content}
    </ReactMarkdown>
  );
});

export function CommandScreen({
  claude,
  onboarding,
  context,
  modules,
  outputs,
  plans,
  recent,
  connections,
  activeSession,
  onDetectClaude,
  onSessionsChange,
  onRefreshWorkspace,
  onNavigate
}: {
  claude: ClaudeStatus | null;
  onboarding: OnboardingState | null;
  context: ContextSummary;
  modules: ModuleInfo[];
  outputs: WorkspaceEntry[];
  plans: WorkspaceEntry[];
  recent: RecentActivityEntry[];
  connections: ConnectionStatus[];
  activeSession: ChatSession | null;
  onDetectClaude: () => Promise<ClaudeStatus>;
  onSessionsChange: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  onRefreshWorkspace: () => Promise<void>;
  onNavigate: (screen: Screen) => void;
}) {
  const [runtimeMeta, setRuntimeMeta] = useState<{ sessionId?: string; durationMs?: number; costUsd?: number } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const voiceBasePromptRef = useRef("");
  const recognitionRef = useRef<any>(null);
  const activeStreamRef = useRef<{ streamId: string; assistantId: string } | null>(null);
  const [activity, setActivity] = useState<{ tool: string; summary: string } | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; path: string; size: number }>>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("default");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const installedCount = modules.filter((module) => module.installed).length;
  const contextCount = context.files.filter((file) => file.exists).length;
  const realMessages = activeSession?.messages ?? [];
  const hasRealMessages = realMessages.length > 0;
  const visibleMessages = hasRealMessages ? realMessages : [];
  const renderedMessages = visibleMessages;

  useEffect(() => {
    const onSetPrompt = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setPrompt(detail);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    };
    document.addEventListener("aios:set-prompt", onSetPrompt as EventListener);
    return () => document.removeEventListener("aios:set-prompt", onSetPrompt as EventListener);
  }, []);

  // Load persisted model choice on mount.
  useEffect(() => {
    invoke<{ key: string; value: string | null }>("get_setting", { key: "chat_model" })
      .then((r) => {
        if (r?.value && CHAT_MODELS.some((m) => m.id === r.value)) {
          setSelectedModel(r.value);
        }
      })
      .catch(() => undefined);
  }, []);

  // Click-away to close the model dropdown.
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (modelButtonRef.current?.contains(target)) return;
      if (modelMenuRef.current?.contains(target)) return;
      setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [modelMenuOpen]);

  async function pickModel(id: string) {
    setSelectedModel(id);
    setModelMenuOpen(false);
    await invoke("set_setting", { key: "chat_model", value: id }).catch(() => undefined);
  }

  // No-op (previously used for showFullHistory)

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [activeSession?.messages, busy]);

  useEffect(() => {
    if (!window.aios?.onHostEvent) return () => undefined;
    return window.aios.onHostEvent((event) => {
      if (event.event !== "claude_stream") return;
      const payload = event.data as ClaudeStreamEvent;
      const activeStream = activeStreamRef.current;
      if (!activeStream || payload.streamId !== activeStream.streamId) return;
      if (payload.sessionId || payload.durationMs || payload.costUsd) {
        setRuntimeMeta((current) => ({
          sessionId: payload.sessionId ?? current?.sessionId,
          durationMs: payload.durationMs ?? current?.durationMs,
          costUsd: payload.costUsd ?? current?.costUsd
        }));
        if (payload.sessionId && activeSession) {
          const capturedSessionId = payload.sessionId;
          onSessionsChange((current) =>
            current.map((session) => (session.id === activeSession.id
              ? { ...session, claudeSessionId: capturedSessionId }
              : session))
          );
        }
      }
      if (payload.toolUse) {
        setActivity({ tool: payload.toolUse.name, summary: payload.toolUse.summary });
      }
      if (payload.toolResult) {
        setActivity(null);
      }
      if (!payload.delta && !payload.response) {
        if (payload.done) {
          setActivity(null);
          onRefreshWorkspace().catch(() => undefined);
        }
        return;
      }
      onSessionsChange((current) =>
        current.map((session) => ({
          ...session,
          messages: session.messages.map((message) => {
            if (message.id !== activeStream.assistantId) return message;
            return {
              ...message,
              content: payload.response ?? `${message.content}${payload.delta ?? ""}`
            };
          })
        }))
      );
      if (payload.done || payload.response) {
        onRefreshWorkspace().catch(() => undefined);
      }
    });
  }, [onSessionsChange, onRefreshWorkspace, activeSession?.id]);

  useEffect(() => {
    if (!busy) composerRef.current?.focus();
  }, [busy, activeSession?.id]);

  useEffect(() => {
    return () => {
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  async function audioBlobToWavBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await ctx.close().catch(() => undefined);

    // Mix down to mono and resample-pass through (speech_recognition handles any sample rate)
    const numChannels = 1;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const samples = new Float32Array(length);
    if (audioBuffer.numberOfChannels === 1) {
      samples.set(audioBuffer.getChannelData(0));
    } else {
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      for (let i = 0; i < length; i += 1) samples[i] = (left[i] + right[i]) / 2;
    }

    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
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
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 8 * bytesPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i += 1) {
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

  async function transcribeBlob(blob: Blob): Promise<string> {
    const wavBase64 = await audioBlobToWavBase64(blob);
    const result = await invoke<{ text: string; engine: string }>("transcribe_audio", {
      audio: wavBase64,
      engine: "google",
      language: "en-US"
    });
    return (result?.text ?? "").trim();
  }

  // Build a complete PCM 16-bit WAV from float32 samples and base64-encode it.
  // We can call this mid-recording because we control the entire format.
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

  async function toggleVoiceInput() {
    // Stop path: finalize via the mediaRecorderRef alias we keep for the running session.
    if (listening && mediaRecorderRef.current) {
      const stopFn = (mediaRecorderRef.current as any)._aiosStop as (() => void) | undefined;
      if (stopFn) stopFn();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone is unavailable in this runtime.");
      return;
    }

    setVoiceError(null);
    voiceBasePromptRef.current = prompt.trim();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Microphone permission was denied.");
      return;
    }
    audioStreamRef.current = stream;

    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const bufferSize = 4096;
    const processor = (audioCtx as any).createScriptProcessor(bufferSize, 1, 1) as ScriptProcessorNode;
    const muteNode = audioCtx.createGain();
    muteNode.gain.value = 0;

    const sampleRate = audioCtx.sampleRate;
    const collected: Float32Array[] = [];
    let totalLen = 0;
    let lastText = "";
    let inFlight = false;
    let stopped = false;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      collected.push(copy);
      totalLen += copy.length;
    };

    source.connect(processor);
    processor.connect(muteNode);
    muteNode.connect(audioCtx.destination);

    const liveTimer = window.setInterval(async () => {
      if (inFlight || stopped || totalLen < sampleRate * 0.5) return; // require >0.5s
      // Skip transcription while the window is in the background — the
      // user can't see the live caption anyway, so don't burn CPU.
      if (document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const merged = new Float32Array(totalLen);
        let off = 0;
        for (const arr of collected) { merged.set(arr, off); off += arr.length; }
        const wavB64 = samplesToWavBase64(merged, sampleRate);
        const result = await invoke<{ text: string; engine: string }>("transcribe_audio", {
          audio: wavB64,
          engine: "google",
          language: "en-US"
        });
        const text = (result?.text ?? "").trim();
        if (text && text !== lastText) {
          lastText = text;
          const base = voiceBasePromptRef.current;
          setPrompt(base ? `${base} ${text}` : text);
        }
      } catch {
        // Mid-stream transcription failures are non-fatal; the final pass will catch up.
      } finally {
        inFlight = false;
      }
    }, 3500);

    const stopAll = async () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(liveTimer);
      try { processor.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      try { muteNode.disconnect(); } catch { /* noop */ }
      try { await audioCtx.close(); } catch { /* noop */ }
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
      mediaRecorderRef.current = null;
      setListening(false);

      // Final accurate pass — we have all samples, build one big WAV.
      if (totalLen === 0) return;
      setTranscribing(true);
      try {
        const merged = new Float32Array(totalLen);
        let off = 0;
        for (const arr of collected) { merged.set(arr, off); off += arr.length; }
        const wavB64 = samplesToWavBase64(merged, sampleRate);
        const result = await invoke<{ text: string; engine: string }>("transcribe_audio", {
          audio: wavB64,
          engine: "google",
          language: "en-US"
        });
        const text = (result?.text ?? "").trim();
        if (text) {
          const base = voiceBasePromptRef.current;
          setPrompt(base ? `${base} ${text}` : text);
          composerRef.current?.focus();
        }
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : "Transcription failed.");
      } finally {
        setTranscribing(false);
      }
    };

    // Stash a tag on the alias so the stop-path can find it.
    mediaRecorderRef.current = { _aiosStop: stopAll } as unknown as MediaRecorder;
    setListening(true);
  }

  async function saveUpdatedSession(nextSession: ChatSession) {
    onSessionsChange((current) => current.map((session) => (session.id === nextSession.id ? nextSession : session)));
    await invoke("save_session", { session: nextSession });
  }

  async function uploadAttachments(fileList: FileList) {
    setUploadingAttachment(true);
    try {
      const next: Array<{ name: string; path: string; size: number }> = [];
      for (const file of Array.from(fileList)) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
        }
        const base64 = btoa(binary);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const stamp = Date.now().toString(36);
        const path = `imports/chat-${stamp}-${safeName}`;
        try {
          await invoke("write_binary_file", { path, data: base64 });
          next.push({ name: file.name, path, size: file.size });
        } catch (err) {
          console.error("Attachment upload failed:", err);
        }
      }
      if (next.length) {
        setAttachments((current) => [...current, ...next]);
      }
    } finally {
      setUploadingAttachment(false);
    }
  }

  function removeAttachment(path: string) {
    setAttachments((current) => current.filter((a) => a.path !== path));
  }

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || !claude?.found || busy || !activeSession) return;
    const attachmentBlock = attachments.length > 0
      ? `Attached files for this message:\n${attachments.map((a) => `- ${a.path}  (${a.name})`).join("\n")}\n\nRead any of these files with the Read tool when relevant to the user's request.\n\n---\n\n`
      : "";
    const finalText = attachmentBlock + trimmed;
    const displayText = attachments.length > 0
      ? `${trimmed || "(see attached files)"}\n\n📎 ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}: ${attachments.map((a) => a.name).join(", ")}`
      : trimmed;
    const userMessage: ChatMessage = { id: newId("msg"), role: "user", content: displayText, createdAt: new Date().toISOString() };
    const assistant: ChatMessage = {
      id: newId("msg"),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    };
    const streamId = newId("stream");
    activeStreamRef.current = { streamId, assistantId: assistant.id };
    const nextSession = {
      ...activeSession,
      messages: [...activeSession.messages, userMessage, assistant],
      updatedAt: new Date().toISOString()
    };
    onSessionsChange((current) => current.map((session) => (session.id === nextSession.id ? nextSession : session)));
    setPrompt("");
    setAttachments([]);
    setBusy(true);
    setActivity(null);
    setRuntimeMeta(null);
    try {
      const command = trimmed === "/prime" ? "run_prime" : "run_task";
      const claudeSessionId = activeSession.claudeSessionId ?? undefined;
      const baseArgs: Record<string, unknown> = { claudePath: claude.path, streamId };
      if (claudeSessionId) baseArgs.sessionId = claudeSessionId;
      // Pass the user-picked model through as --model <alias>. "default" means
      // omit the flag so Claude CLI uses whatever's configured globally.
      if (selectedModel && selectedModel !== "default") baseArgs.model = selectedModel;
      const taskArgs = command === "run_prime"
        ? baseArgs
        : { ...baseArgs, prompt: finalText };
      const result = await invoke<{ response: string; sessionId?: string; durationMs?: number; costUsd?: number }>(
        command,
        taskArgs
      );
      const nextClaudeSessionId = result.sessionId ?? activeSession.claudeSessionId ?? null;
      const saved = {
        ...nextSession,
        messages: nextSession.messages.map((message) =>
          message.id === assistant.id ? { ...message, content: result.response } : message
        ),
        updatedAt: new Date().toISOString(),
        claudeSessionId: nextClaudeSessionId
      };
      setRuntimeMeta({ sessionId: result.sessionId, durationMs: result.durationMs, costUsd: result.costUsd });
      await saveUpdatedSession(saved);
      await onRefreshWorkspace();
    } catch (error) {
      const assistant: ChatMessage = {
        id: activeStreamRef.current?.assistantId ?? newId("msg"),
        role: "assistant",
        content: `Claude Code failed: ${error instanceof Error ? error.message : String(error)}`,
        createdAt: new Date().toISOString()
      };
      await saveUpdatedSession({
        ...nextSession,
        messages: nextSession.messages.map((message) => (message.id === assistant.id ? assistant : message)),
        updatedAt: new Date().toISOString()
      });
      setRuntimeMeta(null);
    } finally {
      activeStreamRef.current = null;
      setBusy(false);
      setActivity(null);
    }
  }

  return (
    <section className="aios-chat-screen">
      <div className={`aios-chat-panel ${hasRealMessages ? "has-history" : "is-empty"}`}>
          {!claude?.found ? <MissingClaude claude={claude} onDetect={onDetectClaude} /> : null}
          {!onboarding?.completedAt && !hasRealMessages ? (
            <div className="aios-chat-setup">
              <div className="subtle-note">
                <strong>Setup incomplete.</strong> Claude works now, but context quality is still thin.
              </div>
              <button className="button button-ghost compact" onClick={() => onNavigate("onboarding")}>
                <Sparkles />
                Finish setup
              </button>
            </div>
          ) : null}

          <div className="aios-chat-header">
            <div className="aios-chat-title-block" />
            <div className="aios-chat-meta">
              <StatusBadge tone={claude?.found && claude.runtimeOk ? "success" : "warning"} label={claude?.found && claude.runtimeOk ? "Connected" : "Check Claude"} />
            </div>
          </div>

          <div className="aios-chat-thread" ref={threadRef}>
            {!hasRealMessages && !busy ? (
              <div className="aios-chat-empty">
                <div className="aios-chat-orb" aria-hidden="true">A</div>
                <p className="aios-chat-kicker">AIOS · Command</p>
                <h2>What should we <em>work on</em>?</h2>
                <p>Start with a summary, review your context, or ask AIOS to turn a rough idea into the next action.</p>
                <div className="aios-chat-empty-actions">
                  {starterPrompts.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className="aios-chat-chip"
                        key={item.label}
                        onClick={() => setPrompt(item.prompt)}
                      >
                        <Icon size={14} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {renderedMessages.map((message) => (
              <article className={`aios-message ${message.role}`} key={message.id}>
                <div className="aios-message-meta">
                  <div className="aios-message-role">
                    {message.role === "assistant" ? (
                      <>
                        <div className="avatar avatar-ai">
                          <Bot size={13} />
                        </div>
                        <span>AIOS / Claude</span>
                      </>
                    ) : (
                      <>
                        <div className="avatar avatar-user">
                          <MessageSquare size={13} />
                        </div>
                        <span>You</span>
                      </>
                    )}
                  </div>
                  <time>{formatRelativeTime(message.createdAt)}</time>
                </div>
                <div className="aios-message-body">
                  {message.content.trim() ? (
                    <div className="aios-markdown">
                      <MessageMarkdown content={message.content} />
                    </div>
                  ) : (
                    <div className="inline-thinking">
                      <div className="typing-indicator">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                      <span>Claude is thinking</span>
                    </div>
                  )}
                </div>
                {message.role === "assistant" && message.content.trim() ? <MessageActions content={message.content} /> : null}
              </article>
            ))}
            {busy && !realMessages.some((message) => message.id === activeStreamRef.current?.assistantId) ? (
              <article className="aios-message assistant pending-assistant">
                <div className="aios-message-meta">
                  <div className="aios-message-role">
                    <div className="avatar avatar-ai">
                      <Bot size={13} />
                    </div>
                    <span>AIOS / Claude</span>
                  </div>
                  <time>Working</time>
                </div>
                <div className="pending-shell">
                  <div className="typing-indicator">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                  <p>{activity ? friendlyActivityLabel(activity) : "Claude is thinking"}</p>
                  {activity?.summary ? <code className="activity-detail">{activity.summary}</code> : null}
                </div>
              </article>
            ) : busy && (() => {
              const last = renderedMessages[renderedMessages.length - 1];
              const lastIsEmptyAssistant = last?.role === "assistant" && !last.content?.trim();
              if (lastIsEmptyAssistant) return null;
              if (activity) {
                return (
                  <div className="aios-activity-row">
                    <Loader2 size={13} className="spin" />
                    <span className="aios-activity-label">{friendlyActivityLabel(activity)}</span>
                    {activity.summary ? <code className="aios-activity-detail">{activity.summary}</code> : null}
                  </div>
                );
              }
              return (
                <div className="aios-activity-row aios-activity-thinking">
                  <Loader2 size={13} className="spin" />
                  <span className="aios-activity-label">Claude is thinking…</span>
                </div>
              );
            })() }
          </div>

          <form
            className="aios-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendPrompt(prompt);
            }}
          >
            <input
              ref={attachInputRef}
              className="hidden-input"
              type="file"
              multiple
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  uploadAttachments(event.target.files);
                }
                event.target.value = "";
              }}
            />
            {attachments.length > 0 ? (
              <div className="aios-composer-attachments">
                {attachments.map((att) => (
                  <span key={att.path} className="aios-attachment-chip" title={att.path}>
                    <Paperclip size={11} />
                    <span className="aios-attachment-name">{att.name}</span>
                    <button
                      type="button"
                      className="aios-attachment-remove"
                      onClick={() => removeAttachment(att.path)}
                      aria-label={`Remove ${att.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="aios-composer-input-line">
              <textarea
                ref={composerRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendPrompt(prompt);
                  }
                }}
                placeholder="Ask anything"
                disabled={!claude?.found || !claude.runtimeOk || busy}
              />
            </div>
            <div className="aios-composer-underbar">
              <button
                className="aios-composer-action"
                type="button"
                onClick={() => attachInputRef.current?.click()}
                disabled={busy || uploadingAttachment}
                title="Attach files to this message"
              >
                {uploadingAttachment ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />}
                {uploadingAttachment ? "Uploading…" : "Sources"}
              </button>
              <div className="aios-model-picker">
                <button
                  ref={modelButtonRef}
                  type="button"
                  className="aios-model-pill"
                  onClick={() => setModelMenuOpen((open) => !open)}
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={modelMenuOpen}
                  title="Pick the Claude model for this chat"
                >
                  <span>{CHAT_MODELS.find((m) => m.id === selectedModel)?.label ?? "Default"}</span>
                  <ChevronDown size={12} />
                </button>
                {modelMenuOpen ? (
                  <div ref={modelMenuRef} className="aios-model-menu" role="menu">
                    {CHAT_MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitem"
                        className={`aios-model-option ${selectedModel === m.id ? "is-active" : ""}`}
                        onClick={() => pickModel(m.id)}
                      >
                        <span className="aios-model-option-text">
                          <strong>{m.label}</strong>
                          <span>{m.description}</span>
                        </span>
                        {selectedModel === m.id ? <Check size={12} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <span className="aios-composer-hint">{voiceError ?? (listening ? "Listening... click mic to stop" : transcribing ? "Transcribing..." : busy ? (activity ? friendlyActivityLabel(activity) : "Claude is thinking…") : "")}</span>
              <div className="aios-composer-right">
                <button
                  className={`aios-composer-tool ${listening ? "active" : ""}`}
                  type="button"
                  title={listening ? "Stop voice input" : "Voice input"}
                  onClick={toggleVoiceInput}
                  disabled={busy || transcribing}
                >
                  {transcribing ? <Loader2 size={15} className="spin" /> : <Mic size={15} />}
                </button>
                <button
                  className="aios-send-btn"
                  disabled={!prompt.trim() || !claude?.found || !claude.runtimeOk || busy}
                  type="submit"
                  aria-label="Send message"
                >
                  {busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
                </button>
              </div>
            </div>
          </form>
      </div>
    </section>
  );
}

function MissingClaude({ claude, onDetect }: { claude: ClaudeStatus | null; onDetect: () => Promise<ClaudeStatus> }) {
  const [checking, setChecking] = useState(false);
  return (
    <div className="inline-notice warning-inline">
      <div>
        <PanelHeader eyebrow="Runtime" title="Claude Code is not connected" detail="AIOS uses the real Claude CLI as its backend." />
        <div className="warning-copy">
          <AlertTriangle size={14} />
          <p>{claude?.runtimeError || claude?.error || "Re-run detection if the terminal install changed or your PATH updated after launch."}</p>
        </div>
      </div>
      <button
        className="button button-primary compact"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await onDetect();
          setChecking(false);
        }}
      >
        {checking ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
        Reconnect Claude
      </button>
    </div>
  );
}


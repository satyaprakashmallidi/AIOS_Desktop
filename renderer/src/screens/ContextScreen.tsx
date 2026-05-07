import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Briefcase,
  Eye,
  LineChart,
  Pencil,
  RefreshCw,
  Target,
  User
} from "lucide-react";
import { invoke } from "../lib/api";
import type { ContextSection, ImportedContextSummary } from "../types";

interface ContextFileSpec {
  name: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const CONTEXT_FILES: ContextFileSpec[] = [
  {
    name: "business-info",
    title: "Business Info",
    description: "Who you are, what you do, your team & stage. Loaded by Claude every /prime.",
    icon: <Briefcase size={15} />
  },
  {
    name: "personal-info",
    title: "Personal Info",
    description: "Your role, responsibilities, and how this workspace supports your work.",
    icon: <User size={15} />
  },
  {
    name: "strategy",
    title: "Strategy",
    description: "Current strategic priorities, success metrics, and key decisions.",
    icon: <Target size={15} />
  },
  {
    name: "current-data",
    title: "Current Data",
    description: "Live snapshot of metrics, project status, wins, blockers.",
    icon: <LineChart size={15} />
  }
];

export function ContextScreen({
  onAskClaude
}: {
  sections: ContextSection[];
  imports: ImportedContextSummary[];
  onRefresh: () => Promise<void>;
  onAskClaude: (prompt: string) => void;
}) {
  const [activeName, setActiveName] = useState<string>(CONTEXT_FILES[0].name);
  const activeSpec = CONTEXT_FILES.find((s) => s.name === activeName) ?? CONTEXT_FILES[0];

  return (
    <section className="context-screen">
      <div className="context-shell">
        <header className="context-hero">
          <p className="context-hero-eyebrow">AIOS Context</p>
          <h1>Your <em>context</em>, loaded with every chat</h1>
          <p className="context-hero-detail">
            These four files are what Claude reads when you run <code>/prime</code>. Pick a file, switch to Edit, and write the
            things you want Claude to know about you and your business.
          </p>
        </header>

        <div className="context-tabs-strip" role="tablist" aria-label="Context file selector">
          {CONTEXT_FILES.map((spec) => (
            <button
              key={spec.name}
              type="button"
              role="tab"
              aria-selected={activeName === spec.name}
              className={`context-pill ${activeName === spec.name ? "active" : ""}`}
              onClick={() => setActiveName(spec.name)}
            >
              {spec.icon}
              <span>{spec.title}</span>
            </button>
          ))}
        </div>

        <ContextFileEditor key={activeSpec.name} spec={activeSpec} onAskClaude={onAskClaude} />
      </div>
    </section>
  );
}

function ContextFileEditor({
  spec,
  onAskClaude
}: {
  spec: ContextFileSpec;
  onAskClaude: (prompt: string) => void;
}) {
  const path = `context/${spec.name}.md`;
  const [content, setContent] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"preview" | "edit">("preview");

  async function load() {
    try {
      const file = await invoke<{ path: string; content: string }>("read_file", { path });
      setContent(file.content ?? "");
      setExists(Boolean(file.content && file.content.length > 0));
      setLoaded(true);
      setDirty(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
      setLoaded(true);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function save() {
    setBusy(true);
    try {
      await invoke("write_file", { path, content });
      setExists(content.length > 0);
      setDirty(false);
      setStatus("Saved");
      setMode("preview");
      window.setTimeout(() => setStatus(null), 1500);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function restoreTemplate() {
    setBusy(true);
    try {
      const result = await invoke<{ path: string; content: string }>("restore_context_template", { name: spec.name });
      setContent(result.content ?? "");
      setExists(true);
      setDirty(false);
      setStatus("Restored from starter template");
      window.setTimeout(() => setStatus(null), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="context-card">
      <header className="context-card-head">
        <div className="context-card-title">
          {spec.icon}
          <div>
            <strong>{spec.title}</strong>
            <p>{spec.description}</p>
          </div>
        </div>
        <div className="context-card-meta">
          {!exists && loaded ? <span className="context-empty-pill">Empty</span> : null}
          <code>{path}</code>
        </div>
      </header>

      <div className="context-card-toolbar">
        <div className="context-mode-toggle" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            className={mode === "preview" ? "active" : ""}
            onClick={() => { if (dirty) save(); else setMode("preview"); }}
          >
            <Eye size={12} />
            Preview
          </button>
          <button
            type="button"
            role="tab"
            className={mode === "edit" ? "active" : ""}
            onClick={() => setMode("edit")}
          >
            <Pencil size={12} />
            Edit
          </button>
        </div>
        <div className="context-card-actions">
          <button
            type="button"
            className="button button-ghost compact"
            onClick={() => onAskClaude(`Review ${path} and suggest a cleaner, sharper version that Claude can use during /prime.`)}
            disabled={busy}
          >
            <Bot size={13} />
            Ask Claude
          </button>
          <button
            type="button"
            className="button button-ghost compact"
            onClick={restoreTemplate}
            disabled={busy}
            title="Replace with the starter-kit template"
          >
            <RefreshCw size={13} />
            Restore template
          </button>
          {mode === "edit" ? (
            <button
              type="button"
              className="button button-primary compact"
              onClick={save}
              disabled={!dirty || busy}
            >
              {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          ) : null}
        </div>
      </div>

      {mode === "preview" ? (
        <div className="context-preview">
          {!loaded ? (
            <p className="context-placeholder">Loading…</p>
          ) : exists && content.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <p className="context-placeholder">
              No content yet — click <strong>Edit</strong> to add some, or <strong>Restore template</strong> to start from the AIOS starter.
            </p>
          )}
        </div>
      ) : (
        <textarea
          className="context-editor"
          value={content}
          onChange={(event) => { setContent(event.target.value); setDirty(true); }}
          placeholder={loaded ? `Tell Claude about your ${spec.title.toLowerCase()}…` : "Loading…"}
          spellCheck={false}
          rows={14}
          disabled={!loaded || busy}
          autoFocus
        />
      )}

      {status ? <div className="context-status-bar">{status}</div> : null}
    </article>
  );
}


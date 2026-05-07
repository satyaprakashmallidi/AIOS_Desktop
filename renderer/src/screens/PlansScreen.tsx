import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ClipboardList,
  FolderOpen,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { invoke } from "../lib/api";
import { formatRelativeTime } from "../lib/workspace-view";
import { EmptyState } from "../components/ui";
import type { FilePreview, WorkspaceEntry } from "../types";

function cleanMarkdownPreview(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function PlansScreen({
  entries,
  onAskClaude,
  onRefresh
}: {
  entries: WorkspaceEntry[];
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [planPrompt, setPlanPrompt] = useState("");
  const [openEntry, setOpenEntry] = useState<WorkspaceEntry | null>(null);

  useEffect(() => {
    if (!openEntry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenEntry(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openEntry]);

  return (
    <section className="plans-screen">
      <div className="plans-shell">
        <header className="plans-hero">
          <div className="plans-hero-text">
            <p className="layer-badge"><span className="layer-dot" aria-hidden="true" />Layer · Plans</p>
            <h1>Implementation <em>plans</em></h1>
            <p className="plans-hero-detail">
              Plans are the proposal layer between strategy and execution. Describe a goal, let Claude draft a step-by-step plan,
              review it, then run <code>/implement</code> to execute.
            </p>
          </div>
          <div className="plans-overview">
            <ClipboardList size={13} />
            <span><strong>{entries.length}</strong> {entries.length === 1 ? "plan" : "plans"}</span>
          </div>
        </header>

        <div className="plans-create">
          <div className="plans-create-head">
            <Sparkles size={14} />
            Describe a plan
          </div>
          <textarea
            className="plans-create-textarea"
            value={planPrompt}
            onChange={(event) => setPlanPrompt(event.target.value)}
            placeholder="e.g. Build a competitor analysis dashboard, or rewrite onboarding emails based on last quarter's feedback…"
            rows={3}
          />
          <div className="plans-create-actions">
            <button
              type="button"
              className="button button-primary compact"
              disabled={!planPrompt.trim()}
              onClick={() => {
                onAskClaude(`/create-plan ${planPrompt.trim()}`);
                setPlanPrompt("");
              }}
            >
              <Sparkles size={13} />
              Create with Claude
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            title="No plans yet"
            body="Describe a goal above and let Claude draft a structured plan you can review and queue for implementation."
          />
        ) : (
          <div className="plans-grid">
            {entries.map((entry) => (
              <PlanCard
                key={entry.path}
                entry={entry}
                onOpen={() => setOpenEntry(entry)}
                onAskClaude={onAskClaude}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </div>

      {openEntry ? (
        <PlanDetailModal
          entry={openEntry}
          onClose={() => setOpenEntry(null)}
          onAskClaude={onAskClaude}
          onRefresh={onRefresh}
        />
      ) : null}
    </section>
  );
}

function PlanCard({
  entry,
  onOpen,
  onAskClaude,
  onRefresh
}: {
  entry: WorkspaceEntry;
  onOpen: () => void;
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function deletePlan(event: React.MouseEvent) {
    event.stopPropagation();
    if (!confirm(`Delete ${entry.name}?`)) return;
    setBusy(true);
    try {
      await invoke("delete_workspace_file", { path: entry.path });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const cleanedPreview = cleanMarkdownPreview(entry.preview);

  return (
    <article className="plan-card">
      <button type="button" className="plan-card-main" onClick={onOpen}>
        <div className="plan-card-head">
          <span className="plan-card-icon"><ClipboardList size={15} /></span>
          <div className="plan-card-title">
            <strong>{entry.name}</strong>
            <div className="plan-card-meta">
              <span>{formatRelativeTime(entry.modifiedAt)}</span>
              <span className="plan-card-dot">·</span>
              <span>{Math.round((entry.size / 1024) * 10) / 10} KB</span>
            </div>
          </div>
        </div>
        {cleanedPreview ? <p className="plan-card-preview">{cleanedPreview}</p> : null}
      </button>

      <div className="plan-card-actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="plan-primary-btn"
          onClick={() => onAskClaude(`/implement ${entry.path}`)}
          title="Run /implement on this plan"
        >
          <Play size={13} />
          Implement
        </button>
        <div className="plan-icon-group">
          <button
            type="button"
            className="plan-icon-btn"
            onClick={() => invoke("reveal_in_file_manager", { path: entry.path })}
            title="Reveal in file manager"
            aria-label="Reveal in file manager"
          >
            <FolderOpen size={13} />
          </button>
          <button
            type="button"
            className="plan-icon-btn danger"
            onClick={deletePlan}
            disabled={busy}
            title="Delete plan"
            aria-label="Delete plan"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}

function PlanDetailModal({
  entry,
  onClose,
  onAskClaude,
  onRefresh
}: {
  entry: WorkspaceEntry;
  onClose: () => void;
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<FilePreview>("read_markdown_preview", { path: entry.path })
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  async function deletePlan() {
    if (!confirm(`Delete ${entry.name}?`)) return;
    setBusy(true);
    try {
      await invoke("delete_workspace_file", { path: entry.path });
      await onRefresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="detail-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="detail-modal-card detail-modal-plan" onClick={(event) => event.stopPropagation()}>
        <header className="detail-modal-head">
          <div className="detail-modal-head-left">
            <span className="detail-modal-icon plan"><ClipboardList size={15} /></span>
            <div>
              <p className="detail-modal-eyebrow">Plan</p>
              <h2>{entry.name}</h2>
              <div className="detail-modal-meta">
                <span>{formatRelativeTime(entry.modifiedAt)}</span>
                <span className="detail-modal-dot">·</span>
                <span>{Math.round((entry.size / 1024) * 10) / 10} KB</span>
              </div>
            </div>
          </div>
          <div className="detail-modal-head-actions">
            <button
              type="button"
              className="plan-primary-btn"
              onClick={() => {
                onAskClaude(`/implement ${entry.path}`);
                onClose();
              }}
              title="Run /implement on this plan"
            >
              <Play size={13} />
              Implement
            </button>
            <button
              type="button"
              className="detail-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="detail-modal-body aios-markdown">
          {loading ? (
            <div className="plan-card-loading">
              <Loader2 size={14} className="spin" />
              Loading…
            </div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview?.content ?? "*Empty file*"}</ReactMarkdown>
          )}
        </div>
        <footer className="detail-modal-footer">
          <button
            type="button"
            className="button button-ghost compact"
            onClick={() => {
              onAskClaude(`Read ${entry.path} and suggest improvements before I run /implement.`);
              onClose();
            }}
          >
            <Bot size={13} />
            Ask Claude to refine
          </button>
          <div className="detail-modal-footer-right">
            <button
              type="button"
              className="plan-icon-btn"
              onClick={() => invoke("reveal_in_file_manager", { path: entry.path })}
              title="Reveal in file manager"
            >
              <FolderOpen size={13} />
            </button>
            <button
              type="button"
              className="plan-icon-btn danger"
              onClick={deletePlan}
              disabled={busy}
              title="Delete plan"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

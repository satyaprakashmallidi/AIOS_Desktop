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
import { EmptyState, ConfirmModal } from "../components/ui";
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
  onRefresh,
  initialOpenPath,
  onInitialOpenConsumed
}: {
  entries: WorkspaceEntry[];
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
  // When set, find the matching entry on mount and open it. Used to deep-link
  // from chat-bubble attachment chips into the relevant plan file.
  initialOpenPath?: string | null;
  onInitialOpenConsumed?: () => void;
}) {
  const [planPrompt, setPlanPrompt] = useState("");
  const [openEntry, setOpenEntry] = useState<WorkspaceEntry | null>(null);
  // Lift the delete-confirm state to the parent so both the card click and the
  // detail modal click route through the same ConfirmModal. Matches the
  // pattern OutputsScreen uses.
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<WorkspaceEntry | null>(null);

  useEffect(() => {
    if (!openEntry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenEntry(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openEntry]);

  useEffect(() => {
    if (!initialOpenPath) return;
    const match = entries.find((e) => e.path === initialOpenPath);
    if (match) {
      setOpenEntry(match);
      onInitialOpenConsumed?.();
    }
  }, [initialOpenPath, entries, onInitialOpenConsumed]);

  async function handleConfirmDelete() {
    if (!confirmDeleteEntry) return;
    try {
      await invoke("delete_workspace_file", { path: confirmDeleteEntry.path });
      setConfirmDeleteEntry(null);
      if (openEntry && openEntry.path === confirmDeleteEntry.path) setOpenEntry(null);
      await onRefresh();
    } catch (err) {
      console.error("Failed to delete plan:", err);
      setConfirmDeleteEntry(null);
    }
  }

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
            body="Plans are structured Markdown documents Claude drafts before doing real work — they capture goal, current state, proposed changes, and step-by-step tasks. Use /create-plan in chat or click below."
            action={
              <button
                type="button"
                className="button button-primary compact"
                onClick={() => onAskClaude("/create-plan ")}
              >
                Ask Claude to draft a plan
              </button>
            }
          />
        ) : (
          <div className="plans-grid">
            {entries.map((entry) => (
              <PlanCard
                key={entry.path}
                entry={entry}
                onOpen={() => setOpenEntry(entry)}
                onAskClaude={onAskClaude}
                onDelete={() => setConfirmDeleteEntry(entry)}
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
          onDelete={() => setConfirmDeleteEntry(openEntry)}
        />
      ) : null}

      <ConfirmModal
        open={!!confirmDeleteEntry}
        title="Delete plan?"
        message={confirmDeleteEntry ? `Delete "${confirmDeleteEntry.name}"? This can't be undone.` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteEntry(null)}
      />
    </section>
  );
}

function PlanCard({
  entry,
  onOpen,
  onAskClaude,
  onDelete
}: {
  entry: WorkspaceEntry;
  onOpen: () => void;
  onAskClaude: (prompt: string) => void;
  onDelete: () => void;
}) {
  function deletePlan(event: React.MouseEvent) {
    event.stopPropagation();
    onDelete();
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
  onDelete
}: {
  entry: WorkspaceEntry;
  onClose: () => void;
  onAskClaude: (prompt: string) => void;
  onDelete: () => void;
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);

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
              onClick={onDelete}
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

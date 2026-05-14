import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Box,
  Clock,
  Database,
  FileText,
  FolderOpen,
  LineChart,
  Loader2,
  MessageCircle,
  Package,
  Trash2,
  X
} from "lucide-react";
import { invoke } from "../lib/api";
import { formatRelativeTime } from "../lib/workspace-view";
import { EmptyState, ConfirmModal } from "../components/ui";
import type { AutoTaskRun, FilePreview, WorkspaceEntry } from "../types";

type CategoryId = "all" | "auto-tasks" | "data" | "intel" | "shares" | "other";

interface CategorySpec {
  id: CategoryId;
  label: string;
  icon: React.ReactNode;
  match: (entry: WorkspaceEntry) => boolean;
}

const CATEGORIES: CategorySpec[] = [
  { id: "all", label: "All", icon: <Box size={13} />, match: () => true },
  { id: "auto-tasks", label: "Auto Tasks", icon: <Clock size={13} />, match: (e) => e.path.startsWith("outputs/auto-tasks/") },
  { id: "data", label: "Data", icon: <LineChart size={13} />, match: (e) => e.path.startsWith("outputs/data/") },
  { id: "intel", label: "Intel", icon: <MessageCircle size={13} />, match: (e) => e.path.startsWith("outputs/intel/") || e.path.startsWith("outputs/meetings/") },
  { id: "shares", label: "Shares", icon: <Package size={13} />, match: (e) => e.kind === "share" || e.path.startsWith("shares/") },
  { id: "other", label: "Other", icon: <FileText size={13} />, match: () => true }
];

// Daily briefs live on their own page — exclude them from the Outputs view.
function isDailyBrief(entry: WorkspaceEntry): boolean {
  return entry.path.startsWith("outputs/daily-brief/");
}

function categorize(entry: WorkspaceEntry): CategoryId {
  for (const cat of CATEGORIES) {
    if (cat.id === "all" || cat.id === "other") continue;
    if (cat.match(entry)) return cat.id;
  }
  return "other";
}

function iconFor(category: CategoryId): React.ReactNode {
  const cat = CATEGORIES.find((c) => c.id === category);
  return cat?.icon ?? <FileText size={13} />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OutputsScreen({
  outputs,
  shares,
  onAskClaude,
  onRefresh,
  initialOpenPath,
  onInitialOpenConsumed
}: {
  outputs: WorkspaceEntry[];
  shares: WorkspaceEntry[];
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
  // When set, find the matching entry on mount and open it. Used to deep-link
  // from chat-bubble attachment chips into the relevant output file.
  initialOpenPath?: string | null;
  onInitialOpenConsumed?: () => void;
}) {
  const [filter, setFilter] = useState<CategoryId>("all");
  const [openEntry, setOpenEntry] = useState<WorkspaceEntry | null>(null);
  const [recentRuns, setRecentRuns] = useState<AutoTaskRun[]>([]);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  useEffect(() => {
    if (!initialOpenPath) return;
    const allEntries = [...outputs, ...shares];
    const match = allEntries.find((e) => e.path === initialOpenPath);
    if (match) {
      setOpenEntry(match);
      onInitialOpenConsumed?.();
    }
  }, [initialOpenPath, outputs, shares, onInitialOpenConsumed]);

  useEffect(() => {
    if (!openEntry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenEntry(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openEntry]);

  const allEntries = useMemo(
    () => [...outputs, ...shares].filter((e) => !isDailyBrief(e)),
    [outputs, shares]
  );

  useEffect(() => {
    invoke<{ runs: AutoTaskRun[] }>("list_recent_auto_runs", { limit: 5 })
      .then((res) => setRecentRuns(res?.runs ?? []))
      .catch(() => undefined);
  }, [outputs.length]);

  const filtered = useMemo(() => {
    if (filter === "all") return allEntries;
    if (filter === "other") return allEntries.filter((e) => categorize(e) === "other");
    const spec = CATEGORIES.find((c) => c.id === filter);
    return spec ? allEntries.filter(spec.match) : allEntries;
  }, [allEntries, filter]);

  async function handleConfirmDelete() {
    if (!confirmDeletePath) return;
    try {
      await invoke("delete_workspace_file", { path: confirmDeletePath });
      setConfirmDeletePath(null);
      setOpenEntry(null);
      await onRefresh();
    } catch (err) {
      console.error("Failed to delete file:", err);
      setConfirmDeletePath(null);
    }
  }

  return (
    <section className="outputs-screen">
      <div className="outputs-shell">
        <header className="outputs-hero">
          <div className="outputs-hero-text">
            <p className="layer-badge"><span className="layer-dot" aria-hidden="true" />Layer · Outputs</p>
            <h1>Generated <em>work</em></h1>
            <p className="outputs-hero-detail">
              Everything the AIOS system produces — Claude's session work, daily briefs, data snapshots, intel digests,
              and your shareable packages.
            </p>
          </div>
          <div className="outputs-overview">
            <Box size={13} />
            <span><strong>{allEntries.length}</strong> {allEntries.length === 1 ? "file" : "files"}</span>
          </div>
        </header>

        {recentRuns.length > 0 ? (
          <div className="outputs-runs-strip">
            <div className="outputs-runs-strip-head">
              <Clock size={13} />
              Latest auto-task runs
            </div>
            <div className="outputs-runs-list">
              {recentRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={`outputs-run-chip ${run.status}`}
                  onClick={() => {
                    if (run.outputPath) {
                      const target = allEntries.find((e) => e.path === run.outputPath);
                      if (target) setOpenEntry(target);
                      setFilter("auto-tasks");
                    }
                  }}
                  title={run.error || run.outputPath || "Auto-task run"}
                  >
                  <span className="outputs-run-dot" />
                  <strong>{run.taskName ?? `Task #${run.taskId}`}</strong>
                  <span>· {formatRelativeTime(run.startedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="outputs-filter-strip" role="tablist" aria-label="Filter outputs by source">
          {CATEGORIES.map((cat) => {
            const count = cat.id === "all"
              ? allEntries.length
              : cat.id === "other"
                ? allEntries.filter((e) => categorize(e) === "other").length
                : allEntries.filter(cat.match).length;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={filter === cat.id}
                className={`outputs-pill ${filter === cat.id ? "active" : ""}`}
                onClick={() => setFilter(cat.id)}
              >
                {cat.icon}
                <span>{cat.label}</span>
                <span className="outputs-pill-count">{count}</span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Outputs from Claude sessions and AIOS modules will appear here as they're generated."
          />
        ) : (
          <div className="outputs-grid">
            {filtered.map((entry) => (
              <OutputCard
                key={entry.path}
                entry={entry}
                onOpen={() => setOpenEntry(entry)}
                onAskClaude={onAskClaude}
                onRefresh={onRefresh}
                onDelete={() => setConfirmDeletePath(entry.path)}
              />
            ))}
          </div>
        )}
      </div>

      {openEntry ? (
        <OutputDetailModal
          entry={openEntry}
          onClose={() => setOpenEntry(null)}
          onAskClaude={onAskClaude}
          onRefresh={onRefresh}
          onDelete={() => setConfirmDeletePath(openEntry.path)}
        />
      ) : null}

      <ConfirmModal
        open={!!confirmDeletePath}
        title="Delete file?"
        message={`Are you sure you want to delete this file? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeletePath(null)}
      />
    </section>
  );
}

function OutputCard({
  entry,
  onOpen,
  onAskClaude,
  onRefresh,
  onDelete
}: {
  entry: WorkspaceEntry;
  onOpen: () => void;
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
}) {
  const category = categorize(entry);
  const [busy, setBusy] = useState(false);

  async function deleteEntry(event: React.MouseEvent) {
    event.stopPropagation();
    onDelete();
  }

  return (
    <article className="output-card">
      <button type="button" className="output-card-main" onClick={onOpen}>
        <div className="output-card-head">
          <span className="output-card-icon">{iconFor(category)}</span>
          <div className="output-card-body">
            <div className="output-card-title">
              <strong title={entry.name}>{entry.name}</strong>
              {entry.extension ? <span className="output-card-ext">.{entry.extension}</span> : null}
            </div>
            <div className="output-card-meta">
              <span>{formatRelativeTime(entry.modifiedAt)}</span>
              <span className="output-card-dot">·</span>
              <span>{formatBytes(entry.size)}</span>
            </div>
            <div className="output-card-path-row" title={entry.path}>{entry.path}</div>
          </div>
        </div>
      </button>
      <div className="output-card-actions" onClick={(event) => event.stopPropagation()}>
        <div className="output-icon-group">
          <button
            type="button"
            className="output-icon-btn"
            onClick={() => onAskClaude(`Review ${entry.path} and tell me what's important.`)}
            title="Ask Claude about this file"
            aria-label="Ask Claude about this file"
          >
            <Bot size={13} />
          </button>
          <button
            type="button"
            className="output-icon-btn"
            onClick={() => invoke("reveal_in_file_manager", { path: entry.path })}
            title="Reveal in file manager"
            aria-label="Reveal in file manager"
          >
            <FolderOpen size={13} />
          </button>
          <button
            type="button"
            className="output-icon-btn danger"
            onClick={deleteEntry}
            disabled={busy}
            title="Delete file"
            aria-label="Delete file"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}

function OutputDetailModal({
  entry,
  onClose,
  onAskClaude,
  onRefresh,
  onDelete
}: {
  entry: WorkspaceEntry;
  onClose: () => void;
  onAskClaude: (prompt: string) => void;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
}) {
  const category = categorize(entry);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const isPreviewable = /\.(md|markdown|txt|json|csv|tsv|html|xml|yaml|yml|toml)$/i.test(entry.name);

  useEffect(() => {
    if (!isPreviewable) return;
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
  }, [entry.path, isPreviewable]);

  async function deleteEntry() {
    onDelete();
  }

  return (
    <div
      className="detail-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="detail-modal-card detail-modal-output" onClick={(event) => event.stopPropagation()}>
        <header className="detail-modal-head">
          <div className="detail-modal-head-left">
            <span className="detail-modal-icon output">{iconFor(category)}</span>
            <div>
              <p className="detail-modal-eyebrow">Output{entry.extension ? ` · .${entry.extension}` : ""}</p>
              <h2>{entry.name}</h2>
              <div className="detail-modal-meta">
                <span>{formatRelativeTime(entry.modifiedAt)}</span>
                <span className="detail-modal-dot">·</span>
                <span>{formatBytes(entry.size)}</span>
                <span className="detail-modal-dot">·</span>
                <span className="detail-modal-path" title={entry.path}>{entry.path}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="detail-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="detail-modal-body aios-markdown">
          {!isPreviewable ? (
            <p className="detail-modal-empty">This file type can't be previewed inline. Use "Reveal in file manager" to open it.</p>
          ) : loading ? (
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
              onAskClaude(`Review ${entry.path} and tell me what's important.`);
              onClose();
            }}
          >
            <Bot size={13} />
            Ask Claude about this
          </button>
          <div className="detail-modal-footer-right">
            <button
              type="button"
              className="output-icon-btn"
              onClick={() => invoke("reveal_in_file_manager", { path: entry.path })}
              title="Reveal in file manager"
            >
              <FolderOpen size={13} />
            </button>
            <button
              type="button"
              className="output-icon-btn danger"
              onClick={deleteEntry}
              disabled={busy}
              title="Delete file"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

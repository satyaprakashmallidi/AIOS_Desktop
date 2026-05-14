import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, ArrowRight, Loader2, Sun } from "lucide-react";
import { invoke } from "../lib/api";
import type { ClaudeStatus, DailyBrief, DailyBriefStatus } from "../types";

interface Props {
  status: DailyBriefStatus;
  claude: ClaudeStatus | null;
  onAcknowledge: () => void;
  onOpenBriefsPage: () => void;
}

function formatPrettyDate(dateIso: string): string {
  try {
    const dt = new Date(`${dateIso}T00:00:00`);
    return dt.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  } catch {
    return dateIso;
  }
}

export function DailyBriefModal({ status, claude, onAcknowledge, onOpenBriefsPage }: Props) {
  const [brief, setBrief] = useState<DailyBrief | null>(status.existingBrief);
  const [loading, setLoading] = useState<boolean>(!status.existingBrief);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Block Escape and prevent backdrop click from closing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Generate the brief if not already saved.
  useEffect(() => {
    let cancelled = false;
    if (status.existingBrief) {
      setBrief(status.existingBrief);
      setLoading(false);
      return;
    }
    if (!claude?.found || !claude.runtimeOk) {
      setError({
        code: "CLAUDE_NOT_CONFIGURED",
        message: "Claude Code is not configured. Connect Claude in Settings to receive your daily brief."
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    invoke<{ brief: DailyBrief; regenerated: boolean }>("generate_daily_brief", {
      claudePath: claude.path,
      localDate: status.todayDate
    })
      .then((res) => {
        if (cancelled) return;
        setBrief(res?.brief ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code ?? "BRIEF_GENERATION_FAILED";
        setError({ code, message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status.todayDate, status.existingBrief, claude?.found, claude?.runtimeOk, claude?.path]);

  async function acknowledge() {
    try {
      await invoke("mark_brief_seen", { localDate: status.todayDate });
    } catch {
      /* swallow — UI proceeds either way */
    }
    onAcknowledge();
  }

  async function openBriefsPage() {
    try {
      await invoke("mark_brief_seen", { localDate: status.todayDate });
    } catch {
      /* swallow */
    }
    onOpenBriefsPage();
  }

  const hasContent = !!brief?.content;
  const canAck = !loading && (hasContent || !!error);

  return (
    <div className="daily-brief-overlay" role="dialog" aria-modal="true" aria-labelledby="daily-brief-title">
      <div className="daily-brief-card">
        <div className="daily-brief-eyebrow">
          <Sun size={14} />
          <span>Today's brief · {formatPrettyDate(status.todayDate)}</span>
        </div>

        {loading ? (
          <div className="daily-brief-loading">
            <Loader2 size={20} className="spin" />
            <p>Putting together your morning brief…</p>
            <span className="daily-brief-loading-detail">Reading your context, plans, and recent work.</span>
          </div>
        ) : error ? (
          <div className="daily-brief-error">
            <div className="daily-brief-error-icon">
              <AlertTriangle size={20} />
            </div>
            <h2 id="daily-brief-title">{error.code === "CLAUDE_NOT_CONFIGURED" ? "Claude Code is not configured" : "Couldn't generate today's brief"}</h2>
            <p>{error.message}</p>
            {error.code === "CLAUDE_NOT_CONFIGURED" ? (
              <p className="daily-brief-error-hint">Open Settings → Claude CLI to connect Claude Code, then restart the app to see tomorrow's brief.</p>
            ) : null}
          </div>
        ) : hasContent ? (
          <>
            {brief?.headline ? (
              <h2 id="daily-brief-title" className="daily-brief-headline">{brief.headline.replace(/^##\s*/, "")}</h2>
            ) : null}
            <div className="daily-brief-body aios-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {brief?.content?.replace(/^##\s+.+\n/, "") ?? ""}
              </ReactMarkdown>
            </div>
          </>
        ) : (
          <div className="daily-brief-error">
            <h2>No brief content</h2>
            <p>The brief came back empty. You can acknowledge to continue.</p>
          </div>
        )}

        <div className="daily-brief-actions">
          {!error ? (
            <div className="daily-brief-actions-secondary">
              <button
                type="button"
                className="daily-brief-secondary"
                onClick={openBriefsPage}
                disabled={loading}
              >
                View past briefs
              </button>
              <button
                type="button"
                className="daily-brief-secondary"
                onClick={acknowledge}
                disabled={loading}
                title="Dismiss the modal — today's brief keeps generating in the background and lands in the Briefs tab"
              >
                Skip for now
              </button>
            </div>
          ) : <span />}
          <button
            type="button"
            className="daily-brief-primary"
            onClick={acknowledge}
            disabled={!canAck}
          >
            {error ? "OK, continue" : "I've read it · start my day"}
            {!error ? <ArrowRight size={14} /> : null}
          </button>
        </div>
      </div>
    </div>
  );
}

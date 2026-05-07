import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Inbox, Sun, X } from "lucide-react";
import { invoke } from "../lib/api";
import { EmptyState } from "../components/ui";
import type { DailyBrief } from "../types";

function formatDateChip(dateIso: string): { day: string; date: string } {
  try {
    const dt = new Date(`${dateIso}T00:00:00`);
    return {
      day: dt.toLocaleDateString(undefined, { month: "short" }),
      date: String(dt.getDate())
    };
  } catch {
    return { day: "—", date: dateIso };
  }
}

function startOfWeek(): number {
  const now = new Date();
  const dow = now.getDay(); // 0 = Sun, 1 = Mon...
  const offset = (dow + 6) % 7; // make Mon = 0
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime();
}

function groupBriefs(briefs: DailyBrief[]): Array<{ label: string; items: DailyBrief[] }> {
  const thisWeekStart = startOfWeek();
  const lastWeekStart = thisWeekStart - 7 * 86_400_000;
  const thisWeek: DailyBrief[] = [];
  const lastWeek: DailyBrief[] = [];
  const earlier: DailyBrief[] = [];
  for (const brief of briefs) {
    const t = new Date(`${brief.briefDate}T00:00:00`).getTime();
    if (t >= thisWeekStart) thisWeek.push(brief);
    else if (t >= lastWeekStart) lastWeek.push(brief);
    else earlier.push(brief);
  }
  const groups: Array<{ label: string; items: DailyBrief[] }> = [];
  if (thisWeek.length) groups.push({ label: "This week", items: thisWeek });
  if (lastWeek.length) groups.push({ label: "Last week", items: lastWeek });
  if (earlier.length) groups.push({ label: "Earlier", items: earlier });
  return groups;
}

export function BriefsScreen() {
  const [briefs, setBriefs] = useState<DailyBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBrief, setOpenBrief] = useState<DailyBrief | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<{ briefs: DailyBrief[] }>("list_daily_briefs", { limit: 90 })
      .then((res) => {
        if (cancelled) return;
        setBriefs(res?.briefs ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on Escape when modal is open
  useEffect(() => {
    if (!openBrief) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenBrief(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openBrief]);

  const groups = useMemo(() => groupBriefs(briefs), [briefs]);

  return (
    <section className="briefs-screen">
      <div className="briefs-shell">
        <header className="briefs-hero">
          <div className="briefs-hero-left">
            <div className="briefs-hero-icon"><Sun size={18} /></div>
            <div>
              <h1>Daily <em>briefs</em></h1>
              <p>Every morning's snapshot — what was on your plate, what to focus on, what to glance at.</p>
            </div>
          </div>
          <div className="briefs-overview">
            <Inbox size={13} />
            <span><strong>{briefs.length}</strong> {briefs.length === 1 ? "brief" : "briefs"}</span>
          </div>
        </header>

        {loading ? (
          <div className="briefs-loading">Loading briefs…</div>
        ) : briefs.length === 0 ? (
          <EmptyState
            title="No briefs yet"
            body="Daily briefs will appear here from your second day onward — every morning when you open the app."
          />
        ) : (
          <div className="briefs-groups">
            {groups.map((group) => (
              <section key={group.label} className="briefs-group">
                <h2 className="briefs-group-label">{group.label}</h2>
                <div className="briefs-grid">
                  {group.items.map((brief) => {
                    const chip = formatDateChip(brief.briefDate);
                    return (
                      <article key={brief.id} className="briefs-card">
                        <button
                          type="button"
                          className="briefs-card-main"
                          onClick={() => setOpenBrief(brief)}
                        >
                          <div className="briefs-date-chip">
                            <span className="briefs-date-day">{chip.day}</span>
                            <span className="briefs-date-date">{chip.date}</span>
                          </div>
                          <div className="briefs-card-text">
                            <strong>{brief.headline || "Daily brief"}</strong>
                            <p>{(brief.content || "").replace(/^##\s+.+\n/, "").replace(/[#*_`>]/g, "").slice(0, 180).trim() || "Empty brief"}</p>
                          </div>
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {openBrief ? (
        <div
          className="briefs-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenBrief(null)}
        >
          <div className="briefs-modal-card" onClick={(event) => event.stopPropagation()}>
            <header className="briefs-modal-head">
              <div>
                <p className="briefs-modal-eyebrow">
                  <Sun size={12} />
                  Daily brief · {formatDateChip(openBrief.briefDate).day} {formatDateChip(openBrief.briefDate).date}
                </p>
                <h2>{openBrief.headline?.replace(/^##\s*/, "") || "Daily brief"}</h2>
              </div>
              <button
                type="button"
                className="briefs-modal-close"
                onClick={() => setOpenBrief(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </header>
            <div className="briefs-modal-body aios-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {openBrief.content?.replace(/^##\s+.+\n/, "") || "*Empty brief*"}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

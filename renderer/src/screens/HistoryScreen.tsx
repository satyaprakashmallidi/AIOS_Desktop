import React, { useEffect, useMemo, useState } from "react";
import { Clock, Inbox, MessageSquare, Search, Trash2 } from "lucide-react";
import { invoke } from "../lib/api";
import { formatRelativeTime } from "../lib/workspace-view";
import { EmptyState } from "../components/ui";
import type { ChatSession } from "../types";

function displayTitle(session: ChatSession): string {
  const raw = (session.title || "").trim();
  const generic = !raw || raw.toLowerCase() === "new chat" || raw.toLowerCase() === "new thread" || raw.toLowerCase() === "main";
  if (!generic) return raw;
  const firstUser = session.messages.find((m) => m.role === "user" && m.content?.trim());
  if (firstUser) {
    const text = firstUser.content.trim().replace(/\s+/g, " ");
    return text.length > 64 ? `${text.slice(0, 63)}…` : text;
  }
  return raw || "Untitled chat";
}

function groupSessions(sessions: ChatSession[]): Array<{ label: string; items: ChatSession[] }> {
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const thisWeek: ChatSession[] = [];
  const thisMonth: ChatSession[] = [];
  const older: ChatSession[] = [];

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = startOfDay - 86_400_000;
  const weekStart = startOfDay - 7 * 86_400_000;
  const monthStart = startOfDay - 30 * 86_400_000;

  for (const session of sessions) {
    const t = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
    if (t >= startOfDay) today.push(session);
    else if (t >= yesterdayStart) yesterday.push(session);
    else if (t >= weekStart) thisWeek.push(session);
    else if (t >= monthStart) thisMonth.push(session);
    else older.push(session);
  }

  const groups: Array<{ label: string; items: ChatSession[] }> = [];
  if (today.length) groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (thisWeek.length) groups.push({ label: "Previous 7 days", items: thisWeek });
  if (thisMonth.length) groups.push({ label: "Previous 30 days", items: thisMonth });
  if (older.length) groups.push({ label: "Older", items: older });
  return groups;
}

export function HistoryScreen({
  sessions,
  activeSessionId,
  onOpenSession,
  onSessionsChange
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onOpenSession: (id: string) => void;
  onSessionsChange: (next: (current: ChatSession[]) => ChatSession[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 10);
    return () => window.clearTimeout(id);
  }, []);

  const populated = useMemo(
    () => sessions.filter((s) => s.messages.some((m) => m.content?.trim())),
    [sessions]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return populated;
    return populated.filter((session) => {
      if (session.title?.toLowerCase().includes(q)) return true;
      return session.messages.some((message) => message.content?.toLowerCase().includes(q));
    });
  }, [populated, query]);

  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  async function deleteSession(session: ChatSession) {
    if (!confirm(`Delete chat "${session.title}"? This cannot be undone.`)) return;
    setBusyId(session.id);
    try {
      await invoke("delete_thread", { id: session.id });
      onSessionsChange((current) => current.filter((s) => s.id !== session.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="history-screen">
      <div className={`history-shell ${mounted ? "is-mounted" : ""}`}>
        <header className="history-hero">
          <div className="history-hero-left">
            <div className="history-hero-icon"><Clock size={18} /></div>
            <div>
              <h1><em>History</em></h1>
              <p>Every conversation, searchable. Open one to continue with full memory.</p>
            </div>
          </div>
          <div className="history-overview">
            <Inbox size={13} />
            <span><strong>{populated.length}</strong> {populated.length === 1 ? "chat" : "chats"}</span>
          </div>
        </header>

        <div className="history-search">
          <Search size={14} />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats by title or message…"
            spellCheck={false}
            autoFocus
          />
          {query ? (
            <button type="button" className="history-search-clear" onClick={() => setQuery("")} title="Clear">
              ×
            </button>
          ) : null}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={populated.length === 0 ? "No chats yet" : "No matches"}
            body={populated.length === 0
              ? "Start a new conversation from the sidebar to see it here."
              : "Try a different search term."}
          />
        ) : (
          <div className="history-groups">
            {groups.map((group) => (
              <section key={group.label} className="history-group">
                <h2 className="history-group-label">{group.label}</h2>
                <div className="history-group-list">
                  {group.items.map((session, index) => {
                    const lastMessage = session.messages[session.messages.length - 1];
                    const preview = lastMessage?.content?.trim() || "Empty conversation";
                    const isActive = activeSessionId === session.id;
                    return (
                      <article
                        key={session.id}
                        className={`history-row ${isActive ? "active" : ""}`}
                        style={{ "--row-delay": `${Math.min(index * 25, 200)}ms` } as React.CSSProperties}
                      >
                        <button
                          type="button"
                          className="history-row-body"
                          onClick={() => onOpenSession(session.id)}
                          title="Open chat"
                        >
                          <span className="history-row-icon"><MessageSquare size={13} /></span>
                          <span className="history-row-text">
                            <span className="history-row-title">{displayTitle(session)}</span>
                            <span className="history-row-preview">{preview}</span>
                          </span>
                          <span className="history-row-meta">
                            <span className="history-row-time">{formatRelativeTime(session.updatedAt ?? "")}</span>
                            <span className="history-row-dot">·</span>
                            <span>{session.messages.length}</span>
                            {session.claudeSessionId ? <span className="history-row-pill">memory</span> : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="history-row-delete"
                          onClick={() => deleteSession(session)}
                          disabled={busyId === session.id}
                          title="Delete chat"
                          aria-label="Delete chat"
                        >
                          <Trash2 size={13} />
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
    </section>
  );
}

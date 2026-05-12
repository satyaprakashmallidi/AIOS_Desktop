import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  X
} from "lucide-react";
import { invoke } from "../lib/api";
import type { AgentInfo, TaskInfo } from "../types";

type Bucket = "queued" | "running" | "completed" | "failed";

const KANBAN_COLUMNS: Array<{ id: Bucket; title: string; statuses: Set<TaskInfo["status"]>; tone: Bucket }> = [
  { id: "queued",    title: "Queued",      statuses: new Set(["pending"]),                                                                                                tone: "queued"    },
  { id: "running",   title: "In progress", statuses: new Set(["in_progress", "blocked", "awaiting_connection", "awaiting_approval", "awaiting_children"]),                 tone: "running"   },
  { id: "completed", title: "Completed",   statuses: new Set(["completed"]),                                                                                              tone: "completed" },
  { id: "failed",    title: "Failed",      statuses: new Set(["failed", "cancelled"]),                                                                                    tone: "failed"    }
];

function formatStatusLabel(status: string): string {
  const normalized = status.replace(/_/g, " ").trim();
  return normalized ? normalized.replace(/\b\w/g, (ch) => ch.toUpperCase()) : "Unknown";
}

function summarizeTaskNote(task: TaskInfo): string {
  if (task.blocked_reason) return task.blocked_reason;
  if (task.result) return task.result;
  if (task.needs_connector) return `Awaiting ${task.needs_connector} connection.`;
  return task.message || "No notes yet.";
}

function formatDetailTimestamp(value: any): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatShortTime(value: any): string {
  if (!value) return "now";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "now" : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusBucket(status: TaskInfo["status"]): Bucket {
  for (const col of KANBAN_COLUMNS) {
    if (col.statuses.has(status)) return col.id;
  }
  return "queued";
}

function agentNameById(agents: AgentInfo[], agentId: string): string {
  return agents.find((a) => a.id === agentId)?.name ?? agentId;
}

export function TasksScreen() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [newPriority, setNewPriority] = useState(3);
  const [newAgentId, setNewAgentId] = useState("ceo");

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTask, setDetailsTask] = useState<TaskInfo | null>(null);
  const [detailsActionLoading, setDetailsActionLoading] = useState(false);
  const [detailsActionError, setDetailsActionError] = useState("");
  const [detailsActionNote, setDetailsActionNote] = useState("");

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    }, 5_000);
    // Live updates — the runner broadcasts these events as tasks change
    // state. Without this, the Kanban only refreshes every 5s, making
    // status transitions feel laggy.
    const unsub = window.aios?.onHostEvent?.((event: any) => {
      const name = event?.event;
      if (name === "task_update" || name === "task_narrative" || name === "agents_changed") {
        void refresh();
      }
    });
    return () => {
      clearInterval(interval);
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const [taskRes, agentRes] = await Promise.all([
        invoke<{ tasks: TaskInfo[] }>("list_tasks", {}),
        invoke<{ agents: AgentInfo[] }>("list_agents", {}),
      ]);
      setTasks(taskRes?.tasks || []);
      setAgents(agentRes?.agents || []);
    } catch (err) {
      console.error("Failed to load tasks/agents:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => t.name.toLowerCase().includes(q));
  }, [tasks, searchQuery]);

  async function handleCreateTask() {
    const message = newMessage.trim();
    if (!message) return;
    setSaving(true);
    try {
      await invoke<TaskInfo>("create_task", {
        name: `Task: ${message.slice(0, 60)}${message.length > 60 ? "…" : ""}`,
        message,
        agentId: newAgentId,
        priority: Math.max(1, Math.min(5, Number(newPriority) || 3)),
      });
      setCreateOpen(false);
      setNewMessage("");
      setNewPriority(3);
      setNewAgentId("ceo");
      void refresh();
    } catch (err) {
      console.error("Failed to create task:", err);
    } finally {
      setSaving(false);
    }
  }

  async function openDetails(task: TaskInfo) {
    if (!task.id) return;
    setDetailsOpen(true);
    setDetailsActionError("");
    setDetailsActionNote("");
    setDetailsTask(task);
    try {
      const fresh = await invoke<TaskInfo>("get_task", { id: task.id });
      if (fresh && fresh.id) setDetailsTask(fresh);
    } catch {
      // keep the cached row already shown
    }
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsTask(null);
    setDetailsActionLoading(false);
    setDetailsActionError("");
    setDetailsActionNote("");
  }

  async function handleTaskAction(action: string) {
    if (!detailsTask?.id) return;
    setDetailsActionLoading(true);
    setDetailsActionError("");
    try {
      const updated = await invoke<TaskInfo>("task_action", {
        id: detailsTask.id,
        action,
        note: detailsActionNote.trim() || undefined,
      });
      setDetailsActionNote("");
      if (updated && updated.id) setDetailsTask(updated);
      void refresh();
    } catch (err: any) {
      setDetailsActionError(err?.message || "Task action failed");
    } finally {
      setDetailsActionLoading(false);
    }
  }

  if (loading) {
    return (
      <section className="tasks-v2-screen">
        <div className="tasks-v2-loading">
          <Loader2 size={16} className="spin" />
          Loading tasks…
        </div>
      </section>
    );
  }

  return (
    <section className="tasks-v2-screen">
      <header className="tasks-v2-hero">
        <div className="tasks-v2-hero-content">
          <div className="tasks-v2-hero-text">
            <p className="layer-badge">
              <span className="layer-dot" aria-hidden="true" />
              Layer · Tasks
            </p>
            <h1>Your <em>tasks</em></h1>
            <p className="tasks-v2-subtitle">Manage your team's workload and track mission progress.</p>
          </div>

          <div className="tasks-v2-toolbar">
            <div className="tasks-v2-toolbar-left">
              <div className="tasks-v2-search">
                <Search size={13} aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search tasks…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                className="tasks-v2-create"
                onClick={() => setCreateOpen(true)}
                disabled={saving}
              >
                <Plus size={13} /> New mission
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="tasks-v2-body">
        <KanbanView tasks={filteredTasks} agents={agents} onOpen={openDetails} />
      </div>

      {createOpen && (
        <CreateTaskModal
          agents={agents}
          agentId={newAgentId}
          setAgentId={setNewAgentId}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          newPriority={newPriority}
          setNewPriority={setNewPriority}
          saving={saving}
          onCancel={() => setCreateOpen(false)}
          onCreate={handleCreateTask}
        />
      )}

      {detailsOpen && detailsTask && (
        <TaskDetailsModal
          task={detailsTask}
          agents={agents}
          allTasks={tasks}
          actionLoading={detailsActionLoading}
          actionError={detailsActionError}
          actionNote={detailsActionNote}
          setActionNote={setDetailsActionNote}
          onClose={closeDetails}
          onAction={handleTaskAction}
          onOpenTask={openDetails}
        />
      )}
    </section>
  );
}

function KanbanView({
  tasks,
  agents,
  onOpen
}: {
  tasks: TaskInfo[];
  agents: AgentInfo[];
  onOpen: (task: TaskInfo) => void;
}) {
  return (
    <div className="tasks-v2-kanban">
      {KANBAN_COLUMNS.map((column) => {
        const columnTasks = tasks.filter((t) => column.statuses.has(t.status));
        return (
          <div key={column.id} className={`tasks-v2-column tone-${column.tone}`}>
            <div className="tasks-v2-column-head">
              <span className="tasks-v2-column-dot" aria-hidden="true" />
              <h3>{column.title}</h3>
              <span className="tasks-v2-column-count">{columnTasks.length}</span>
            </div>
            <div className="tasks-v2-column-body">
              {columnTasks.length === 0 ? (
                <div className="tasks-v2-column-empty">Nothing here.</div>
              ) : (
                columnTasks.map((task) => {
                  const parent = task.parent_task_id
                    ? tasks.find((t) => t.id === task.parent_task_id)
                    : null;
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agentName={agentNameById(agents, task.agent_id)}
                      parentAgentName={parent ? agentNameById(agents, parent.agent_id) : null}
                      onClick={() => onOpen(task)}
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  agentName,
  parentAgentName,
  onClick
}: {
  task: TaskInfo;
  agentName: string;
  parentAgentName: string | null;
  onClick: () => void;
}) {
  const bucket = statusBucket(task.status);
  return (
    <article className={`tasks-v2-card tone-${bucket}`} onClick={onClick}>
      <h4 className="tasks-v2-card-title">{task.name}</h4>
      {parentAgentName && (
        <p className="tasks-v2-card-lineage">↳ from {parentAgentName}</p>
      )}
      <p className="tasks-v2-card-summary">{summarizeTaskNote(task)}</p>
      <div className="tasks-v2-card-foot">
        <div className="tasks-v2-card-assignee">
          <span className="tasks-v2-avatar" aria-hidden="true">
            {agentName.charAt(0).toUpperCase()}
          </span>
          <span>{agentName}</span>
        </div>
        <span className="tasks-v2-card-time">{formatShortTime(task.created_at)}</span>
      </div>
      <span className={`tasks-v2-status-pill tone-${bucket}`}>{formatStatusLabel(task.status)}</span>
    </article>
  );
}

function CreateTaskModal({
  agents,
  agentId,
  setAgentId,
  newMessage,
  setNewMessage,
  newPriority,
  setNewPriority,
  saving,
  onCancel,
  onCreate
}: {
  agents: AgentInfo[];
  agentId: string;
  setAgentId: (s: string) => void;
  newMessage: string;
  setNewMessage: (s: string) => void;
  newPriority: number;
  setNewPriority: (n: number) => void;
  saving: boolean;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="detail-modal-overlay" onClick={() => !saving && onCancel()}>
      <div className="detail-modal-card tasks-v2-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-modal-head">
          <div className="detail-modal-head-left">
            <span className="detail-modal-icon"><Plus size={15} /></span>
            <div>
              <p className="detail-modal-eyebrow">Create task</p>
              <h2>New mission</h2>
            </div>
          </div>
          <button className="detail-modal-close" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="detail-modal-body tasks-v2-modal-body">
          <label className="tasks-v2-field">
            <span className="tasks-v2-field-label">Assign to</span>
            <select
              className="tasks-v2-field-input"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={saving}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
          </label>

          <label className="tasks-v2-field">
            <span className="tasks-v2-field-label">Task instructions</span>
            <textarea
              className="tasks-v2-field-textarea"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Describe the task…"
              disabled={saving}
            />
          </label>

          <label className="tasks-v2-field">
            <span className="tasks-v2-field-label">Priority</span>
            <select
              className="tasks-v2-field-input"
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value) || 3)}
              disabled={saving}
            >
              <option value={5}>5 (highest)</option>
              <option value={4}>4</option>
              <option value={3}>3 (normal)</option>
              <option value={2}>2</option>
              <option value={1}>1 (lowest)</option>
            </select>
          </label>
        </div>

        <footer className="detail-modal-footer">
          <button className="button button-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="button button-primary"
            onClick={onCreate}
            disabled={saving || !newMessage.trim()}
          >
            {saving ? "Creating…" : "Create task"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TaskDetailsModal({
  task,
  agents,
  allTasks,
  actionLoading,
  actionError,
  actionNote,
  setActionNote,
  onClose,
  onAction,
  onOpenTask
}: {
  task: TaskInfo;
  agents: AgentInfo[];
  allTasks: TaskInfo[];
  actionLoading: boolean;
  actionError: string;
  actionNote: string;
  setActionNote: (s: string) => void;
  onClose: () => void;
  onAction: (action: string) => void;
  onOpenTask: (task: TaskInfo) => void;
}) {
  const childTasks = useMemo(
    () => allTasks.filter((t) => t.parent_task_id === task.id),
    [allTasks, task.id]
  );
  const parentTask = useMemo(
    () => (task.parent_task_id ? allTasks.find((t) => t.id === task.parent_task_id) || null : null),
    [allTasks, task.parent_task_id]
  );
  const bucket = statusBucket(task.status);
  const showActions =
    task.status === "blocked" ||
    task.status === "awaiting_connection" ||
    task.status === "awaiting_approval" ||
    task.status === "failed";

  const actionPlaceholder =
    task.status === "awaiting_approval"
      ? "Optional context for the approving agent."
      : task.status === "awaiting_connection"
        ? "Optional update for the next run."
        : task.status === "blocked"
          ? "Describe what changed so the task can move again."
          : task.status === "failed"
            ? "Optional guidance for the retry."
            : "Optional operator note.";

  const retryLabel =
    task.status === "blocked"
      ? "Resolve and retry"
      : task.status === "awaiting_connection"
        ? "Retry after connect"
        : task.status === "failed"
          ? "Retry with guidance"
          : "Retry task";

  const blockedRetryNeedsInput = task.status === "blocked" && !actionNote.trim();
  const comments = task.narrative || [];
  const agentName = agentNameById(agents, task.agent_id);

  return (
    <div className="detail-modal-overlay" onClick={() => !actionLoading && onClose()}>
      <div className="detail-modal-card detail-modal-large tasks-v2-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-modal-head">
          <div className="detail-modal-head-left">
            <span className="detail-modal-icon"><FileText size={15} /></span>
            <div>
              <p className="detail-modal-eyebrow">Task details</p>
              <h2>{task.name}</h2>
            </div>
          </div>
          <button className="detail-modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="detail-modal-body tasks-v2-details-body">
          {parentTask && (
            <button
              type="button"
              className="tasks-v2-breadcrumb"
              onClick={() => onOpenTask(parentTask)}
            >
              ← Back to parent: {agentNameById(agents, parentTask.agent_id)} — {parentTask.name.slice(0, 60)}
            </button>
          )}

          <section className="tasks-v2-request">
            <span className="eyebrow">Request</span>
            <p>{task.message || "—"}</p>
          </section>

          <section className="tasks-v2-meta-grid">
            <div className="tasks-v2-meta">
              <span className="eyebrow">Status</span>
              <span className={`tasks-v2-status-pill tone-${bucket}`}>{formatStatusLabel(task.status)}</span>
            </div>
            <div className="tasks-v2-meta">
              <span className="eyebrow">Assigned to</span>
              <strong>{agentName}</strong>
            </div>
            <div className="tasks-v2-meta">
              <span className="eyebrow">Priority</span>
              <strong>P{task.priority}</strong>
            </div>
            <div className="tasks-v2-meta">
              <span className="eyebrow">Last updated</span>
              <strong>{formatDetailTimestamp(task.updated_at)}</strong>
            </div>
          </section>

          {childTasks.length > 0 && (
            <section className="tasks-v2-subtasks">
              <span className="eyebrow">Delegated sub-tasks ({childTasks.length})</span>
              <div className="tasks-v2-subtasks-list">
                {childTasks.map((child) => {
                  const childBucket = statusBucket(child.status);
                  return (
                    <button
                      type="button"
                      key={child.id}
                      className={`tasks-v2-subtask tone-${childBucket}`}
                      onClick={() => onOpenTask(child)}
                    >
                      <span className={`tasks-v2-status-pill tone-${childBucket}`}>
                        {formatStatusLabel(child.status)}
                      </span>
                      <span className="tasks-v2-subtask-agent">
                        {agentNameById(agents, child.agent_id)}
                      </span>
                      <span className="tasks-v2-subtask-name">{child.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {task.result && (
            <section className="tasks-v2-request">
              <span className="eyebrow">Result</span>
              <p style={{ whiteSpace: "pre-wrap" }}>{task.result}</p>
            </section>
          )}

          {showActions && (
            <section className="tasks-v2-action-box">
              <header>
                <AlertTriangle size={14} />
                <strong>Action required</strong>
              </header>
              <p>
                {task.status === "awaiting_approval" && "This task is waiting on your approval to proceed."}
                {task.status === "awaiting_connection" &&
                  `${task.needs_connector ? `${task.needs_connector} isn't connected.` : "A required connector isn't connected."} Retry after connecting it.`}
                {task.status === "blocked" &&
                  (task.blocked_reason || "The agent hit a blocker. Provide resolution guidance and retry.")}
                {task.status === "failed" && "The last run failed. Provide guidance for the retry."}
              </p>
              <textarea
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder={actionPlaceholder}
                disabled={actionLoading}
              />
              {actionError && <div className="tasks-v2-error">{actionError}</div>}
              <div className="tasks-v2-action-buttons">
                {task.status === "awaiting_approval" ? (
                  <>
                    <button
                      className="button button-primary compact"
                      disabled={actionLoading}
                      onClick={() => onAction("approve")}
                    >Approve</button>
                    <button
                      className="button button-ghost compact"
                      disabled={actionLoading}
                      onClick={() => onAction("reject")}
                    >Reject</button>
                  </>
                ) : (
                  <button
                    className="button button-primary compact"
                    disabled={actionLoading || blockedRetryNeedsInput}
                    onClick={() => onAction("retry")}
                  >
                    {retryLabel}
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="tasks-v2-narrative">
            <span className="eyebrow">Agent narrative</span>
            {comments.length === 0 ? (
              <div className="tasks-v2-narrative-empty">
                <MessageSquare size={22} aria-hidden="true" />
                <p>{task.status === "pending" ? "Waiting for the runner to start this task." : "No narrative logs yet."}</p>
              </div>
            ) : (
              <div className="tasks-v2-narrative-list">
                {comments.map((c, idx) => {
                  const kind = c.kind || "worker";
                  const agentId = c.agentId || "agent";
                  return (
                    <div key={idx} className={`tasks-v2-comment kind-${kind}`}>
                      <header>
                        <span className="tasks-v2-avatar small" aria-hidden="true">
                          {agentId.charAt(0).toUpperCase()}
                        </span>
                        <strong>{agentId}</strong>
                        <span className="tasks-v2-comment-kind">{kind}</span>
                        <span className="tasks-v2-comment-time">{formatDetailTimestamp(c.ts)}</span>
                      </header>
                      <p>{c.text || ""}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <footer className="detail-modal-footer">
          <button className="button button-ghost" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

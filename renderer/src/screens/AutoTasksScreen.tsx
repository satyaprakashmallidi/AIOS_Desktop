import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderOpen,
  Loader2,
  Plus,
  Power,
  Trash2,
  Zap
} from "lucide-react";
import { invoke } from "../lib/api";
import { formatRelativeTime } from "../lib/workspace-view";
import { EmptyState, ConfirmModal } from "../components/ui";
import type { AutoTask } from "../types";

const SCHEDULE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "every-15min", label: "Every 15 minutes" },
  { value: "every-hour", label: "Every hour" },
  { value: "every-6h", label: "Every 6 hours" },
  { value: "daily-7am", label: "Daily at 7:00 AM" },
  { value: "daily-9am", label: "Daily at 9:00 AM" },
  { value: "weekly-mon-9am", label: "Mondays at 9:00 AM" }
];

export function AutoTasksScreen() {
  const [tasks, setTasks] = useState<AutoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState<string>("daily-9am");
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await invoke<{ tasks: AutoTask[] }>("list_auto_tasks");
      setTasks(result?.tasks ?? []);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refresh();
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  function flash(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 1800);
  }

  async function createTask() {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      await invoke("create_auto_task", {
        name: name.trim() || "Untitled task",
        prompt: prompt.trim(),
        schedule
      });
      setName("");
      setPrompt("");
      setSchedule("daily-9am");
      setShowForm(false);
      await refresh();
      flash("Auto-task created");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: AutoTask) {
    setBusy(true);
    try {
      await invoke("toggle_auto_task", { id: task.id, enabled: !task.enabled });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const [confirmDeleteTask, setConfirmDeleteTask] = useState<AutoTask | null>(null);
  function deleteTask(task: AutoTask) {
    setConfirmDeleteTask(task);
  }
  async function handleConfirmDeleteTask() {
    const task = confirmDeleteTask;
    if (!task) return;
    setConfirmDeleteTask(null);
    setBusy(true);
    try {
      await invoke("delete_auto_task", { id: task.id });
      await refresh();
      flash("Deleted");
    } finally {
      setBusy(false);
    }
  }

  async function runNow(task: AutoTask) {
    setBusy(true);
    try {
      await invoke("run_auto_task_now", { taskId: task.id });
      flash(`Running "${task.name}"…`);
      window.setTimeout(refresh, 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auto-tasks-screen">
      <div className="auto-tasks-shell">
        <header className="auto-tasks-hero">
          <div className="auto-tasks-hero-text">
            <p className="layer-badge"><span className="layer-dot" aria-hidden="true" />Layer · Auto Tasks</p>
            <h1>Recurring <em>Claude prompts</em></h1>
            <p className="auto-tasks-hero-detail">
              Schedule a prompt and let Claude run it on a cadence — daily briefs, hourly inbox sweeps, weekly reviews.
              Results land in <code>outputs/auto-tasks/</code>.
            </p>
            <p className="auto-tasks-hero-note">
              <AlertTriangle size={12} />
              Tasks run while AIOS Desktop is open. For overnight runs, use OS-level Task Scheduler.
            </p>
          </div>
          <button
            type="button"
            className="button button-primary compact"
            onClick={() => setShowForm((s) => !s)}
            disabled={busy}
          >
            <Plus size={13} />
            {showForm ? "Cancel" : "New auto-task"}
          </button>
        </header>

        {showForm ? (
          <div className="auto-task-form">
            <div className="auto-task-form-row">
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Daily standup brief"
                />
              </label>
              <label>
                <span>Schedule</span>
                <select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
                  {SCHEDULE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="auto-task-form-prompt">
              <span>Prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Tell Claude what to do each run. e.g. /prime then summarize yesterday's outputs into 3 bullets."
                rows={4}
              />
            </label>
            <div className="auto-task-form-actions">
              <button
                type="button"
                className="button button-primary compact"
                onClick={createTask}
                disabled={busy || !prompt.trim()}
              >
                {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                Create
              </button>
            </div>
          </div>
        ) : null}

        <div className="auto-tasks-list">
          {loading ? (
            <div className="plan-card-loading">
              <Loader2 size={14} className="spin" />
              Loading…
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              title="No auto-tasks yet"
              body="Click ‘New auto-task’ to schedule your first recurring Claude prompt."
            />
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onRunNow={() => runNow(task)}
                onToggle={() => toggleTask(task)}
                onDelete={() => deleteTask(task)}
                busy={busy}
              />
            ))
          )}
        </div>
      </div>
      {status ? <div className="auto-tasks-toast">{status}</div> : null}

      <ConfirmModal
        open={!!confirmDeleteTask}
        title="Delete auto-task?"
        message={confirmDeleteTask ? `Delete auto-task "${confirmDeleteTask.name}"? This can't be undone.` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={handleConfirmDeleteTask}
        onCancel={() => setConfirmDeleteTask(null)}
      />
    </section>
  );
}

function TaskCard({
  task,
  onRunNow,
  onToggle,
  onDelete,
  busy
}: {
  task: AutoTask;
  onRunNow: () => void;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [showRuns, setShowRuns] = useState(false);
  const lastRun = task.recentRuns[0];

  return (
    <article className={`auto-task-card ${task.enabled ? "" : "disabled"}`}>
      <div className="auto-task-card-head">
        <div className="auto-task-card-title">
          <span className="auto-task-card-icon"><Clock size={14} /></span>
          <div>
            <strong>{task.name}</strong>
            <div className="auto-task-card-meta">
              <span>{task.scheduleLabel}</span>
              {task.nextRun ? (
                <>
                  <span>·</span>
                  <span>next {formatRelativeTime(task.nextRun)}</span>
                </>
              ) : null}
              {lastRun ? (
                <>
                  <span>·</span>
                  <span className={`auto-task-status ${lastRun.status}`}>
                    {lastRun.status === "success" ? <CheckCircle2 size={11} /> : lastRun.status === "failed" ? <AlertTriangle size={11} /> : <Loader2 size={11} className="spin" />}
                    last {lastRun.status}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="auto-task-card-actions">
          <button
            type="button"
            className="button button-ghost compact"
            onClick={onRunNow}
            disabled={busy}
            title="Run this task now"
          >
            <Zap size={13} />
            Run now
          </button>
          <button
            type="button"
            className={`auto-task-toggle ${task.enabled ? "on" : "off"}`}
            onClick={onToggle}
            disabled={busy}
            title={task.enabled ? "Disable" : "Enable"}
          >
            <Power size={13} />
            {task.enabled ? "On" : "Off"}
          </button>
          <button
            type="button"
            className="output-icon-btn danger"
            onClick={onDelete}
            disabled={busy}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <p className="auto-task-card-prompt">{task.prompt}</p>

      <button
        type="button"
        className="auto-task-runs-toggle"
        onClick={() => setShowRuns((s) => !s)}
      >
        {showRuns ? "Hide" : "Show"} recent runs ({task.recentRuns.length})
      </button>

      {showRuns && task.recentRuns.length > 0 ? (
        <div className="auto-task-runs">
          {task.recentRuns.map((run) => (
            <div key={run.id} className={`auto-task-run ${run.status}`}>
              <span className="auto-task-run-status">
                {run.status === "success" ? <CheckCircle2 size={12} /> : run.status === "failed" ? <AlertTriangle size={12} /> : <Loader2 size={12} className="spin" />}
                {run.status}
              </span>
              <span className="auto-task-run-time">{formatRelativeTime(run.startedAt)}</span>
              {run.costUsd != null ? <span>· ${run.costUsd.toFixed(3)}</span> : null}
              {run.outputPath ? (
                <button
                  type="button"
                  className="auto-task-run-link"
                  onClick={() => invoke("reveal_in_file_manager", { path: run.outputPath! })}
                  title={run.outputPath}
                >
                  <FolderOpen size={11} />
                  Open
                </button>
              ) : null}
              {run.error ? <span className="auto-task-run-error">· {run.error}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

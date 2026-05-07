import path from "node:path";
import type { PythonHost } from "./python-host";
import { log } from "./logger";

interface AutoTask {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  nextRun: string | null;
}

interface RunRecord {
  id: number;
  taskId: number;
  startedAt: string;
}

interface RunTaskResult {
  response?: string;
  sessionId?: string;
  durationMs?: number;
  costUsd?: number;
}

interface WriteFileResult {
  path: string;
  bytes: number;
}

const TICK_MS = 60_000;

function safeFileSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "task";
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export class AutoTaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<number>();

  constructor(private readonly host: PythonHost) {}

  start(): void {
    if (this.timer) return;
    log("scheduler", "started", { tickMs: TICK_MS });
    this.tick().catch(() => undefined);
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        log("scheduler", "tick failed", { error: err instanceof Error ? err.message : String(err) })
      );
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(taskId: number): Promise<void> {
    const tasks = await this.host.invoke<{ tasks: AutoTask[] }>("list_auto_tasks");
    const task = tasks.ok ? tasks.data?.tasks?.find((t) => t.id === taskId) : null;
    if (task) {
      await this.executeTask(task);
    }
  }

  private async tick(): Promise<void> {
    const due = await this.host.invoke<{ tasks: AutoTask[] }>("list_due_auto_tasks");
    if (!due.ok || !due.data?.tasks?.length) return;
    for (const task of due.data.tasks) {
      if (this.running.has(task.id)) continue;
      this.executeTask(task).catch((err) =>
        log("scheduler", "task failed", { id: task.id, error: err instanceof Error ? err.message : String(err) })
      );
    }
  }

  private async executeTask(task: AutoTask): Promise<void> {
    if (this.running.has(task.id)) return;
    this.running.add(task.id);
    log("scheduler", "running task", { id: task.id, name: task.name });

    const beginResp = await this.host.invoke<RunRecord>("begin_auto_task_run", { taskId: task.id });
    if (!beginResp.ok || !beginResp.data) {
      this.running.delete(task.id);
      return;
    }
    const runId = beginResp.data.id;

    try {
      const runResp = await this.host.invoke<RunTaskResult>("run_task", { prompt: task.prompt }, 700_000);
      if (!runResp.ok) {
        await this.host.invoke("finish_auto_task_run", {
          runId,
          status: "failed",
          error: runResp.error?.message ?? "Unknown error"
        });
      } else {
        const response = runResp.data?.response ?? "";
        const slug = safeFileSlug(task.name);
        const stamp = nowStamp();
        const outputPath = path.posix.join("outputs", "auto-tasks", `${slug}-${stamp}.md`);
        const body = `# ${task.name}\n\n*Auto-task run · ${new Date().toISOString()}*\n\n---\n\n${response}\n`;

        const writeResp = await this.host.invoke<WriteFileResult>("write_file", {
          path: outputPath,
          content: body
        });
        const finalPath = writeResp.ok && writeResp.data ? writeResp.data.path : null;

        await this.host.invoke("finish_auto_task_run", {
          runId,
          status: "success",
          outputPath: finalPath,
          costUsd: runResp.data?.costUsd ?? null
        });
      }
    } catch (error) {
      await this.host.invoke("finish_auto_task_run", {
        runId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await this.host.invoke("advance_auto_task", { taskId: task.id });
      this.running.delete(task.id);
      this.host.emitEvent({ id: `auto-task-${task.id}-${Date.now()}`, event: "auto_task_complete", data: { taskId: task.id } });
    }
  }
}

// Goal orchestrator — implements `/goal <condition>` in chat. Mirrors
// Claude Code v2.1.139's /goal command: Claude takes multiple turns toward
// a verifiable condition, an evaluator (Haiku) checks after each turn
// whether the condition is met, and the loop continues until met / aborted /
// cap exceeded.
//
// Loop shape:
//   1. Fire `run_task` for the work turn (Auto mode, current session).
//   2. Fire `run_task` for the verifier turn (Haiku, no session — fresh
//      eval each time). Verifier responds with [GOAL_MET] or
//      [GOAL_NOT_MET: <reason>].
//   3. Update banner state + persist goal_state on the session.
//   4. If met → publish "met" state, exit OK.
//   5. If not met + caps not exceeded → loop.
//   6. If caps exceeded → publish "exhausted" state, exit.
//   7. If user aborts → publish "aborted" state, exit.

import { randomUUID } from "node:crypto";
import type { PythonHost } from "./python-host";
import { log } from "./logger";

export interface GoalProgress {
  sessionId: string;
  condition: string;
  turn: number;
  maxTurns: number;
  tokensSpent: number;
  costUsd: number;
  startedAt: string;
  lastReason?: string;
  status: "active" | "met" | "aborted" | "exhausted";
}

export interface GoalTurnArtifact {
  kind: "plan" | "output";
  path: string;
  filename: string;
}

export interface GoalTurnMessage {
  sessionId: string;
  turn: number;
  role: "assistant";
  content: string;
  artifacts: GoalTurnArtifact[];
  verifierReason?: string;
}

export type GoalEventBroadcast = (event:
  | { event: "goal_progress"; data: GoalProgress }
  | { event: "goal_turn_message"; data: GoalTurnMessage }
) => void;

const DEFAULT_MAX_TURNS = 30;
const ABSOLUTE_MAX_TURNS = 60;
const MAX_TOKENS = 200_000;
const MAX_WALL_MS = 60 * 60 * 1000; // 1 hour
const VERIFIER_MODEL = "haiku";

// One orchestrator per session id. Lets multiple chats run their own goals
// concurrently without stepping on each other.
interface ActiveGoalRun {
  sessionId: string;
  runId: string;
  abort: AbortController;
  promise: Promise<void>;
}
const activeRuns = new Map<string, ActiveGoalRun>();

export function isGoalRunning(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

export function getActiveGoalSessions(): string[] {
  return Array.from(activeRuns.keys());
}

export async function abortGoalLoop(sessionId: string, broadcast?: GoalEventBroadcast | null): Promise<void> {
  const run = activeRuns.get(sessionId);
  if (!run) return;
  run.abort.abort();
  try {
    await run.promise;
  } catch {
    /* swallow */
  }
  activeRuns.delete(sessionId);
  // Note: the loop itself publishes the "aborted" state once the abort
  // signal fires. Don't double-publish here.
}

export interface StartGoalLoopArgs {
  sessionId: string;
  condition: string;
  claudePath: string;
  host: PythonHost;
  broadcast: GoalEventBroadcast;
  // Optional: when resuming after restart, start the turn counter at this
  // value instead of 0.
  resumeFromTurn?: number;
  // Optional: existing claudeSessionId to pass to --resume so Claude has
  // prior conversation context.
  claudeSessionId?: string | null;
}

export async function startGoalLoop({
  sessionId,
  condition,
  claudePath,
  host,
  broadcast,
  resumeFromTurn = 0,
  claudeSessionId = null,
}: StartGoalLoopArgs): Promise<{ ok: boolean; reason?: string }> {
  if (!sessionId) return { ok: false, reason: "missing_session_id" };
  const trimmed = condition.trim();
  if (!trimmed) return { ok: false, reason: "empty_condition" };
  if (!claudePath) return { ok: false, reason: "claude_not_configured" };

  // If a goal is already running on this session, abort it first.
  if (activeRuns.has(sessionId)) {
    await abortGoalLoop(sessionId, broadcast);
  }

  const runId = randomUUID();
  const abort = new AbortController();
  const promise = runLoop({
    sessionId,
    condition: trimmed,
    claudePath,
    host,
    broadcast,
    signal: abort.signal,
    runId,
    resumeFromTurn,
    claudeSessionId,
  });

  activeRuns.set(sessionId, { sessionId, runId, abort, promise });

  try {
    await promise;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    const current = activeRuns.get(sessionId);
    if (current?.runId === runId) {
      activeRuns.delete(sessionId);
    }
  }
}

async function runLoop({
  sessionId,
  condition,
  claudePath,
  host,
  broadcast,
  signal,
  runId,
  resumeFromTurn,
  claudeSessionId,
}: {
  sessionId: string;
  condition: string;
  claudePath: string;
  host: PythonHost;
  broadcast: GoalEventBroadcast;
  signal: AbortSignal;
  runId: string;
  resumeFromTurn: number;
  claudeSessionId: string | null;
}): Promise<void> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let turn = resumeFromTurn;
  let tokensSpent = 0;
  let costUsd = 0;
  let lastReason: string | undefined = undefined;
  let runningClaudeSessionId = claudeSessionId;
  // Fingerprint last assistant reply for stuck-loop detection. If Claude
  // produces the same reply twice in a row, the verifier will keep saying
  // NOT_MET and we'll spin forever. Abort with "stuck" status.
  let lastReplyFingerprint: string | null = null;
  let consecutiveSameReply = 0;

  const publish = (status: "active" | "met" | "aborted" | "exhausted", reason?: string) => {
    if (activeRuns.get(sessionId)?.runId !== runId) return; // stale
    const payload: GoalProgress = {
      sessionId,
      condition,
      turn,
      maxTurns: DEFAULT_MAX_TURNS,
      tokensSpent,
      costUsd,
      startedAt,
      lastReason: reason ?? lastReason,
      status,
    };
    try {
      broadcast({ event: "goal_progress", data: payload });
    } catch {
      /* renderer might be reloading */
    }
    // Persist snapshot to SQLite so the banner survives an app restart.
    // Fire-and-forget; persistence failures shouldn't break the loop.
    void persistGoalState(host, sessionId, payload).catch(() => undefined);
  };

  // Initial state — surfaces the banner immediately.
  publish("active", "Starting goal…");

  while (true) {
    if (signal.aborted) {
      publish("aborted", "Stopped by user.");
      return;
    }
    if (turn >= DEFAULT_MAX_TURNS) {
      publish("exhausted", `Reached turn cap (${DEFAULT_MAX_TURNS}).`);
      return;
    }
    if (tokensSpent >= MAX_TOKENS) {
      publish("exhausted", `Reached token cap (${MAX_TOKENS.toLocaleString()}).`);
      return;
    }
    if (Date.now() - startMs >= MAX_WALL_MS) {
      publish("exhausted", "Reached 1-hour wall-clock cap.");
      return;
    }

    turn += 1;

    // Build the prompt for this turn. On turn 1, it's the user's original
    // condition + an instruction to start working. On later turns, it's a
    // nudge prompt that incorporates the verifier's last "why not met" reason.
    const workPrompt = buildWorkPrompt(condition, turn, lastReason);
    publish("active", `Turn ${turn} — working…`);

    let workResponse = "";
    try {
      const args: Record<string, unknown> = {
        prompt: workPrompt,
        claudePath,
        permissionMode: "bypassPermissions",
      };
      if (runningClaudeSessionId) args.sessionId = runningClaudeSessionId;
      const result = (await host.invoke("run_task", args)) as any;
      const data = result?.data ?? result;
      workResponse = typeof data?.response === "string" ? data.response : "";
      if (typeof data?.sessionId === "string" && data.sessionId) {
        runningClaudeSessionId = data.sessionId;
      }
      if (typeof data?.costUsd === "number") {
        costUsd += data.costUsd;
        // Rough proxy: 1 USD ≈ ~67k input tokens at Sonnet rates.
        // Underestimates output tokens but good enough for a guardrail.
        tokensSpent += Math.round(data.costUsd * 67_000);
      }
    } catch (err) {
      log("goal-orchestrator", `work turn failed: ${err instanceof Error ? err.message : String(err)}`);
      publish("aborted", `Work turn failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (signal.aborted) {
      publish("aborted", "Stopped by user.");
      return;
    }

    // Stuck-loop detection: if Claude's reply is byte-identical to the last
    // turn's reply, the work isn't progressing. Three in a row = abort.
    const fingerprint = workResponse.slice(0, 400);
    if (fingerprint && fingerprint === lastReplyFingerprint) {
      consecutiveSameReply += 1;
      if (consecutiveSameReply >= 2) {
        publish("aborted", "Stuck — Claude produced the same reply twice. Refine your goal.");
        return;
      }
    } else {
      consecutiveSameReply = 0;
      lastReplyFingerprint = fingerprint;
    }

    // Verifier turn (Haiku). Fresh evaluation each turn — no claudeSessionId
    // so it can't be biased by prior verifier judgments.
    publish("active", `Turn ${turn} — checking goal…`);
    const verifyPrompt = buildVerifierPrompt(condition, workResponse);
    let verdict: { met: boolean; reason: string } = { met: false, reason: "verifier inconclusive" };
    try {
      const result = (await host.invoke("run_task", {
        prompt: verifyPrompt,
        claudePath,
        model: VERIFIER_MODEL,
        permissionMode: "bypassPermissions",
      })) as any;
      const data = result?.data ?? result;
      const reply = typeof data?.response === "string" ? data.response : "";
      verdict = parseVerdict(reply);
      if (typeof data?.costUsd === "number") {
        costUsd += data.costUsd;
        tokensSpent += Math.round(data.costUsd * 67_000);
      }
    } catch (err) {
      log("goal-orchestrator", `verifier failed: ${err instanceof Error ? err.message : String(err)}`);
      // If the verifier crashes, treat as not-met and continue (don't abort).
      verdict = { met: false, reason: "verifier crashed; continuing" };
    }

    lastReason = verdict.reason;

    // Surface the turn's actual work to the chat thread so the user sees
    // what Claude did — not just the abstract "Goal active" banner. Parse
    // out any AIOS_ARTIFACT / AIOS_EXPORT_PDF markers for clickable chips
    // and strip them from the displayed text.
    const artifacts = parseArtifacts(workResponse);
    const cleaned = workResponse
      .replace(/\[AIOS_ARTIFACT:[^\]\r\n]+\]/gi, "")
      .replace(/\[AIOS_EXPORT_PDF:[^\]\r\n]+\]/gi, "")
      .replace(/\[AIOS_ASK:[^\]\r\n]+\]/gi, "")
      .replace(/\[AIOS_CONNECT:[^\]\r\n]+\]/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cleaned) {
      try {
        broadcast({
          event: "goal_turn_message",
          data: {
            sessionId,
            turn,
            role: "assistant",
            content: cleaned,
            artifacts,
            verifierReason: verdict.met ? undefined : verdict.reason,
          },
        });
      } catch {
        /* renderer might be reloading */
      }
    }

    if (verdict.met) {
      publish("met", verdict.reason || "Goal achieved.");
      return;
    }

    // Not met → loop. publishState already happened above with active.
    // Brief settle before the next turn to give any disk writes time.
    await sleep(120);
  }
}

function parseArtifacts(response: string): GoalTurnArtifact[] {
  const out: GoalTurnArtifact[] = [];
  const artifactRe = /\[AIOS_ARTIFACT:\s*((?:plans|outputs)\/[A-Za-z0-9._\/-]+\.[A-Za-z0-9]+)\s*\]/gi;
  let m: RegExpExecArray | null;
  while ((m = artifactRe.exec(response)) !== null) {
    const path = m[1];
    const filename = path.split("/").pop() ?? path;
    const kind: "plan" | "output" = path.startsWith("plans/") ? "plan" : "output";
    out.push({ kind, path, filename });
  }
  return out;
}

function buildWorkPrompt(condition: string, turn: number, lastReason: string | undefined): string {
  if (turn === 1) {
    return (
      `You are working toward this verifiable goal:\n\n` +
      `**Goal:** ${condition}\n\n` +
      `Start working immediately. Use any tools you need (edits, reads, ` +
      `shell commands). After this turn an evaluator will check whether ` +
      `the goal is met. Keep going until it is. Be concrete and concise ` +
      `in your reply — describe what you did this turn.`
    );
  }
  const nudge = lastReason
    ? `\n\n**Evaluator's latest note (why the goal isn't met yet):** ${lastReason}\n\n` +
      `Address this specifically in your next step.`
    : "";
  return (
    `You are still working toward this goal:\n\n` +
    `**Goal:** ${condition}\n\n` +
    `This is turn ${turn}. Continue making progress toward the goal.${nudge}\n\n` +
    `Describe what you do this turn briefly.`
  );
}

function buildVerifierPrompt(condition: string, lastTurnReply: string): string {
  // Truncate the work reply to keep verifier cost low; the first ~3000 chars
  // are usually enough to judge progress.
  const tail = lastTurnReply.length > 3000 ? lastTurnReply.slice(-3000) : lastTurnReply;
  return (
    `You are an evaluator. The user set this goal for an autonomous agent:\n\n` +
    `**Goal:** ${condition}\n\n` +
    `Here's what the agent reported doing in its latest turn:\n\n` +
    `<turn-output>\n${tail}\n</turn-output>\n\n` +
    `Is the goal fully met? Reply with EXACTLY one of these two markers on ` +
    `the LAST line of your response:\n` +
    `- \`[GOAL_MET]\` if the condition is fully satisfied\n` +
    `- \`[GOAL_NOT_MET: <one-sentence reason>]\` if it isn't yet, with a ` +
    `specific, actionable reason the agent can use to make progress next ` +
    `turn (e.g., "still 2 TypeScript errors in src/auth.ts" not "needs more work")\n\n` +
    `Be strict — only return GOAL_MET if the condition is verifiably done.`
  );
}

function parseVerdict(reply: string): { met: boolean; reason: string } {
  const metRe = /\[GOAL_MET\]/i;
  const notMetRe = /\[GOAL_NOT_MET:\s*([^\]\r\n]+)\]/i;
  if (metRe.test(reply)) {
    return { met: true, reason: "Goal achieved." };
  }
  const m = reply.match(notMetRe);
  if (m) {
    return { met: false, reason: m[1].trim().slice(0, 300) };
  }
  // No marker — treat as not-met but flag uncertainty.
  return { met: false, reason: "Evaluator response was ambiguous; continuing." };
}

async function persistGoalState(host: PythonHost, sessionId: string, payload: GoalProgress): Promise<void> {
  // Read-modify-write the session row: load current session, merge in the
  // new activeGoal snapshot, save. The python `save_session` IPC handles
  // the upsert.
  try {
    const result = (await host.invoke("get_sessions", {})) as any;
    const data = result?.data ?? result;
    const sessions = Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : [];
    const session = sessions.find((s: any) => s?.id === sessionId);
    if (!session) return;
    session.activeGoal = payload;
    await host.invoke("save_session", { session });
  } catch (err) {
    log("goal-orchestrator", `persistGoalState failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

"""Background task runner — spawns Claude Code per task using the assigned
agent's system prompt. Each task runs as an isolated subprocess; sub-agent
spawning is handled natively by Claude Code's built-in Task tool.

The runner starts N worker threads (default 2). Each worker:
  1. Atomically claims a pending task via tasks_store.claim_next_pending_task()
  2. Builds the Claude command (agent prompt + Composio MCP + bypass perms)
  3. Streams stream-json output, appends tool-use + assistant text to the
     task's narrative_json column, and pushes broadcast events so the
     renderer can refresh the Kanban in real time
  4. Parses sentinels in the final response:
       [BLOCKED: <reason>]            → status=blocked
       [NEEDS_CONNECTOR: <service>]   → status=awaiting_connection
       [SPAWN_AGENT: slug|name|role|prompt] → creates a custom agent
  5. Otherwise: status=completed, full final answer stored in result_json

Concurrency cap, by default 2 simultaneous task runs. Tune via the
"task_concurrency" setting in app_state (1-4 sensible range).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

import agents as agents_mod
import tasks_store
import workspace


_RUNNER_LOCK = threading.Lock()
_RUNNER_STARTED = False
_SHUTDOWN = threading.Event()

_DEFAULT_CONCURRENCY = 2

# Sentinels emitted by agents to coordinate with the runner.
_RE_BLOCKED = re.compile(r"\[BLOCKED:\s*(.+?)\]", re.IGNORECASE | re.DOTALL)
_RE_NEEDS_CONNECTOR = re.compile(r"\[NEEDS_CONNECTOR:\s*([^\]\n]+)\]", re.IGNORECASE)
_RE_SPAWN_AGENT = re.compile(r"\[SPAWN_AGENT:\s*(.+?)\]", re.IGNORECASE | re.DOTALL)
_RE_ASSIGN_TASK = re.compile(r"\[ASSIGN_TASK:\s*(.+?)\]", re.IGNORECASE | re.DOTALL)


_BroadcastFn = Callable[[str, dict[str, Any]], None]


def start_runner(broadcast: _BroadcastFn, concurrency: int | None = None) -> None:
    """Idempotent — calling repeatedly is a no-op after the first call.
    Pass the broadcast helper from host.py so the runner can push events."""
    global _RUNNER_STARTED
    with _RUNNER_LOCK:
        if _RUNNER_STARTED:
            return
        _RUNNER_STARTED = True

    # Recover orphans from a previous sidecar session — anything left at
    # in_progress when we boot is dead (its Claude subprocess died with the
    # old sidecar). Flip back to pending so we re-run it.
    try:
        recovered = tasks_store.reset_orphan_tasks()
        if recovered:
            print(f"[tasks_runner] recovered {recovered} orphan task(s)", file=sys.stderr, flush=True)
    except Exception as err:
        print(f"[tasks_runner] orphan recovery failed: {err}", file=sys.stderr, flush=True)

    workers = _resolve_concurrency(concurrency)
    for i in range(workers):
        t = threading.Thread(
            target=_worker_loop,
            name=f"aios-tasks-runner-{i}",
            args=(i, broadcast),
            daemon=True,
        )
        t.start()


def shutdown_runner() -> None:
    _SHUTDOWN.set()


def _resolve_concurrency(passed: int | None) -> int:
    if passed and passed > 0:
        return max(1, min(passed, 4))
    raw = workspace.get_setting("task_concurrency")
    if raw and raw.isdigit():
        return max(1, min(int(raw), 4))
    return _DEFAULT_CONCURRENCY


def _worker_loop(slot_id: int, broadcast: _BroadcastFn) -> None:
    """Long-running loop. Sleeps when the queue is empty."""
    while not _SHUTDOWN.is_set():
        try:
            task = tasks_store.claim_next_pending_task()
        except Exception as err:
            print(f"[tasks_runner.{slot_id}] claim error: {err}", file=sys.stderr, flush=True)
            time.sleep(5.0)
            continue

        if task is None:
            time.sleep(2.0)
            continue

        broadcast("task_update", {"taskId": task["id"], "status": "in_progress"})
        try:
            _run_one_task(task, broadcast)
        except Exception as err:
            print(f"[tasks_runner.{slot_id}] task {task.get('id')} error: {err}", file=sys.stderr, flush=True)
            try:
                tasks_store.update_task_status(task["id"], "failed", result=f"Runner error: {err}")
                broadcast("task_update", {"taskId": task["id"], "status": "failed"})
            except Exception:
                pass


def _run_one_task(task: dict[str, Any], broadcast: _BroadcastFn) -> None:
    task_id = task["id"]
    agent_id = task["agent_id"]

    # Resolve the agent. Custom agents may have been deleted between create
    # and run; if so, drop the task with a clear failure message.
    try:
        agent = agents_mod.get_agent(agent_id)
    except Exception:
        tasks_store.update_task_status(
            task_id,
            "failed",
            result=f"Assigned agent '{agent_id}' no longer exists. Reassign or recreate.",
        )
        broadcast("task_update", {"taskId": task_id, "status": "failed"})
        return

    claude_path = workspace.get_setting("claude_path")
    if not claude_path:
        tasks_store.update_task_status(
            task_id,
            "failed",
            result="Claude Code path isn't configured. Open Settings → Connect Claude Code.",
        )
        broadcast("task_update", {"taskId": task_id, "status": "failed"})
        return

    # Lazy-import the host helpers we need. Doing this at module load creates
    # a circular import (host.py imports tasks_runner). Inside the function
    # body the import resolves cleanly because host has finished loading by
    # the time a worker is processing a task.
    from host import (
        _COMPOSIO_SYSTEM_PROMPT,
        _mcp_isolation_flags,
        execution_env,
        text_from_stream_message,
        tool_results_from_stream_message,
        tool_uses_from_stream_message,
    )

    user_context = _read_user_context()
    department_catalog = _department_catalog() if agent_id == "ceo" else ""

    agent_prompt = (agent.get("custom_prompt") or agent["default_prompt"]) or ""
    agent_prompt = agent_prompt.replace("{USER_CONTEXT}", user_context)
    if department_catalog:
        agent_prompt = agent_prompt.replace("{DEPARTMENT_CATALOG}", department_catalog)

    # Synthesis pass: parent task whose delegated children have all finished.
    # Replace the task message with a synthesis brief that bundles every
    # child's status + final answer. The agent's job in this pass is to
    # produce one coherent reply tying the children's work together — not
    # to delegate further.
    is_synthesis_pass = bool(task.get("synthesis_pass"))
    task_message = task["message"]
    if is_synthesis_pass:
        task_message = _build_synthesis_message(task)

    mcp_flags = _mcp_isolation_flags()
    composio_hint = ["--append-system-prompt", _COMPOSIO_SYSTEM_PROMPT] if mcp_flags else []

    command = [
        claude_path,
        "--print",
        *mcp_flags,
        *composio_hint,
        "--append-system-prompt",
        agent_prompt,
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--permission-mode",
        "bypassPermissions",
        task_message,
    ]
    cwd = str(workspace.workspace_root())

    tasks_store.append_narrative_event(
        task_id,
        {
            "kind": "system",
            "role": "system",
            "agentId": agent["id"],
            "text": f"{agent['name']} started this task.",
        },
    )
    broadcast("task_narrative", {"taskId": task_id})

    # Isolate Claude from the parent sidecar's stdio pipes. On Windows,
    # spawning a child process from a background thread without isolation
    # can corrupt the parent's stdin handle (the IPC pipe from Electron),
    # causing `for line in sys.stdin` to hit EOF → main() returns → sidecar
    # exits cleanly with code 0. Electron then respawns the sidecar on
    # the next IPC call, producing an infinite restart loop.
    popen_kwargs: dict[str, Any] = dict(
        cwd=cwd,
        env=execution_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        close_fds=True,
    )
    if os.name == "nt":
        # CREATE_NEW_PROCESS_GROUP detaches Claude into its own process
        # group so Ctrl-C / signal handling can't propagate back to the
        # parent. CREATE_NO_WINDOW hides the console window that would
        # otherwise pop up alongside the GUI app.
        popen_kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        )
    else:
        popen_kwargs["start_new_session"] = True

    try:
        proc = subprocess.Popen(command, **popen_kwargs)
    except FileNotFoundError:
        tasks_store.update_task_status(
            task_id,
            "failed",
            result=f"Claude executable was not found at {claude_path}. Reconnect in Settings.",
        )
        broadcast("task_update", {"taskId": task_id, "status": "failed"})
        return

    final_text = ""
    session_id: str | None = None
    last_full_text = ""
    # Dedupe tool_use events by id — Claude's --include-partial-messages
    # emits the same assistant message multiple times as it grows, so the
    # same tool_use shows up repeatedly. Same for tool_results.
    seen_tool_uses: set[str] = set()
    seen_tool_results: set[str] = set()
    tool_use_index: dict[str, str] = {}  # id → display name (for result correlation)

    # Also capture any plain-text "thinking" the agent does mid-stream so the
    # narrative doesn't look frozen during a long subprocess run.
    last_thinking_emit = ""

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            ptype = payload.get("type")

            if ptype == "system" and payload.get("subtype") == "init":
                session_id = payload.get("session_id")

            elif ptype == "assistant":
                full_text = text_from_stream_message(payload)
                if full_text and full_text != last_full_text:
                    last_full_text = full_text
                    final_text = full_text
                    # Emit a "thinking" entry once per substantial growth so
                    # the user sees activity. We only emit the NEW portion to
                    # avoid duplicating already-shown text.
                    new_portion = full_text[len(last_thinking_emit):].strip()
                    if len(new_portion) >= 80:
                        excerpt = new_portion[:400]
                        tasks_store.append_narrative_event(
                            task_id,
                            {
                                "kind": "thinking",
                                "role": "assistant",
                                "agentId": agent["id"],
                                "text": excerpt,
                            },
                        )
                        last_thinking_emit = full_text
                        broadcast("task_narrative", {"taskId": task_id})

                for tool_use in tool_uses_from_stream_message(payload):
                    tu_id = tool_use.get("id") or ""
                    if not tu_id or tu_id in seen_tool_uses:
                        continue
                    seen_tool_uses.add(tu_id)
                    tool_name = (tool_use.get("name") or "tool").strip()
                    summary = (tool_use.get("summary") or "").strip()
                    tool_use_index[tu_id] = tool_name

                    if tool_name == "Task":
                        # Built-in sub-agent spawn. The "description" arg is
                        # the brief the parent gave the child.
                        text = f"Delegated to a sub-agent: {summary or '(no brief)'}"
                        kind = "delegate"
                    elif tool_name.startswith("mcp__composio__"):
                        # Composio MCP call — hide the prefix from the UI.
                        short = tool_name.replace("mcp__composio__", "")
                        text = f"Called {short}" + (f" — {summary}" if summary else "")
                        kind = "tool"
                    else:
                        text = f"Used {tool_name}" + (f" — {summary}" if summary else "")
                        kind = "tool"

                    tasks_store.append_narrative_event(
                        task_id,
                        {
                            "kind": kind,
                            "role": "assistant",
                            "agentId": agent["id"],
                            "text": text,
                        },
                    )
                    broadcast("task_narrative", {"taskId": task_id})

            elif ptype == "user":
                # tool_result messages — surface failures, mute successes
                # (a flood of "X succeeded" entries would drown the UI).
                for tr in tool_results_from_stream_message(payload):
                    tr_id = tr.get("toolUseId") or ""
                    if not tr_id or tr_id in seen_tool_results:
                        continue
                    seen_tool_results.add(tr_id)
                    if tr.get("isError"):
                        tool_name = tool_use_index.get(tr_id, "tool")
                        short_name = tool_name.replace("mcp__composio__", "")
                        tasks_store.append_narrative_event(
                            task_id,
                            {
                                "kind": "tool_error",
                                "role": "system",
                                "agentId": agent["id"],
                                "text": f"{short_name} failed — agent will likely retry or work around it.",
                            },
                        )
                        broadcast("task_narrative", {"taskId": task_id})

            elif ptype == "result":
                result_text = str(payload.get("result") or "").strip()
                if result_text:
                    final_text = result_text
    except Exception as err:
        try:
            proc.kill()
        except Exception:
            pass
        tasks_store.update_task_status(
            task_id,
            "failed",
            result=f"Stream parse error: {err}",
            claude_session_id=session_id,
        )
        broadcast("task_update", {"taskId": task_id, "status": "failed"})
        return

    return_code = proc.wait()
    stderr = proc.stderr.read().strip() if proc.stderr else ""

    final_text_clean = (final_text or "").strip()

    # Record the agent's final response as a worker narrative entry so users
    # see something in the timeline even if the final answer is short.
    if final_text_clean:
        tasks_store.append_narrative_event(
            task_id,
            {
                "kind": "worker",
                "role": "assistant",
                "agentId": agent["id"],
                "text": final_text_clean[:8000],
            },
        )

    # Handle [SPAWN_AGENT: ...] sentinels first so any custom agents are
    # created regardless of the task outcome (and immediately available for
    # any ASSIGN_TASK sentinel below that references them).
    for match in _RE_SPAWN_AGENT.finditer(final_text_clean):
        try:
            parts = [p.strip() for p in match.group(1).split("|", 3)]
            if len(parts) == 4:
                _, name, role, prompt = parts
                if name and prompt:
                    new_agent = agents_mod.create_custom_agent(
                        name=name,
                        role=role,
                        prompt=prompt,
                        parent_id=agent["id"],
                    )
                    tasks_store.append_narrative_event(
                        task_id,
                        {
                            "kind": "system",
                            "role": "system",
                            "agentId": agent["id"],
                            "text": f"Created new agent '{new_agent['name']}' to support future related work.",
                        },
                    )
                    broadcast("agents_changed", {})
        except Exception as err:
            print(f"[tasks_runner] SPAWN_AGENT failed: {err}", file=sys.stderr, flush=True)

    # Handle [ASSIGN_TASK: <slug> | <message>] sentinels. Each match creates
    # a real child task linked to this one via parent_task_id. If at least
    # one child is created AND this isn't already a synthesis pass, mark this
    # task as awaiting_children — the child-completion trigger will re-queue
    # it for a synthesis pass once all delegates finish.
    children_created = 0
    if not is_synthesis_pass:
        for match in _RE_ASSIGN_TASK.finditer(final_text_clean):
            try:
                parts = [p.strip() for p in match.group(1).split("|", 1)]
                if len(parts) != 2:
                    continue
                target_slug, sub_message = parts
                if not target_slug or not sub_message:
                    continue
                try:
                    target_agent = agents_mod.get_agent(target_slug)
                except Exception:
                    tasks_store.append_narrative_event(
                        task_id,
                        {
                            "kind": "tool_error",
                            "role": "system",
                            "agentId": agent["id"],
                            "text": f"Tried to delegate to '{target_slug}' but no such agent exists.",
                        },
                    )
                    continue
                child = tasks_store.create_task(
                    name=f"↳ {sub_message[:60]}",
                    message=sub_message,
                    agent_id=target_agent["id"],
                    priority=task.get("priority") or 3,
                    parent_task_id=task_id,
                )
                tasks_store.append_narrative_event(
                    task_id,
                    {
                        "kind": "assignment",
                        "role": "assistant",
                        "agentId": agent["id"],
                        "text": f"Delegated to {target_agent['name']}: {sub_message[:180]}",
                    },
                )
                children_created += 1
                broadcast("task_update", {"taskId": child["id"], "status": "pending"})
            except Exception as err:
                print(f"[tasks_runner] ASSIGN_TASK failed: {err}", file=sys.stderr, flush=True)

    if children_created > 0:
        # Parent is now waiting on its children. Don't mark completed — the
        # synthesis pass will re-spawn the parent once all children finish.
        tasks_store.update_task_status(
            task_id,
            "awaiting_children",
            result=final_text_clean,
            claude_session_id=session_id,
        )
        broadcast("task_update", {"taskId": task_id, "status": "awaiting_children"})
        return

    needs_match = _RE_NEEDS_CONNECTOR.search(final_text_clean)
    blocked_match = _RE_BLOCKED.search(final_text_clean)

    if needs_match:
        tasks_store.update_task_status(
            task_id,
            "awaiting_connection",
            needs_connector=needs_match.group(1).strip(),
            result=final_text_clean,
            claude_session_id=session_id,
        )
        broadcast("task_update", {"taskId": task_id, "status": "awaiting_connection"})
        _maybe_trigger_parent(task_id, broadcast)
        return

    if blocked_match:
        tasks_store.update_task_status(
            task_id,
            "blocked",
            blocked_reason=blocked_match.group(1).strip(),
            result=final_text_clean,
            claude_session_id=session_id,
        )
        broadcast("task_update", {"taskId": task_id, "status": "blocked"})
        _maybe_trigger_parent(task_id, broadcast)
        return

    if return_code == 0:
        tasks_store.update_task_status(
            task_id,
            "completed",
            result=final_text_clean,
            claude_session_id=session_id,
        )
        broadcast("task_update", {"taskId": task_id, "status": "completed"})
        _maybe_trigger_parent(task_id, broadcast)
        return

    tasks_store.update_task_status(
        task_id,
        "failed",
        result=stderr or final_text_clean or f"Claude exited with status {return_code}.",
        claude_session_id=session_id,
    )
    broadcast("task_update", {"taskId": task_id, "status": "failed"})
    _maybe_trigger_parent(task_id, broadcast)


def _maybe_trigger_parent(child_task_id: str, broadcast: _BroadcastFn) -> None:
    """Called after a terminal status update. If the task has a parent in
    awaiting_children and all siblings are terminal, re-queue the parent for
    its synthesis pass."""
    try:
        triggered = tasks_store.maybe_trigger_parent_synthesis(child_task_id)
        if triggered:
            child = tasks_store.get_task(child_task_id)
            if child and child.get("parent_task_id"):
                broadcast("task_update", {"taskId": child["parent_task_id"], "status": "pending"})
    except Exception as err:
        print(f"[tasks_runner] parent-synthesis trigger failed: {err}", file=sys.stderr, flush=True)


def _build_synthesis_message(parent_task: dict[str, Any]) -> str:
    """Construct the synthesis-pass message. The parent agent receives the
    original brief plus each child's name + status + final answer."""
    children = tasks_store.list_child_tasks(parent_task["id"])
    parts: list[str] = []
    parts.append(
        "SYNTHESIS PASS\n\n"
        "You previously delegated this work to one or more specialists. "
        "They are now all finished. Below is the original request followed "
        "by each child's outcome. Produce ONE coherent reply for the user "
        "that ties their work together. Do NOT emit any [ASSIGN_TASK:], "
        "[SPAWN_AGENT:], or other sentinels — this is a terminal answer. "
        "If a child failed or got blocked, surface that clearly. Otherwise "
        "give the bottom line plus any actionable follow-ups."
    )
    parts.append(f"\nORIGINAL REQUEST\n{parent_task['message'].strip()}")
    parts.append("\nDELEGATIONS")
    for ch in children:
        agent_label = ch.get("agent_id", "?")
        status_label = ch.get("status", "?")
        result_text = (ch.get("result") or "").strip() or "(no result captured)"
        parts.append(f"\n- [{status_label}] {agent_label}:\n{result_text}")
    return "\n".join(parts)


def _read_user_context() -> str:
    """Read the user's profile from context/*.md and condense it for prompt
    injection. These files are written by complete_onboarding and edited
    on the Context page."""
    root = workspace.workspace_root()
    pieces: list[str] = []
    for filename in ("business.md", "profile.md", "priorities.md", "vision.md", "current-data.md"):
        path = root / "context" / filename
        if not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                pieces.append(f"## {filename}\n\n{text}")
        except Exception:
            continue
    if not pieces:
        return "(No user profile yet — onboarding hasn't been completed or context/*.md is empty.)"
    combined = "\n\n".join(pieces)
    # Cap so we don't blow up the system prompt budget.
    if len(combined) > 8000:
        combined = combined[:8000] + "\n\n[user context truncated]"
    return combined


def _department_catalog() -> str:
    """Synthesize a catalog of current sub-agents so the CEO knows whom to
    delegate to via the Task tool. Reflects any user-renamed or user-added
    agents."""
    try:
        result = agents_mod.list_agents()
    except Exception:
        return ""
    rows: list[str] = []
    for agent in result.get("agents", []):
        if agent["id"] == "ceo":
            continue
        rows.append(f"- {agent['name']} ({agent['id']}): {agent['role']}")
    return "\n".join(rows)

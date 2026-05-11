from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from workspace import (
    advance_auto_task,
    append_file,
    begin_auto_task_run,
    complete_onboarding,
    reset_onboarding,
    reset_workspace,
    copy_module_assets,
    create_auto_task,
    create_thread,
    delete_auto_task,
    delete_thread,
    delete_workspace_file,
    due_auto_tasks,
    finish_auto_task_run,
    get_context_summary,
    get_onboarding_state,
    get_outputs_summary,
    get_plans_summary,
    get_recent_workspace_activity,
    get_sessions,
    get_shares_summary,
    get_setting,
    get_workspace_info,
    list_auto_tasks,
    list_connector_status,
    list_directory,
    list_recent_auto_runs,
    list_workspace_files,
    list_workspace_section,
    move_file,
    read_file,
    read_markdown_preview,
    rename_thread,
    save_onboarding_answer,
    save_session,
    set_setting,
    toggle_auto_task,
    update_auto_task,
    workspace_root,
    write_file,
    list_modules,
    build_daily_brief_prompt,
    get_today_brief_status,
    get_daily_brief,
    list_daily_briefs,
    mark_brief_seen,
    save_daily_brief,
)

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def execution_env() -> dict[str, str]:
    home = str(Path.home())
    current_path = os.environ.get("PATH", "")
    if sys.platform.startswith("win"):
        additions = [
            os.path.join(os.environ.get("APPDATA", ""), "npm"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "nodejs"),
            r"C:\Program Files\nodejs",
            r"C:\Program Files (x86)\nodejs",
        ]
    else:
        additions = [
            os.path.join(home, ".npm-global", "bin"),
            os.path.join(home, ".volta", "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
    path_parts: list[str] = []
    for item in additions + current_path.split(os.pathsep):
        if item and item not in path_parts:
            path_parts.append(item)
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(path_parts)
    saved_api_key = get_setting("anthropic_api_key")
    if saved_api_key and not env.get("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = saved_api_key
    return env


class HostError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


import threading

# Shared lock for all stdout writes. With concurrent request handlers, we
# need to make sure two threads don't interleave their JSON-RPC responses
# into the stdout pipe — that would corrupt the framing the Electron host
# relies on.
_STDOUT_LOCK = threading.Lock()


def emit_event(message_id: str | None, event: str, data: dict[str, Any]) -> None:
    if not message_id:
        return
    with _STDOUT_LOCK:
        print(json.dumps({"id": message_id, "event": event, "data": data}), flush=True)


def text_from_stream_message(payload: dict[str, Any]) -> str:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    content = message.get("content") if isinstance(message.get("content"), list) else []
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    return "".join(parts)


def tool_uses_from_stream_message(payload: dict[str, Any]) -> list[dict[str, Any]]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    content = message.get("content") if isinstance(message.get("content"), list) else []
    result: list[dict[str, Any]] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            inp = block.get("input") if isinstance(block.get("input"), dict) else {}
            summary_parts: list[str] = []
            for key in ("command", "file_path", "path", "pattern", "url", "description"):
                value = inp.get(key)
                if isinstance(value, str) and value.strip():
                    summary_parts.append(value.strip())
                    break
            result.append(
                {
                    "id": str(block.get("id") or ""),
                    "name": str(block.get("name") or ""),
                    "summary": (summary_parts[0] if summary_parts else "")[:240],
                }
            )
    return result


def tool_results_from_stream_message(payload: dict[str, Any]) -> list[dict[str, Any]]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    content = message.get("content") if isinstance(message.get("content"), list) else []
    result: list[dict[str, Any]] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            result.append(
                {
                    "toolUseId": str(block.get("tool_use_id") or ""),
                    "isError": bool(block.get("is_error")),
                }
            )
    return result


def run_claude_stream(
    command: list[str],
    cwd: str,
    timeout: int,
    request_id: str | None,
    stream_id: str,
) -> dict[str, Any]:
    started = subprocess.Popen(
        command,
        cwd=cwd,
        env=execution_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    final: dict[str, Any] | None = None
    streamed_text = ""
    last_full_text = ""

    try:
        assert started.stdout is not None
        for line in started.stdout:
            payload = json.loads(line)
            payload_type = payload.get("type")
            if payload_type == "system" and payload.get("subtype") == "init":
                emit_event(request_id, "claude_stream", {"streamId": stream_id, "sessionId": payload.get("session_id")})
            elif payload_type == "stream_event":
                event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
                delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
                if delta.get("type") == "text_delta":
                    text = str(delta.get("text") or "")
                    streamed_text += text
                    last_full_text = streamed_text
                    emit_event(request_id, "claude_stream", {"streamId": stream_id, "delta": text})
            elif payload_type == "assistant":
                full_text = text_from_stream_message(payload)
                if full_text and len(full_text) > len(last_full_text) and full_text.startswith(last_full_text):
                    delta = full_text[len(last_full_text):]
                    streamed_text += delta
                    emit_event(request_id, "claude_stream", {"streamId": stream_id, "delta": delta})
                if full_text:
                    last_full_text = full_text
                for tool_use in tool_uses_from_stream_message(payload):
                    emit_event(request_id, "claude_stream", {"streamId": stream_id, "toolUse": tool_use})
            elif payload_type == "user":
                for tool_result in tool_results_from_stream_message(payload):
                    emit_event(request_id, "claude_stream", {"streamId": stream_id, "toolResult": tool_result})
            elif payload_type == "result":
                final = payload
    except json.JSONDecodeError as error:
        started.kill()
        raise HostError("CLAUDE_STREAM_ERROR", f"Claude returned malformed stream output: {error}")
    except subprocess.TimeoutExpired:
        started.kill()
        raise HostError("CLAUDE_TIMEOUT", "Claude Code did not finish before the timeout. Reconnect Claude or retry with a shorter prompt.")

    stderr = started.stderr.read().strip() if started.stderr else ""
    return_code = started.wait(timeout=timeout)
    if return_code != 0:
        raise HostError("CLAUDE_FAILED", stderr or f"Claude exited with code {return_code}")
    if not final:
        return {"response": streamed_text, "stderr": stderr, "workspaceRoot": cwd, "command": command[:6]}
    if final.get("is_error"):
        raise HostError("CLAUDE_RESULT_ERROR", str(final.get("result") or stderr or "Claude returned an error."))

    response = str(final.get("result") or streamed_text or "").strip()
    emit_event(
        request_id,
        "claude_stream",
        {
            "streamId": stream_id,
            "response": response,
            "sessionId": final.get("session_id"),
            "durationMs": final.get("duration_ms"),
            "costUsd": final.get("total_cost_usd"),
            "done": True,
        },
    )
    return {
        "response": response,
        "stderr": stderr,
        "workspaceRoot": cwd,
        "command": command[:6],
        "sessionId": final.get("session_id"),
        "costUsd": final.get("total_cost_usd"),
        "durationMs": final.get("duration_ms"),
        "modelUsage": final.get("modelUsage"),
    }


def _resume_flags(session_id: str | None) -> list[str]:
    if session_id and isinstance(session_id, str):
        return ["--resume", session_id]
    return []


def _sanitize_mcp_entry(cfg: dict[str, Any]) -> dict[str, Any] | None:
    """Strip an MCP server entry down to fields Claude's --mcp-config accepts.

    Composio's @composio/core SDK returns session.mcp with extra keys (name,
    description, auth, etc.) that Claude's strict inline-config parser rejects
    with 'Does not adhere to MCP server configuration schema'. The persisted
    settings.json works only because the file reader is lenient; the inline
    parser is strict. Same sanitizer is applied at write-time in workspace.py
    so the persisted entry stays clean too.
    """
    if not isinstance(cfg, dict):
        return None
    url = cfg.get("url")
    if not isinstance(url, str) or not url:
        return None
    headers = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
    server_type = cfg.get("type") if cfg.get("type") in ("http", "sse") else "http"
    return {"type": server_type, "url": url, "headers": headers}


def _mcp_isolation_flags() -> list[str]:
    """Pull AIOS's composio MCP config out of ~/.claude/settings.json and pass
    it inline via --mcp-config + --strict-mcp-config so Claude *only* sees the
    Composio server. Suppresses claude.ai's account-linked connectors entirely."""
    try:
        from workspace import claude_settings_path  # type: ignore
        settings_path = claude_settings_path()
        if not settings_path.exists():
            return []
        with settings_path.open("r", encoding="utf-8") as fh:
            settings = json.load(fh)
        composio_cfg = (settings.get("mcpServers") or {}).get("composio")
        sanitized = _sanitize_mcp_entry(composio_cfg) if composio_cfg else None
        if not sanitized:
            return []
        config_json = json.dumps({"mcpServers": {"composio": sanitized}})
        return ["--strict-mcp-config", "--mcp-config", config_json]
    except Exception:
        return []


_COMPOSIO_SYSTEM_PROMPT = (
    "Tools: COMPOSIO_SEARCH_TOOLS finds a slug, COMPOSIO_MULTI_EXECUTE_TOOL "
    "runs it. Use these — don't assume what's connected.\n"
    "User is non-technical. Be brief, plain, direct.\n"
    "• Hide internals: paths, SQLite, IDs, account labels, install dates.\n"
    "• Hide infrastructure: Composio, MCP, tool router, slugs.\n"
    "• Don't preface ('Let me fetch…') or describe tools used.\n"
    "• If a service isn't connected: 'That isn't connected yet — open Connectors.'\n"
    "• If a workspace script has a small bug (wrong slug, response shape, "
    "minor typo), silently fix it in place and report only the high-level "
    "outcome ('connected', 'data fetched'). Don't show errors or the patch.\n"
    "• Don't invent OAuth URLs or `lk_…` codes.\n"
    "• Don't reference the user's Claude login email or compare with connected accounts."
)


def run_claude(
    prompt: str,
    claude_path: str | None = None,
    timeout: int = 45,
    request_id: str | None = None,
    stream_id: str | None = None,
    session_id: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    path = claude_path or get_setting("claude_path")
    if not path:
        raise HostError("CLAUDE_NOT_CONFIGURED", "Claude Code path is not configured.")

    cwd = str(workspace_root())
    resume = _resume_flags(session_id)
    # Optional --model flag. We pass "haiku" for short, structured tasks like
    # connector-account identify — Haiku is ~3-4x faster than Sonnet/Opus for
    # the same tool-call result, dropping identify from ~10s to ~3-4s.
    # Falsy / unset = use the user's default model.
    model_flags = ["--model", model] if model else []
    # Force Claude to only use MCP servers AIOS hands it, ignoring claude.ai's
    # first-party connectors. Without this, a user whose Anthropic account has
    # Gmail linked to a different address gets cross-wired data when they ask
    # about their inbox — we hit this with `tradephani@gmail.com` overriding
    # the legitimately-connected Composio account.
    mcp_isolation = _mcp_isolation_flags()
    composio_hint = ["--append-system-prompt", _COMPOSIO_SYSTEM_PROMPT] if mcp_isolation else []
    attempts = [
        [path, "--print", *resume, *mcp_isolation, *composio_hint, *model_flags, "--output-format", "json", "--permission-mode", "bypassPermissions", prompt],
        [path, "--print", *resume, *mcp_isolation, *composio_hint, *model_flags, "--output-format", "text", "--permission-mode", "bypassPermissions", prompt],
    ]
    if stream_id:
        stream_command = [
            path,
            "--print",
            *resume,
            *mcp_isolation,
            *composio_hint,
            *model_flags,
            "--verbose",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-mode",
            "bypassPermissions",
            prompt,
        ]
        try:
            return run_claude_stream(stream_command, cwd, timeout, request_id, stream_id)
        except FileNotFoundError:
            raise HostError("CLAUDE_NOT_FOUND", f"Claude executable was not found: {path}")
        except HostError as exc:
            if session_id and exc.code in {"CLAUDE_FAILED", "CLAUDE_RESULT_ERROR", "CLAUDE_STREAM_ERROR"}:
                fallback = [c for c in stream_command if c != "--resume" and c != session_id]
                return run_claude_stream(fallback, cwd, timeout, request_id, stream_id)
            raise

    errors: list[str] = []

    for command in attempts:
        try:
            result = subprocess.run(
                command,
                cwd=cwd,
                env=execution_env(),
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError:
            raise HostError("CLAUDE_NOT_FOUND", f"Claude executable was not found: {path}")
        except subprocess.TimeoutExpired:
            raise HostError("CLAUDE_TIMEOUT", "Claude Code did not finish before the timeout. Reconnect Claude or retry with a shorter prompt.")

        output = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        if result.returncode == 0 and output:
            parsed: dict[str, Any] | None = None
            try:
                parsed = json.loads(output)
            except json.JSONDecodeError:
                parsed = None
            if parsed and parsed.get("type") == "result":
                if parsed.get("is_error"):
                    raise HostError("CLAUDE_RESULT_ERROR", str(parsed.get("result") or stderr or "Claude returned an error."))
                return {
                    "response": str(parsed.get("result") or "").strip(),
                    "stderr": stderr,
                    "workspaceRoot": cwd,
                    "command": command[:5],
                    "sessionId": parsed.get("session_id"),
                    "costUsd": parsed.get("total_cost_usd"),
                    "durationMs": parsed.get("duration_ms"),
                    "modelUsage": parsed.get("modelUsage"),
                }
            return {
                "response": output,
                "stderr": stderr,
                "workspaceRoot": cwd,
                "command": command[:5],
            }
        errors.append(f"{command[:2]} exited {result.returncode}: {stderr or output}")

    raise HostError("CLAUDE_FAILED", "\n".join(errors))


def run_prime(args: dict[str, Any]) -> dict[str, Any]:
    return run_claude(
        "/prime",
        str(args.get("claudePath") or "") or None,
        timeout=90,
        request_id=str(args.get("_requestId") or "") or None,
        stream_id=str(args.get("streamId") or "") or None,
    )


_CONTEXT_TEMPLATES = {"business-info", "personal-info", "strategy", "current-data"}


def write_binary_file(args: dict[str, Any]) -> dict[str, Any]:
    import base64

    path = require_str(args, "path")
    data_b64 = args.get("data")
    if not isinstance(data_b64, str) or not data_b64:
        raise HostError("BAD_REQUEST", "Missing 'data' (base64 string).")

    try:
        binary = base64.b64decode(data_b64)
    except Exception as exc:
        raise HostError("BAD_REQUEST", f"Invalid base64 data: {exc}")

    target = workspace_root() / path
    if workspace_root() != target.resolve() and workspace_root() not in target.resolve().parents:
        raise HostError("BAD_REQUEST", "Path escapes workspace")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(binary)
    return {"path": path, "bytes": len(binary)}


def _import_entry_dict(child: Path, base: Path) -> dict[str, Any]:
    from datetime import datetime, timezone

    stat = child.stat()
    rel = child.relative_to(base).as_posix()
    return {
        "name": child.name,
        "path": f"context/import/{rel}",
        "size": stat.st_size,
        "extension": child.suffix.lower().lstrip("."),
        "modifiedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def list_imports(_args: dict[str, Any]) -> dict[str, Any]:
    from datetime import datetime, timezone

    root = workspace_root() / "context" / "import"
    folders: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    if root.exists():
        for child in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if child.is_dir():
                items = [c for c in child.iterdir() if c.is_file()]
                latest = max((c.stat().st_mtime for c in items), default=child.stat().st_mtime)
                total_size = sum(c.stat().st_size for c in items)
                folders.append({
                    "name": child.name,
                    "path": f"context/import/{child.name}",
                    "fileCount": len(items),
                    "totalSize": total_size,
                    "modifiedAt": datetime.fromtimestamp(latest, tz=timezone.utc).isoformat(),
                })
            elif child.is_file():
                files.append(_import_entry_dict(child, root))
    folders.sort(key=lambda f: f["modifiedAt"], reverse=True)
    return {"folders": folders, "entries": files}


def list_import_folder(args: dict[str, Any]) -> dict[str, Any]:
    name = require_str(args, "name")
    if "/" in name or "\\" in name or name.startswith("."):
        raise HostError("BAD_REQUEST", "Invalid folder name.")
    base = workspace_root() / "context" / "import"
    target = base / name
    if not target.exists() or not target.is_dir():
        raise HostError("NOT_FOUND", f"Folder not found: {name}")
    files: list[dict[str, Any]] = []
    for child in sorted(target.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if child.is_file():
            files.append(_import_entry_dict(child, base))
    return {"folder": name, "entries": files}


def create_import_folder(args: dict[str, Any]) -> dict[str, Any]:
    raw = require_str(args, "name").strip()
    if not raw:
        raise HostError("BAD_REQUEST", "Folder name cannot be empty.")
    safe = "".join(c for c in raw if c.isalnum() or c in (" ", "-", "_")).strip()
    safe = safe.replace(" ", "-")
    if not safe or safe.startswith("."):
        raise HostError("BAD_REQUEST", "Invalid folder name.")
    base = workspace_root() / "context" / "import"
    target = base / safe
    if target.exists():
        raise HostError("ALREADY_EXISTS", f"Folder already exists: {safe}")
    target.mkdir(parents=True, exist_ok=False)
    return {"name": safe, "path": f"context/import/{safe}"}


def delete_import_folder(args: dict[str, Any]) -> dict[str, Any]:
    import shutil

    name = require_str(args, "name")
    if "/" in name or "\\" in name or name.startswith("."):
        raise HostError("BAD_REQUEST", "Invalid folder name.")
    target = workspace_root() / "context" / "import" / name
    if target.exists() and target.is_dir():
        shutil.rmtree(target)
        return {"deleted": True, "name": name}
    return {"deleted": False, "name": name}


def rotate_device_user_id_handler(_args: dict[str, Any]) -> dict[str, Any]:
    """Generate a brand-new device_user_id so the next connector flow gets
    a clean Composio entity and MCP session."""
    from workspace import rotate_device_user_id  # type: ignore
    return {"deviceUserId": rotate_device_user_id()}


def update_claude_mcp(args: dict[str, Any]) -> dict[str, Any]:
    """Merge an MCP server entry into Claude Code's settings.json.

    args:
      name (str): server name (e.g. "composio")
      config (dict | None): MCP server config block, or None to remove
    """
    from workspace import update_claude_mcp_config  # type: ignore
    name = require_str(args, "name")
    config = args.get("config")
    if config is not None and not isinstance(config, dict):
        raise HostError("BAD_REQUEST", "config must be an object or null.")
    return update_claude_mcp_config(name, config)


def delete_import(args: dict[str, Any]) -> dict[str, Any]:
    """Delete an import file. Accepts a bare filename (root) OR `folder/filename` path."""
    name = require_str(args, "name").strip().replace("\\", "/")
    if not name or name.startswith(".") or ".." in name:
        raise HostError("BAD_REQUEST", "Invalid import name.")
    parts = [p for p in name.split("/") if p]
    if any(p.startswith(".") for p in parts) or len(parts) > 2:
        raise HostError("BAD_REQUEST", "Invalid import name.")
    target = workspace_root() / "context" / "import" / Path(*parts)
    if target.exists() and target.is_file():
        target.unlink()
        return {"deleted": True, "name": name}
    return {"deleted": False, "name": name}


def restore_context_template(args: dict[str, Any]) -> dict[str, Any]:
    name = require_str(args, "name").strip()
    if name not in _CONTEXT_TEMPLATES:
        raise HostError("BAD_REQUEST", f"Unknown context template: {name}")

    starter_roots: list[Path] = []
    env_root = os.environ.get("AIOS_STARTER_KIT_ROOT")
    if env_root:
        starter_roots.append(Path(env_root))
    starter_roots.append(Path(__file__).resolve().parent.parent / "aios-starter-kit")
    starter_roots.append(Path.cwd() / "aios-starter-kit")
    starter = next(
        (root / "context" / f"{name}.md" for root in starter_roots if (root / "context" / f"{name}.md").exists()),
        None,
    )
    if starter is None:
        checked = ", ".join(str(root / "context" / f"{name}.md") for root in starter_roots)
        raise HostError("NOT_FOUND", f"Starter template missing on disk. Checked: {checked}")

    target = workspace_root() / "context" / f"{name}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    content = starter.read_text(encoding="utf-8")
    target.write_text(content, encoding="utf-8")
    return {"path": f"context/{name}.md", "content": content, "bytes": len(content.encode("utf-8"))}


def transcribe_audio(args: dict[str, Any]) -> dict[str, Any]:
    import base64
    import tempfile

    audio_b64 = args.get("audio")
    if not isinstance(audio_b64, str) or not audio_b64:
        raise HostError("BAD_REQUEST", "Missing 'audio' (base64 WAV string).")

    try:
        wav_bytes = base64.b64decode(audio_b64)
    except Exception as exc:
        raise HostError("BAD_REQUEST", f"Invalid base64 audio: {exc}")

    try:
        import speech_recognition as sr  # type: ignore
    except ImportError:
        raise HostError(
            "MISSING_DEPENDENCY",
            "Install the free transcription dependency: pip install SpeechRecognition",
        )

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes)
            tmp_path = tmp.name

        recognizer = sr.Recognizer()
        with sr.AudioFile(tmp_path) as source:
            audio = recognizer.record(source)

        engine = str(args.get("engine") or "google").lower()
        language = str(args.get("language") or "en-US")
        try:
            if engine == "sphinx":
                text = recognizer.recognize_sphinx(audio, language=language)
            else:
                text = recognizer.recognize_google(audio, language=language)
        except sr.UnknownValueError:
            return {"text": "", "engine": engine}
        except sr.RequestError as exc:
            raise HostError("STT_FAILED", f"Transcription service error: {exc}")

        return {"text": str(text or "").strip(), "engine": engine}
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def run_task(args: dict[str, Any]) -> dict[str, Any]:
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        raise HostError("EMPTY_PROMPT", "Prompt cannot be empty.")
    return run_claude(
        prompt,
        str(args.get("claudePath") or "") or None,
        timeout=180,
        request_id=str(args.get("_requestId") or "") or None,
        stream_id=str(args.get("streamId") or "") or None,
        session_id=str(args.get("sessionId") or "") or None,
        model=str(args.get("model") or "") or None,
    )


def generate_daily_brief(args: dict[str, Any]) -> dict[str, Any]:
    local_date = require_str(args, "localDate")
    # If we already saved a brief for today, return it without re-generating.
    existing = get_daily_brief(local_date)
    if existing:
        return {"brief": existing, "regenerated": False}

    claude_path = str(args.get("claudePath") or "") or get_setting("claude_path")
    if not claude_path:
        raise HostError("CLAUDE_NOT_CONFIGURED", "Claude Code is not configured.")

    prompt = build_daily_brief_prompt(local_date)
    result = run_claude(
        prompt,
        claude_path,
        timeout=180,
        request_id=str(args.get("_requestId") or "") or None,
        stream_id=str(args.get("streamId") or "") or None,
    )
    content = (result.get("response") or "").strip()
    if not content:
        raise HostError("CLAUDE_EMPTY", "Claude returned an empty brief.")
    # Headline = first H2 line, fallback to first sentence
    headline = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            headline = stripped[3:].strip()
            break
    if not headline:
        first_chunk = content.split("\n", 1)[0].strip()
        headline = first_chunk[:120]
    saved = save_daily_brief(local_date, headline, content)
    return {"brief": saved, "regenerated": True}


def require_str(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str):
        raise HostError("BAD_REQUEST", f"Missing string argument: {key}")
    return value


def dispatch(cmd: str, args: dict[str, Any]) -> Any:
    handlers: dict[str, Callable[[dict[str, Any]], Any]] = {
        "get_workspace_info": lambda _args: get_workspace_info(),
        "get_onboarding_state": lambda _args: get_onboarding_state(),
        "save_onboarding_answer": lambda a: save_onboarding_answer(
            require_str(a, "questionId"),
            require_str(a, "value"),
            int(a["step"]) if "step" in a and a["step"] is not None else None,
        ),
        "complete_onboarding": lambda a: complete_onboarding(a.get("answers") if isinstance(a.get("answers"), dict) else None),
        "reset_onboarding": lambda _a: reset_onboarding(),
        "reset_workspace": lambda _a: reset_workspace(),
        "read_file": lambda a: read_file(require_str(a, "path")),
        "write_file": lambda a: write_file(require_str(a, "path"), require_str(a, "content")),
        "append_file": lambda a: append_file(require_str(a, "path"), require_str(a, "content")),
        "move_file": lambda a: move_file(require_str(a, "fromPath"), require_str(a, "toPath")),
        "list_modules": lambda _args: list_modules(),
        "install_module": lambda a: copy_module_assets(require_str(a, "moduleId")),
        "get_context_summary": lambda _args: get_context_summary(),
        "list_workspace_files": lambda a: list_workspace_files(int(a.get("limit") or 400)),
        "list_workspace_section": lambda a: list_workspace_section(require_str(a, "section")),
        "list_directory": lambda a: list_directory(require_str(a, "path"), bool(a.get("recursive")), int(a.get("limit") or 200)),
        "get_recent_workspace_activity": lambda a: get_recent_workspace_activity(int(a.get("limit") or 20)),
        "read_markdown_preview": lambda a: read_markdown_preview(require_str(a, "path")),
        "list_outputs": lambda _args: get_outputs_summary(),
        "list_plans": lambda _args: get_plans_summary(),
        "list_shares": lambda _args: get_shares_summary(),
        "get_sessions": lambda _args: get_sessions(),
        "create_thread": lambda a: create_thread(str(a.get("title") or "").strip() or None),
        "rename_thread": lambda a: rename_thread(require_str(a, "id"), require_str(a, "title")),
        "delete_thread": lambda a: delete_thread(require_str(a, "id")),
        "save_session": lambda a: save_session(a["session"] if isinstance(a.get("session"), dict) else {}),
        "get_setting": lambda a: {"key": require_str(a, "key"), "value": get_setting(require_str(a, "key"))},
        "set_setting": lambda a: set_setting(require_str(a, "key"), require_str(a, "value")),
        "run_prime": run_prime,
        "run_task": run_task,
        "transcribe_audio": transcribe_audio,
        "restore_context_template": restore_context_template,
        "write_binary_file": write_binary_file,
        "list_imports": list_imports,
        "delete_import": delete_import,
        "list_import_folder": list_import_folder,
        "create_import_folder": create_import_folder,
        "delete_import_folder": delete_import_folder,
        "update_claude_mcp": update_claude_mcp,
        "rotate_device_user_id": rotate_device_user_id_handler,
        "list_connector_status": lambda _a: list_connector_status(),
        "list_auto_tasks": lambda _a: list_auto_tasks(),
        "create_auto_task": lambda a: create_auto_task(
            require_str(a, "name"), require_str(a, "prompt"), require_str(a, "schedule")
        ),
        "update_auto_task": lambda a: update_auto_task(
            int(require_str(a, "id") if isinstance(a.get("id"), str) else a["id"]),
            name=a.get("name") if isinstance(a.get("name"), str) else None,
            prompt=a.get("prompt") if isinstance(a.get("prompt"), str) else None,
            schedule=a.get("schedule") if isinstance(a.get("schedule"), str) else None,
        ),
        "delete_auto_task": lambda a: delete_auto_task(int(a["id"])),
        "toggle_auto_task": lambda a: toggle_auto_task(int(a["id"]), bool(a.get("enabled"))),
        "list_recent_auto_runs": lambda a: list_recent_auto_runs(int(a.get("limit") or 10)),
        "list_due_auto_tasks": lambda _a: {"tasks": due_auto_tasks()},
        "begin_auto_task_run": lambda a: begin_auto_task_run(int(a["taskId"])),
        "finish_auto_task_run": lambda a: finish_auto_task_run(
            int(a["runId"]),
            status=require_str(a, "status"),
            output_path=a.get("outputPath") if isinstance(a.get("outputPath"), str) else None,
            cost_usd=float(a["costUsd"]) if a.get("costUsd") is not None else None,
            error=a.get("error") if isinstance(a.get("error"), str) else None,
        ),
        "advance_auto_task": lambda a: (advance_auto_task(int(a["taskId"])) or {"id": int(a["taskId"])}),
        "delete_workspace_file": lambda a: delete_workspace_file(require_str(a, "path")),
        "get_today_brief_status": lambda a: get_today_brief_status(require_str(a, "localDate")),
        "generate_daily_brief": generate_daily_brief,
        "list_daily_briefs": lambda a: list_daily_briefs(int(a.get("limit") or 60)),
        "mark_brief_seen": lambda a: mark_brief_seen(require_str(a, "localDate")),
    }
    handler = handlers.get(cmd)
    if not handler:
        raise HostError("UNKNOWN_COMMAND", f"Command is not allowed: {cmd}")
    return handler(args)


def respond(message_id: str, ok: bool, data: Any = None, code: str | None = None, message: str | None = None) -> None:
    payload: dict[str, Any] = {"id": message_id, "ok": ok}
    if ok:
        payload["data"] = data
    else:
        payload["error"] = {"code": code or "ERROR", "message": message or "Unknown error"}
    with _STDOUT_LOCK:
        print(json.dumps(payload), flush=True)


def _handle_request(line: str) -> None:
    """Process a single JSON-RPC request. Run in a worker thread so multiple
    in-flight commands don't block each other — critical because run_task
    spawns Claude CLI which can take 10-25s per call. With serial dispatch,
    a single Claude task froze every other IPC behind it."""
    message_id = ""
    try:
        request = json.loads(line)
        message_id = str(request.get("id") or "")
        cmd = str(request.get("cmd") or "")
        args = request.get("args") if isinstance(request.get("args"), dict) else {}
        args["_requestId"] = message_id
        respond(message_id, True, dispatch(cmd, args))
    except HostError as error:
        respond(message_id, False, code=error.code, message=error.message)
    except Exception as error:
        respond(message_id, False, code="HOST_ERROR", message=str(error))


def main() -> None:
    # Initialize the database early so startup failures are visible.
    get_workspace_info()
    for line in sys.stdin:
        threading.Thread(target=_handle_request, args=(line,), daemon=True).start()


if __name__ == "__main__":
    main()

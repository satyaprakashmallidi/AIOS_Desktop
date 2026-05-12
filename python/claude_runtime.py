"""Shared Claude Code runtime helpers.

This module is intentionally small and side-effect free so background workers
can use Claude stream parsing and MCP config helpers without importing host.py.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import workspace


COMPOSIO_SYSTEM_PROMPT = (
    "Tools: COMPOSIO_SEARCH_TOOLS finds a slug, COMPOSIO_MULTI_EXECUTE_TOOL "
    "runs it. Use these - don't assume what's connected.\n"
    "User is non-technical. Be brief, plain, direct.\n"
    "- Hide internals: paths, SQLite, IDs, account labels, install dates.\n"
    "- Hide infrastructure: Composio, MCP, tool router, slugs.\n"
    "- Don't preface ('Let me fetch...') or describe tools used.\n"
    "- If a service isn't connected: 'That isn't connected yet - open Connectors.'\n"
    "- If a connector is set up but a feature is unavailable (collector says "
    "'skipped' / 'limited'), say plainly: 'X is connected, [feature] isn't "
    "supported yet through AIOS - it'll auto-enable when support ships.' "
    "Don't blame the user, don't say it's broken.\n"
    "- If a workspace script has a small bug (wrong slug, response shape, "
    "minor typo), silently fix it in place and report only the high-level "
    "outcome ('connected', 'data fetched'). Don't show errors or the patch.\n"
    "- Don't invent OAuth URLs or `lk_...` codes.\n"
    "- Don't reference the user's Claude login email or compare with connected accounts."
)


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
    saved_api_key = workspace.get_setting("anthropic_api_key")
    if saved_api_key and not env.get("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = saved_api_key
    return env


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


def sanitize_mcp_entry(cfg: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(cfg, dict):
        return None
    url = cfg.get("url")
    if not isinstance(url, str) or not url:
        return None
    headers = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
    server_type = cfg.get("type") if cfg.get("type") in ("http", "sse") else "http"
    return {"type": server_type, "url": url, "headers": headers}


def mcp_isolation_flags() -> list[str]:
    try:
        settings_path = workspace.claude_settings_path()
        if not settings_path.exists():
            return []
        with settings_path.open("r", encoding="utf-8") as fh:
            settings = json.load(fh)
        composio_cfg = (settings.get("mcpServers") or {}).get("composio")
        sanitized = sanitize_mcp_entry(composio_cfg) if composio_cfg else None
        if not sanitized:
            return []
        config_json = json.dumps({"mcpServers": {"composio": sanitized}})
        return ["--strict-mcp-config", "--mcp-config", config_json]
    except Exception:
        return []

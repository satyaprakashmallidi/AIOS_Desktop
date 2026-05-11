"""
Lightweight Composio client for AIOS module scripts.

This is how module scripts (IntelOS collect_slack.py, DataOS stripe.py /
youtube.py / google_analytics.py / google_sheets.py) authenticate to external
services WITHOUT going through Claude or storing API keys in the user's .env.

Architecture:
    Module script → ComposioClient.execute() → AIOS relay /execute-tool →
    Composio SDK → external service (Slack / Stripe / etc.) → response

The relay holds the master Composio API key server-side. Each desktop install
has a stable `device_user_id` (UUID4 generated on first launch, persisted in
the local SQLite settings) that authenticates the script to the relay via
`Authorization: Bearer <uuid>`. Composio scopes all tool calls to the user's
OAuth-authorized connections (set up via the Connectors page in AIOS Desktop).

Usage:
    from composio_client import Composio, ConnectorNotConfiguredError

    composio = Composio()  # auto-discovers device_user_id + relay url
    try:
        result = composio.execute(
            tool_slug="STRIPE_LIST_CHARGES",
            args={"limit": 100},
            service="stripe",   # raises ConnectorNotConfiguredError if missing
        )
        print(result)
    except ConnectorNotConfiguredError as exc:
        print(f"Connect {exc.service} via the AIOS Connectors page first.")
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from contextlib import closing
from pathlib import Path
from typing import Any


DEFAULT_RELAY_URL = "https://cnvimnicyeljkihbjztv.supabase.co/functions/v1/aios-relay"


class ComposioError(RuntimeError):
    """Base class for Composio client errors."""


class ConnectorNotConfiguredError(ComposioError):
    """Raised when the requested service has no active connection at the relay.

    The user should be told to open the AIOS Connectors page in the desktop
    app and connect the service before re-running the script.
    """

    def __init__(self, service: str, message: str) -> None:
        super().__init__(message)
        self.service = service


class Composio:
    """Thin client over the AIOS relay's /execute-tool endpoint.

    Parameters
    ----------
    device_user_id : str, optional
        The user's stable device ID. Auto-loaded from the local AIOS workspace
        SQLite (`data/settings.db`'s app_state table) if not provided.
    relay_url : str, optional
        Base URL of the AIOS relay. Defaults to the production Supabase
        function URL; override via the AIOS_RELAY_URL env var for local
        testing against a different deployment.
    workspace_root : Path | str, optional
        Where to find `data/settings.db`. Auto-resolved from the
        AIOS_WORKSPACE_ROOT env var or, failing that, from common defaults
        per OS.
    """

    def __init__(
        self,
        device_user_id: str | None = None,
        relay_url: str | None = None,
        workspace_root: Path | str | None = None,
    ) -> None:
        self.relay_url = (
            relay_url
            or os.environ.get("AIOS_RELAY_URL")
            or DEFAULT_RELAY_URL
        ).rstrip("/")

        if device_user_id:
            self.device_user_id = device_user_id
        else:
            self.device_user_id = self._discover_device_user_id(workspace_root)

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    @staticmethod
    def _workspace_root(override: Path | str | None = None) -> Path:
        if override:
            return Path(override).expanduser().resolve()
        env_root = os.environ.get("AIOS_WORKSPACE_ROOT")
        if env_root:
            return Path(env_root).expanduser().resolve()
        # Fall back to platform-default AIOS workspace location. Keep in sync
        # with main/workspace.ts::getWorkspaceRoot.
        if sys.platform == "darwin":
            return Path.home() / "Library" / "Application Support" / "aios-desktop" / "ai-sales-os"
        if sys.platform.startswith("win"):
            appdata = os.environ.get("APPDATA")
            if appdata:
                return Path(appdata) / "aios-desktop" / "ai-sales-os"
        return Path.cwd().resolve()

    @classmethod
    def _discover_device_user_id(cls, override: Path | str | None) -> str:
        root = cls._workspace_root(override)
        db_path = root / "data" / "settings.db"
        if not db_path.exists():
            raise ComposioError(
                f"AIOS workspace SQLite not found at {db_path}. "
                "Either run this script from inside an AIOS workspace, "
                "set AIOS_WORKSPACE_ROOT, or pass device_user_id explicitly."
            )
        try:
            with closing(sqlite3.connect(str(db_path))) as conn:
                row = conn.execute(
                    "SELECT value FROM app_state WHERE key = 'device_user_id'"
                ).fetchone()
        except sqlite3.OperationalError as exc:
            raise ComposioError(
                f"Could not read device_user_id from {db_path}: {exc}"
            ) from exc
        if not row or not row[0]:
            raise ComposioError(
                "device_user_id is missing from the AIOS workspace. "
                "Launch AIOS Desktop once to provision it, then re-run this script."
            )
        return str(row[0])

    # ------------------------------------------------------------------
    # Execute
    # ------------------------------------------------------------------

    def execute(
        self,
        tool_slug: str,
        args: dict[str, Any] | None = None,
        service: str | None = None,
        timeout: float = 60.0,
    ) -> Any:
        """Invoke a Composio tool with the user's OAuth connection.

        Parameters
        ----------
        tool_slug : str
            Composio tool slug, e.g. "STRIPE_LIST_CHARGES", "SLACK_FETCH_CONVERSATIONS_HISTORY".
        args : dict, optional
            Tool-specific arguments (per Composio's tool schema).
        service : str, optional
            Connector slug ("stripe", "slack", "github", etc.). When passed,
            the relay verifies the user has that service connected and
            scopes the tool execute to their connection. Recommended.
        timeout : float
            HTTP timeout in seconds. Default 60s — most tool calls finish
            in 1-5s but external services can be slow.

        Returns
        -------
        Any
            The tool's response data (shape depends on the tool).

        Raises
        ------
        ConnectorNotConfiguredError
            If `service` is set but the user hasn't connected it.
        ComposioError
            For any other relay / SDK / network error.
        """
        if not tool_slug:
            raise ComposioError("tool_slug is required")

        body = {
            "tool_slug": tool_slug,
            "args": args or {},
        }
        if service:
            body["service"] = service
        payload = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(
            f"{self.relay_url}/execute-tool",
            method="POST",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.device_user_id}",
                "Content-Type": "application/json",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                response = json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            # Error body usually has { error: { code, message } }
            try:
                err_body = json.loads(exc.read().decode("utf-8"))
            except Exception:
                err_body = {}
            err = err_body.get("error") if isinstance(err_body, dict) else None
            code = err.get("code") if isinstance(err, dict) else None
            msg = err.get("message") if isinstance(err, dict) else str(exc)
            if code == "NOT_CONNECTED" and service:
                raise ConnectorNotConfiguredError(service, msg or f"Service '{service}' is not connected.")
            raise ComposioError(f"Relay returned {exc.code}: {msg}") from exc
        except urllib.error.URLError as exc:
            raise ComposioError(f"Could not reach AIOS relay at {self.relay_url}: {exc.reason}") from exc

        if not response.get("ok"):
            err = response.get("error") if isinstance(response.get("error"), dict) else {}
            raise ComposioError(err.get("message") or "Unknown relay error")
        return response.get("data")

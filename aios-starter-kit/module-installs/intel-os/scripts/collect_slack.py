"""
IntelOS — Slack message collector.

Pulls the last 24 hours of messages from all channels Slack returns to the
authenticated user. Resolves user IDs to display names and expands thread
replies.

AUTH: this script uses the AIOS Connectors page Slack connection (Composio).
No SLACK_TOKEN_* env vars needed. If Slack isn't connected, the script
prints a clear message and exits.

Usage:
    python scripts/collect_slack.py
"""

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# composio_client.py is shipped at <workspace>/scripts/composio_client.py.
# Walk up the parent chain to find it — works whether this script lives in
# module-installs/intel-os/scripts/ (pre-install) or workspace scripts/
# (post-install).
_HERE = Path(__file__).resolve()
for _ancestor in _HERE.parents:
    _cand = _ancestor / "scripts" / "composio_client.py"
    if _cand.exists():
        sys.path.insert(0, str(_ancestor / "scripts"))
        break

from composio_client import Composio, ConnectorNotConfiguredError  # noqa: E402


# Tier-3 Slack endpoints are limited to ~50 req/min; keep some pacing.
RATE_LIMIT_SLEEP = 0.5


def _slack_call(composio: Composio, tool_slug: str, args: dict) -> dict:
    """Invoke a Slack tool via Composio. Returns the unwrapped tool response."""
    return composio.execute(tool_slug=tool_slug, args=args, service="slack")


def _get_channels(composio: Composio) -> list[dict]:
    """List all public channels the connection can see, paginated."""
    channels: list[dict] = []
    cursor: str | None = None
    while True:
        args: dict = {"types": "public_channel", "limit": 200, "exclude_archived": True}
        if cursor:
            args["cursor"] = cursor
        data = _slack_call(composio, "SLACK_LIST_ALL_SLACK_TEAM_CHANNELS_WITH_VARIOUS_FILTERS", args)
        # Composio may wrap tool responses in {data: ...} or return raw — normalise.
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
            data = data["data"]
        channels.extend(data.get("channels", []) or [])
        cursor = ((data.get("response_metadata") or {}).get("next_cursor")) or None
        if not cursor:
            break
        time.sleep(RATE_LIMIT_SLEEP)
    return channels


def _get_history(composio: Composio, channel_id: str, oldest: str) -> list[dict]:
    """Pull messages from a channel since `oldest` timestamp."""
    messages: list[dict] = []
    cursor: str | None = None
    while True:
        args: dict = {"channel": channel_id, "oldest": oldest, "limit": 200}
        if cursor:
            args["cursor"] = cursor
        try:
            data = _slack_call(composio, "SLACK_FETCH_CONVERSATION_HISTORY", args)
        except Exception:
            break
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
            data = data["data"]
        messages.extend(data.get("messages", []) or [])
        cursor = ((data.get("response_metadata") or {}).get("next_cursor")) or None
        if not cursor:
            break
        time.sleep(RATE_LIMIT_SLEEP)
    return messages


def _get_thread_replies(composio: Composio, channel_id: str, thread_ts: str) -> list[dict]:
    """Pull all replies for a parent message timestamp."""
    try:
        data = _slack_call(
            composio,
            # Composio's slug for conversations.replies
            "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
            {"channel": channel_id, "ts": thread_ts, "limit": 200},
        )
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
            data = data["data"]
        msgs = data.get("messages", []) or []
        return [m for m in msgs if m.get("ts") != thread_ts]
    except Exception:
        return []


def _resolve_users(composio: Composio, user_ids: set[str]) -> dict[str, str]:
    """Look up display names for a set of user IDs."""
    cache: dict[str, str] = {}
    for uid in user_ids:
        if not uid or uid in cache:
            continue
        try:
            # Composio's slug for users.info
            data = _slack_call(composio, "SLACK_RETRIEVE_DETAILED_USER_INFORMATION", {"user": uid})
            if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
                data = data["data"]
            user = data.get("user", {}) or {}
            name = (
                (user.get("profile") or {}).get("display_name")
                or user.get("real_name")
                or user.get("name")
                or uid
            )
            cache[uid] = name
        except Exception:
            cache[uid] = uid
        time.sleep(0.2)
    return cache


def collect() -> tuple[list[dict], dict]:
    """Collect last 24h of Slack messages via the AIOS Slack connector.

    Returns:
        (messages_list, stats_dict)
    """
    try:
        composio = Composio()
    except Exception as exc:
        print(f"Skipped: Could not initialize AIOS Composio client: {exc}")
        return [], {}

    # No upfront auth-ping — Composio's Slack toolkit doesn't expose an
    # auth.test equivalent (SLACK_TEST_AUTH doesn't exist as of v0.1.9).
    # The first real tool call (_get_channels) will surface a
    # ConnectorNotConfiguredError with a clear message if Slack isn't
    # connected — we handle that gracefully below.
    try:
        channels = _get_channels(composio)
    except ConnectorNotConfiguredError as exc:
        print(
            "Skipped: Slack is not connected.\n"
            "  → Open AIOS Desktop → Connectors → Connect Slack\n"
            f"  → Detail: {exc}"
        )
        return [], {}
    except Exception as exc:
        print(f"Skipped: Slack channel list failed: {exc}")
        return [], {}

    oldest = str((datetime.now(timezone.utc) - timedelta(hours=24)).timestamp())
    all_messages: list[dict] = []
    user_ids: set[str] = set()
    threads_expanded = 0

    # Skip bot messages and system subtypes.
    skip_subtypes = {
        "channel_join", "channel_leave", "channel_topic",
        "channel_purpose", "channel_name",
    }

    for ch in channels:
        ch_id = ch.get("id")
        ch_name = ch.get("name", "")
        if not ch_id:
            continue
        time.sleep(RATE_LIMIT_SLEEP)

        messages = _get_history(composio, ch_id, oldest)
        for msg in messages:
            subtype = msg.get("subtype", "")
            if subtype in skip_subtypes:
                continue
            uid = msg.get("user", "")
            if uid:
                user_ids.add(uid)
            reactions = None
            if msg.get("reactions"):
                reactions = [{"name": r["name"], "count": r["count"]} for r in msg["reactions"]]
            reply_count = msg.get("reply_count", 0)
            all_messages.append({
                "channel_id": ch_id,
                "channel_name": ch_name,
                "user_id": uid,
                "ts": msg["ts"],
                "thread_ts": msg.get("thread_ts") if msg.get("thread_ts") != msg["ts"] else None,
                "message_type": subtype or "message",
                "text": msg.get("text", ""),
                "has_files": 1 if msg.get("files") else 0,
                "reactions": reactions,
                "reply_count": reply_count,
            })
            if reply_count > 0:
                replies = _get_thread_replies(composio, ch_id, msg["ts"])
                threads_expanded += 1
                for reply in replies:
                    r_uid = reply.get("user", "")
                    if r_uid:
                        user_ids.add(r_uid)
                    r_reactions = None
                    if reply.get("reactions"):
                        r_reactions = [{"name": r["name"], "count": r["count"]} for r in reply["reactions"]]
                    all_messages.append({
                        "channel_id": ch_id,
                        "channel_name": ch_name,
                        "user_id": r_uid,
                        "ts": reply["ts"],
                        "thread_ts": reply.get("thread_ts"),
                        "message_type": reply.get("subtype", "message"),
                        "text": reply.get("text", ""),
                        "has_files": 1 if reply.get("files") else 0,
                        "reactions": r_reactions,
                        "reply_count": 0,
                    })
                time.sleep(RATE_LIMIT_SLEEP)

    user_map = _resolve_users(composio, user_ids)
    for msg in all_messages:
        msg["user_name"] = user_map.get(msg.get("user_id", ""), msg.get("user_id"))

    stats = {
        "channels": len(channels),
        "messages": len(all_messages),
        "threads": threads_expanded,
    }
    return all_messages, stats


if __name__ == "__main__":
    messages, stats = collect()
    print(f"\nTotal: {len(messages)} messages")
    print(f"Stats: {json.dumps(stats, indent=2)}")

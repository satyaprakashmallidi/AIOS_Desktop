"""
IntelOS — Slack message collector.

Pulls the last 24 hours of messages from all public channels in your Slack workspace(s).
Resolves user IDs to display names and expands thread replies.

IMPORTANT: The Slack bot can only see channels it has been invited to.
After setup, invite the bot to channels you want collected by typing
/invite @YourBotName in each channel.

Usage:
    python scripts/collect_slack.py
"""

import os
import time
import json
import requests
from pathlib import Path
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SLACK_API = "https://slack.com/api"

# Rate limit: ~50 req/min for Tier 3 methods
RATE_LIMIT_SLEEP = 0.5


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _api_call(token: str, method: str, params: dict = None) -> dict:
    """Make a Slack API call."""
    resp = requests.get(
        f"{SLACK_API}/{method}",
        headers=_headers(token),
        params=params or {},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        error = data.get("error", "unknown_error")
        if error == "not_authed" or error == "invalid_auth":
            raise RuntimeError(
                f"Slack authentication failed. Your token might be invalid or expired.\n"
                f"  → Go to https://api.slack.com/apps → your app → OAuth & Permissions\n"
                f"  → Copy the Bot User OAuth Token and update your .env file"
            )
        if error == "channel_not_found":
            return data  # Non-fatal — skip this channel
        raise RuntimeError(f"Slack API error ({method}): {error}")
    return data


def _get_channels(token: str) -> list[dict]:
    """Get all channels the bot can see, with pagination."""
    channels = []
    cursor = None
    while True:
        params = {"types": "public_channel", "limit": 200, "exclude_archived": "true"}
        if cursor:
            params["cursor"] = cursor
        data = _api_call(token, "conversations.list", params)
        channels.extend(data.get("channels", []))
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(RATE_LIMIT_SLEEP)
    return channels


def _get_history(token: str, channel_id: str, oldest: str) -> list[dict]:
    """Get messages from a channel since a timestamp."""
    messages = []
    cursor = None
    while True:
        params = {"channel": channel_id, "oldest": oldest, "limit": 200}
        if cursor:
            params["cursor"] = cursor
        try:
            data = _api_call(token, "conversations.history", params)
        except RuntimeError:
            break  # Skip channels we can't read
        messages.extend(data.get("messages", []))
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(RATE_LIMIT_SLEEP)
    return messages


def _get_thread_replies(token: str, channel_id: str, thread_ts: str) -> list[dict]:
    """Get all replies in a thread."""
    try:
        data = _api_call(token, "conversations.replies", {
            "channel": channel_id, "ts": thread_ts, "limit": 200,
        })
        msgs = data.get("messages", [])
        return [m for m in msgs if m.get("ts") != thread_ts]
    except Exception:
        return []


def _resolve_users(token: str, user_ids: set[str]) -> dict[str, str]:
    """Resolve user IDs to display names."""
    cache = {}
    for uid in user_ids:
        if not uid or uid in cache:
            continue
        try:
            data = _api_call(token, "users.info", {"user": uid})
            user = data.get("user", {})
            name = (user.get("profile", {}).get("display_name")
                    or user.get("real_name")
                    or user.get("name")
                    or uid)
            cache[uid] = name
        except Exception:
            cache[uid] = uid
        time.sleep(0.2)
    return cache


def _collect_workspace(workspace_name: str, token: str) -> dict:
    """Collect last 24 hours of messages from one workspace."""
    oldest = str((datetime.now(timezone.utc) - timedelta(hours=24)).timestamp())

    channels = _get_channels(token)
    all_messages = []
    user_ids = set()
    threads_expanded = 0

    # Skip bot messages and system subtypes
    skip_subtypes = {"channel_join", "channel_leave", "channel_topic",
                     "channel_purpose", "channel_name"}

    for ch in channels:
        ch_id = ch["id"]
        ch_name = ch.get("name", "")
        time.sleep(RATE_LIMIT_SLEEP)

        messages = _get_history(token, ch_id, oldest)

        for msg in messages:
            subtype = msg.get("subtype", "")
            if subtype in skip_subtypes:
                continue

            uid = msg.get("user", "")
            if uid:
                user_ids.add(uid)

            reactions = None
            if msg.get("reactions"):
                reactions = [{"name": r["name"], "count": r["count"]}
                             for r in msg["reactions"]]

            reply_count = msg.get("reply_count", 0)
            msg_record = {
                "workspace": workspace_name,
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
            }
            all_messages.append(msg_record)

            # Expand threads
            if reply_count > 0:
                replies = _get_thread_replies(token, ch_id, msg["ts"])
                threads_expanded += 1
                for reply in replies:
                    r_uid = reply.get("user", "")
                    if r_uid:
                        user_ids.add(r_uid)
                    r_reactions = None
                    if reply.get("reactions"):
                        r_reactions = [{"name": r["name"], "count": r["count"]}
                                       for r in reply["reactions"]]
                    all_messages.append({
                        "workspace": workspace_name,
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

    # Resolve user names
    user_map = _resolve_users(token, user_ids)
    for msg in all_messages:
        msg["user_name"] = user_map.get(msg.get("user_id", ""), msg.get("user_id"))

    return {
        "workspace": workspace_name,
        "channels_read": len(channels),
        "messages_collected": len(all_messages),
        "threads_expanded": threads_expanded,
        "messages": all_messages,
    }


def collect() -> tuple[list[dict], dict]:
    """Collect Slack messages from all configured workspaces.

    Discovers workspace tokens automatically — any env var starting with
    SLACK_TOKEN_ is treated as a workspace. The part after SLACK_TOKEN_
    becomes the workspace name.

    Returns:
        (messages_list, stats_dict)
    """
    # Find all SLACK_TOKEN_* env vars
    tokens = {}
    for key, value in os.environ.items():
        if key.startswith("SLACK_TOKEN_") and value and value.strip():
            workspace_name = key.replace("SLACK_TOKEN_", "").lower()
            tokens[workspace_name] = value.strip()

    if not tokens:
        print("Skipped: No Slack tokens found. Add SLACK_TOKEN_MAIN (or similar) to .env")
        return [], {}

    all_messages = []
    stats = {}

    for ws_name, token in tokens.items():
        try:
            print(f"Collecting Slack workspace: {ws_name}...")
            result = _collect_workspace(ws_name, token)
            all_messages.extend(result["messages"])
            stats[ws_name] = {
                "channels": result["channels_read"],
                "messages": result["messages_collected"],
                "threads": result["threads_expanded"],
            }
            print(f"  → {result['messages_collected']} messages from {result['channels_read']} channels")
        except Exception as e:
            print(f"  → Error collecting {ws_name}: {e}")
            stats[ws_name] = {"error": str(e)}

    return all_messages, stats


if __name__ == "__main__":
    messages, stats = collect()
    print(f"\nTotal: {len(messages)} messages")
    print(f"Stats: {json.dumps(stats, indent=2)}")

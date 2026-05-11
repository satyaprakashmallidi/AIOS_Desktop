"""
DataOS — YouTube Data Collector (Example)

Collects channel statistics and recent video performance from YouTube via the
AIOS YouTube connector (Composio). OAuth handled by the Connectors page.

**Required env var:** `YOUTUBE_CHANNEL_ID` — Composio's YouTube toolkit
doesn't have a "list my channels" tool, so we can't auto-discover the
channel. Find your channel ID at https://www.youtube.com/account_advanced
and add `YOUTUBE_CHANNEL_ID=UCxxxxxxxxxx` to your workspace `.env`.

If YouTube isn't connected OR the channel ID is missing, this collector
prints a clear message and skips — DataOS continues with other sources.

Copy this to scripts/collect_youtube.py to activate.

Tables created: youtube_daily, youtube_videos
"""

import os
import sqlite3
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Find composio_client.py shipped at <workspace>/scripts/
_HERE = Path(__file__).resolve()
for _ancestor in _HERE.parents:
    if (_ancestor / "scripts" / "composio_client.py").exists():
        sys.path.insert(0, str(_ancestor / "scripts"))
        break

from composio_client import Composio, ConnectorNotConfiguredError  # noqa: E402


def _unwrap(data):
    """Composio responses may be wrapped in {data: ...} — normalise."""
    if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
        return data["data"]
    return data


def collect():
    """Collect YouTube channel and video data via the AIOS YouTube connector."""
    channel_id = (os.environ.get("YOUTUBE_CHANNEL_ID") or "").strip()
    if not channel_id:
        return {
            "source": "youtube", "status": "skipped",
            "reason": "Missing YOUTUBE_CHANNEL_ID — set it in .env. "
                      "Find your channel ID at youtube.com/account_advanced."
        }

    try:
        composio = Composio()
    except Exception as exc:
        return {
            "source": "youtube", "status": "skipped",
            "reason": f"Could not initialize AIOS Composio client: {exc}"
        }

    # Channel statistics — Composio's slug for this is YOUTUBE_GET_CHANNEL_STATISTICS.
    try:
        stats_resp = composio.execute(
            tool_slug="YOUTUBE_GET_CHANNEL_STATISTICS",
            args={"id": channel_id},
            service="youtube",
        ) or {}
    except ConnectorNotConfiguredError:
        return {
            "source": "youtube", "status": "skipped",
            "reason": "YouTube is not connected. Open AIOS Desktop → Connectors → YouTube."
        }
    except Exception as exc:
        return {"source": "youtube", "status": "error", "reason": str(exc)}

    stats_resp = _unwrap(stats_resp)
    items = stats_resp.get("items") or []
    if not items:
        return {"source": "youtube", "status": "error",
                "reason": f"Channel {channel_id} not found or no access"}

    primary = items[0]
    stats = primary.get("statistics") or {}
    snippet = primary.get("snippet") or {}

    channel_data = {
        "channel_id": channel_id,
        "channel_name": snippet.get("title", ""),
        "subscribers": int(stats.get("subscriberCount", 0) or 0),
        "total_views": int(stats.get("viewCount", 0) or 0),
        "total_videos": int(stats.get("videoCount", 0) or 0),
    }

    # Recent videos: YOUTUBE_LIST_CHANNEL_VIDEOS returns recent uploads.
    videos: list[dict] = []
    total_views_30d = 0
    try:
        videos_resp = composio.execute(
            tool_slug="YOUTUBE_LIST_CHANNEL_VIDEOS",
            args={"channelId": channel_id, "maxResults": 50},
            service="youtube",
        ) or {}
        videos_resp = _unwrap(videos_resp)
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30))
        for item in (videos_resp.get("items") or []):
            snip = item.get("snippet") or {}
            published_str = snip.get("publishedAt", "")
            # Only keep last 30 days
            try:
                published_at = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
                if published_at < thirty_days_ago:
                    continue
            except Exception:
                pass

            # Snippet only has basic info; fetch full details for view counts.
            video_id = ((item.get("id") or {}).get("videoId")
                        if isinstance(item.get("id"), dict)
                        else item.get("id"))
            if not video_id:
                continue
            try:
                detail = composio.execute(
                    tool_slug="YOUTUBE_VIDEO_DETAILS",
                    args={"id": video_id, "part": "statistics,contentDetails,snippet"},
                    service="youtube",
                ) or {}
                detail = _unwrap(detail)
                dst = ((detail.get("items") or [{}])[0]).get("statistics") or {}
                dsnip = ((detail.get("items") or [{}])[0]).get("snippet") or {}
                dcd = ((detail.get("items") or [{}])[0]).get("contentDetails") or {}
            except Exception:
                dst, dsnip, dcd = {}, snip, {}

            views = int(dst.get("viewCount", 0) or 0)
            total_views_30d += views
            videos.append({
                "video_id": video_id,
                "title": dsnip.get("title", "") or snip.get("title", ""),
                "published": (dsnip.get("publishedAt") or published_str)[:10],
                "views": views,
                "likes": int(dst.get("likeCount", 0) or 0),
                "comments": int(dst.get("commentCount", 0) or 0),
                "duration": dcd.get("duration", ""),
            })
    except Exception:
        pass

    return {
        "source": "youtube",
        "status": "success",
        "data": {
            "channel": channel_data,
            "videos_30d": videos,
            "total_views_30d": total_views_30d,
            "videos_published_30d": len(videos),
        }
    }


def write(conn, result, date):
    """Write YouTube data to database. Returns records written."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS youtube_daily (
            date TEXT PRIMARY KEY,
            subscribers INTEGER,
            total_views INTEGER,
            total_videos INTEGER,
            views_30d INTEGER,
            videos_published_30d INTEGER,
            collected_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS youtube_videos (
            video_id TEXT PRIMARY KEY,
            title TEXT,
            published_date TEXT,
            views INTEGER,
            likes INTEGER,
            comments INTEGER,
            duration TEXT,
            last_updated TEXT
        )
    """)

    if result.get("status") != "success":
        conn.commit()
        return 0

    data = result["data"]
    channel = data["channel"]
    collected_at = datetime.now(timezone.utc).isoformat()
    records = 0

    conn.execute(
        "INSERT OR REPLACE INTO youtube_daily "
        "(date, subscribers, total_views, total_videos, views_30d, "
        "videos_published_30d, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (date, channel["subscribers"], channel["total_views"],
         channel["total_videos"], data["total_views_30d"],
         data["videos_published_30d"], collected_at)
    )
    records += 1
    for video in data.get("videos_30d", []):
        conn.execute(
            "INSERT OR REPLACE INTO youtube_videos "
            "(video_id, title, published_date, views, likes, comments, "
            "duration, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (video["video_id"], video["title"], video["published"],
             video["views"], video["likes"], video["comments"],
             video["duration"], date)
        )
        records += 1
    conn.commit()
    return records


if __name__ == "__main__":
    result = collect()
    if result["status"] == "success":
        ch = result["data"]["channel"]
        print(f"Channel: {ch['channel_name']}")
        print(f"Subscribers: {ch['subscribers']:,}")
        print(f"Videos (30d): {result['data']['videos_published_30d']}")
        print(f"Views (30d): {result['data']['total_views_30d']:,}")
    else:
        print(f"{result['status']}: {result.get('reason', '')}")

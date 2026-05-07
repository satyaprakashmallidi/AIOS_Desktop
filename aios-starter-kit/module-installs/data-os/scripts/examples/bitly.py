"""
DataOS — Bitly Link Tracking Collector (Example)

Collects click data for all your Bitly links.
Useful for tracking which content drives the most traffic.

Copy this to scripts/collect_bitly.py to activate.

Requires:
    BITLY_ACCESS_TOKEN  — Get at app.bitly.com/settings/api/

Tables created: bitly_daily
Extra pip: requests (already a base dependency)
"""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

try:
    import requests
except ImportError:
    raise ImportError("Missing 'requests' — run: pip install requests")

API_BASE = "https://api-ssl.bitly.com/v4"


def _api_get(token, endpoint, params=None):
    """Make an authenticated Bitly API GET request."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        f"{API_BASE}{endpoint}",
        headers=headers, params=params, timeout=15
    )
    resp.raise_for_status()
    return resp.json()


def collect():
    """Collect Bitly link click data."""
    token = os.getenv("BITLY_ACCESS_TOKEN", "").strip()
    if not token:
        return {
            "source": "bitly", "status": "skipped",
            "reason": "Missing BITLY_ACCESS_TOKEN — "
                      "get yours at app.bitly.com/settings/api/"
        }

    try:
        # Get all groups
        groups = _api_get(token, "/groups")
        if not groups.get("groups"):
            return {
                "source": "bitly", "status": "error",
                "reason": "No Bitly groups found"
            }

        group_guid = groups["groups"][0]["guid"]

        # Get all bitlinks with pagination
        all_links = []
        page = 1
        while True:
            resp = _api_get(
                token, f"/groups/{group_guid}/bitlinks",
                {"size": 100, "page": page}
            )
            links = resp.get("links", [])
            if not links:
                break
            all_links.extend(links)
            pagination = resp.get("pagination", {})
            if page >= pagination.get("total", 1):
                break
            page += 1

        # Get click counts for each link
        link_data = []
        for link in all_links:
            bitlink_id = link.get("id", "")
            try:
                clicks_1d = _api_get(
                    token, f"/bitlinks/{bitlink_id}/clicks/summary",
                    {"unit": "day", "units": 1}
                )
                clicks_30d = _api_get(
                    token, f"/bitlinks/{bitlink_id}/clicks/summary",
                    {"unit": "day", "units": 30}
                )
                link_data.append({
                    "bitlink_id": bitlink_id,
                    "long_url": link.get("long_url", ""),
                    "title": link.get("title", ""),
                    "created_at": link.get("created_at", ""),
                    "tags": link.get("tags", []),
                    "clicks_1d": clicks_1d.get("total_clicks", 0),
                    "clicks_30d": clicks_30d.get("total_clicks", 0),
                })
            except Exception:
                continue

        link_data.sort(key=lambda x: x["clicks_30d"], reverse=True)

        return {
            "source": "bitly",
            "status": "success",
            "data": {
                "total_links": len(link_data),
                "total_clicks_1d": sum(l["clicks_1d"] for l in link_data),
                "total_clicks_30d": sum(l["clicks_30d"] for l in link_data),
                "links": link_data,
            }
        }

    except Exception as e:
        return {"source": "bitly", "status": "error", "reason": str(e)}


def write(conn, result, date):
    """Write Bitly data to database. Returns records written."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bitly_daily (
            date TEXT NOT NULL,
            bitlink_id TEXT NOT NULL,
            long_url TEXT,
            title TEXT,
            clicks_1d INTEGER,
            clicks_30d INTEGER,
            tags TEXT,
            collected_at TEXT,
            PRIMARY KEY (date, bitlink_id)
        )
    """)

    if result.get("status") != "success":
        conn.commit()
        return 0

    collected_at = datetime.now(timezone.utc).isoformat()
    records = 0

    for link in result["data"]["links"]:
        tags = ",".join(link.get("tags", []))
        conn.execute(
            "INSERT OR REPLACE INTO bitly_daily "
            "(date, bitlink_id, long_url, title, clicks_1d, clicks_30d, "
            "tags, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (date, link["bitlink_id"], link["long_url"], link["title"],
             link["clicks_1d"], link["clicks_30d"], tags, collected_at)
        )
        records += 1

    conn.commit()
    return records


if __name__ == "__main__":
    result = collect()
    if result["status"] == "success":
        data = result["data"]
        print(f"Total links: {data['total_links']}")
        print(f"Clicks today: {data['total_clicks_1d']}")
        print(f"Clicks (30d): {data['total_clicks_30d']}")
        print(f"\nTop 5:")
        for link in data["links"][:5]:
            print(f"  {link['title'] or link['bitlink_id']}: "
                  f"{link['clicks_30d']} clicks")
    else:
        print(f"{result['status']}: {result.get('reason', '')}")

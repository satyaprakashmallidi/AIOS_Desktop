"""
DataOS — Google Analytics (GA4) Collector (Example)

CURRENT STATUS: limited via Composio. As of v0.1.9, Composio's GA toolkit
exposes only 4 tools — none of which can run reports or pull traffic
metrics. We can confirm the user has GA connected (`GOOGLE_ANALYTICS_LIST_ACCOUNTS`)
but can't query daily sessions / users / page views.

Until Composio adds report-running tools, this collector returns a
"skipped" status so DataOS continues with other sources. Don't drop in a
direct service-account fallback — we don't want to ask the user for
credentials a second time.

To pull live GA data today, install GA analytics-data-api Python SDK in
your workspace and write a custom collector — that's documented in the
DataOS README under "Custom collectors".

Copy this to scripts/collect_google_analytics.py if you want it to
explicitly note "GA via connector is not yet usable" in your daily log.

Tables created: ga4_daily, ga4_sources (created empty for forward
compatibility)
"""

import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

# Find composio_client.py shipped at <workspace>/scripts/
_HERE = Path(__file__).resolve()
for _ancestor in _HERE.parents:
    if (_ancestor / "scripts" / "composio_client.py").exists():
        sys.path.insert(0, str(_ancestor / "scripts"))
        break

from composio_client import Composio, ConnectorNotConfiguredError  # noqa: E402


def collect():
    """Probe the GA connection and skip with a clear message.

    We still call GOOGLE_ANALYTICS_LIST_ACCOUNTS so the daily log records
    whether GA is at least OAuth-connected — useful diagnostic and lets us
    quickly see "yes, GA is wired" once Composio adds report tools later.
    """
    try:
        composio = Composio()
    except Exception as exc:
        return {
            "source": "google_analytics", "status": "skipped",
            "reason": f"Could not initialize AIOS Composio client: {exc}"
        }

    try:
        accounts = composio.execute(
            tool_slug="GOOGLE_ANALYTICS_LIST_ACCOUNTS",
            args={}, service="google-analytics",
        ) or {}
    except ConnectorNotConfiguredError:
        return {
            "source": "google_analytics", "status": "skipped",
            "reason": "Google Analytics is not connected. "
                      "Open AIOS Desktop → Connectors → Google Analytics."
        }
    except Exception as exc:
        return {"source": "google_analytics", "status": "error", "reason": str(exc)}

    # Unwrap potential {"data": ...} from the relay
    if isinstance(accounts, dict) and "data" in accounts and isinstance(accounts["data"], dict):
        accounts = accounts["data"]
    account_count = len(accounts.get("accounts") or accounts.get("accountSummaries") or [])

    return {
        "source": "google_analytics", "status": "skipped",
        "reason": f"Google Analytics is connected ({account_count} accounts visible) — "
                  "pulling traffic numbers isn't supported through AIOS yet. "
                  "It'll auto-enable when support ships. No action needed."
    }


def write(conn, result, date):
    """Create empty tables for forward compatibility. Returns 0 records."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ga4_daily (
            date TEXT PRIMARY KEY,
            sessions INTEGER,
            total_users INTEGER,
            new_users INTEGER,
            page_views INTEGER,
            avg_session_duration REAL,
            bounce_rate REAL,
            engagement_rate REAL,
            collected_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ga4_sources (
            date TEXT NOT NULL,
            source TEXT NOT NULL,
            medium TEXT NOT NULL,
            sessions INTEGER,
            users INTEGER,
            PRIMARY KEY (date, source, medium)
        )
    """)
    conn.commit()
    return 0


if __name__ == "__main__":
    result = collect()
    print(f"{result['status']}: {result.get('reason', '')}")

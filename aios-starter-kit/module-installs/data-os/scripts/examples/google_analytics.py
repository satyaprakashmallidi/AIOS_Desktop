"""
DataOS — Google Analytics (GA4) Collector (Example)

Collects website traffic, sources, and engagement from GA4.
Pulls yesterday's data as a daily snapshot.

Copy this to scripts/collect_google_analytics.py to activate.

Requires:
    GOOGLE_SERVICE_ACCOUNT_JSON  — Service account JSON path
    GA4_PROPERTY_ID              — Your GA4 property ID

Tables created: ga4_daily, ga4_sources
Extra pip: google-analytics-data google-auth
"""

import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

try:
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, RunReportRequest
    )
    from google.oauth2.service_account import Credentials
except ImportError:
    raise ImportError(
        "Missing packages — run: pip install google-analytics-data google-auth"
    )


def _get_client():
    """Create an authenticated GA4 client."""
    creds_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not creds_path:
        return None
    full_path = Path(creds_path)
    if not full_path.is_absolute():
        full_path = Path(__file__).resolve().parent.parent.parent / creds_path
    if not full_path.exists():
        return None
    creds = Credentials.from_service_account_file(
        str(full_path),
        scopes=["https://www.googleapis.com/auth/analytics.readonly"]
    )
    return BetaAnalyticsDataClient(credentials=creds)


def collect():
    """Collect GA4 traffic data for yesterday."""
    property_id = os.getenv("GA4_PROPERTY_ID", "").strip()
    if not property_id:
        return {
            "source": "google_analytics", "status": "skipped",
            "reason": "Missing GA4_PROPERTY_ID — find it at "
                      "analytics.google.com > Admin > Property Settings"
        }

    client = _get_client()
    if not client:
        return {
            "source": "google_analytics", "status": "skipped",
            "reason": "Missing or invalid GOOGLE_SERVICE_ACCOUNT_JSON"
        }

    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    try:
        # Overview metrics
        overview = client.run_report(RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[DateRange(start_date=yesterday, end_date=yesterday)],
            metrics=[
                Metric(name="sessions"),
                Metric(name="totalUsers"),
                Metric(name="newUsers"),
                Metric(name="screenPageViews"),
                Metric(name="averageSessionDuration"),
                Metric(name="bounceRate"),
                Metric(name="engagementRate"),
            ],
        ))

        overview_data = {}
        if overview.rows:
            for i, metric in enumerate(overview.metric_headers):
                overview_data[metric.name] = overview.rows[0].metric_values[i].value

        # Top traffic sources
        sources_report = client.run_report(RunReportRequest(
            property=f"properties/{property_id}",
            date_ranges=[DateRange(start_date=yesterday, end_date=yesterday)],
            dimensions=[
                Dimension(name="sessionSource"),
                Dimension(name="sessionMedium"),
            ],
            metrics=[
                Metric(name="sessions"),
                Metric(name="totalUsers"),
            ],
        ))

        sources = []
        for row in (sources_report.rows or []):
            sources.append({
                "source": row.dimension_values[0].value,
                "medium": row.dimension_values[1].value,
                "sessions": row.metric_values[0].value,
                "users": row.metric_values[1].value,
            })

        return {
            "source": "google_analytics",
            "status": "success",
            "data": {
                "date": yesterday,
                "property_id": property_id,
                "overview": overview_data,
                "sources": sources[:20],
            }
        }

    except Exception as e:
        return {"source": "google_analytics", "status": "error", "reason": str(e)}


def write(conn, result, date):
    """Write GA4 data to database. Returns records written."""
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

    if result.get("status") != "success":
        conn.commit()
        return 0

    data = result["data"]
    ov = data["overview"]
    record_date = data["date"]
    collected_at = datetime.now(timezone.utc).isoformat()
    records = 0

    def safe_int(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    def safe_float(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    conn.execute(
        "INSERT OR REPLACE INTO ga4_daily "
        "(date, sessions, total_users, new_users, page_views, "
        "avg_session_duration, bounce_rate, engagement_rate, collected_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (record_date, safe_int(ov.get("sessions")),
         safe_int(ov.get("totalUsers")), safe_int(ov.get("newUsers")),
         safe_int(ov.get("screenPageViews")),
         safe_float(ov.get("averageSessionDuration")),
         safe_float(ov.get("bounceRate")),
         safe_float(ov.get("engagementRate")), collected_at)
    )
    records += 1

    for src in data.get("sources", []):
        conn.execute(
            "INSERT OR REPLACE INTO ga4_sources "
            "(date, source, medium, sessions, users) VALUES (?, ?, ?, ?, ?)",
            (record_date, src["source"], src["medium"],
             safe_int(src["sessions"]), safe_int(src["users"]))
        )
        records += 1

    conn.commit()
    return records


if __name__ == "__main__":
    result = collect()
    if result["status"] == "success":
        ov = result["data"]["overview"]
        print(f"GA4 Data for {result['data']['date']}:")
        print(f"  Sessions: {ov.get('sessions', 'N/A')}")
        print(f"  Users: {ov.get('totalUsers', 'N/A')}")
        print(f"  Page Views: {ov.get('screenPageViews', 'N/A')}")
    else:
        print(f"{result['status']}: {result.get('reason', '')}")

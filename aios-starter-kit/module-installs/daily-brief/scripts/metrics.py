"""
Daily Brief — Funnel Metrics Builder

Reads your funnel.md and queries the database to build a structured
metrics snapshot. Each metric includes today's value and a 7-day average
for trend comparison.

This module adapts to YOUR data — it reads funnel.md to know what stages
and metrics matter for your business, then queries only the tables you have.
"""

import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent


def find_funnel_file():
    """Find the funnel.md file in the workspace.

    Checks multiple locations since ContextOS may have put it in different places
    depending on whether it's a single-business or multi-business setup.
    """
    candidates = [
        WORKSPACE_ROOT / "context" / "funnel.md",
        WORKSPACE_ROOT / "context" / "group" / "funnel.md",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def parse_funnel(funnel_path=None):
    """Parse funnel.md into a structured dict.

    Returns:
        {
            "currency": "USD",
            "stages": [
                {
                    "name": "Awareness",
                    "description": "How people discover your business.",
                    "metrics": [
                        {"label": "YouTube Views", "table": "youtube_daily", "column": "total_views"},
                        ...
                    ]
                },
                ...
            ],
            "targets": {"Revenue": "$50,000", "New customers": "10"}
        }
    """
    path = funnel_path or find_funnel_file()
    if not path or not path.exists():
        return None

    text = path.read_text()
    result = {"currency": "USD", "stages": [], "targets": {}}

    # Extract currency
    currency_match = re.search(r"## Currency\s*\n(\w+)", text)
    if currency_match:
        result["currency"] = currency_match.group(1).strip()

    # Extract stages
    stage_pattern = re.compile(
        r"### \d+\.\s*(.+?)\n(.*?)(?=### \d+\.|## Monthly Targets|## Targets|\Z)",
        re.DOTALL,
    )
    for match in stage_pattern.finditer(text):
        stage_name = match.group(1).strip()
        stage_body = match.group(2).strip()

        # Extract description (first line that isn't a metric)
        lines = stage_body.split("\n")
        description = ""
        metrics = []

        for line in lines:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            # Match metric lines: "- Label → table.column" or "- Label (table)"
            metric_match = re.match(
                r"^-\s*(.+?)\s*→\s*(\w+)\.(\w+)\s*$", line
            )
            if metric_match:
                metrics.append({
                    "label": metric_match.group(1).strip(),
                    "table": metric_match.group(2).strip(),
                    "column": metric_match.group(3).strip(),
                })
            elif not metrics and not description:
                # First non-metric line is the description
                description = line.lstrip("- ").strip()

        result["stages"].append({
            "name": stage_name,
            "description": description,
            "metrics": metrics,
        })

    # Extract targets
    targets_match = re.search(
        r"## (?:Monthly )?Targets\s*\n(.*?)(?=##|\Z)", text, re.DOTALL
    )
    if targets_match:
        for line in targets_match.group(1).strip().split("\n"):
            line = line.strip()
            target_match = re.match(r"^-\s*(.+?):\s*(.+)$", line)
            if target_match:
                result["targets"][target_match.group(1).strip()] = (
                    target_match.group(2).strip()
                )

    return result


def _table_exists(conn, name):
    """Check if a table exists in the database."""
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def _get_metric_value(conn, table, column, date):
    """Get a metric value for a specific date."""
    try:
        row = conn.execute(
            f"SELECT {column} FROM {table} WHERE date = ?", (date,)
        ).fetchone()
        return dict(row)[column] if row else None
    except Exception:
        return None


def _get_latest_value(conn, table, column):
    """Get the most recent value for a metric."""
    try:
        row = conn.execute(
            f"SELECT {column}, date FROM {table} ORDER BY date DESC LIMIT 1"
        ).fetchone()
        if row:
            r = dict(row)
            return r[column], r["date"]
        return None, None
    except Exception:
        return None, None


def _get_7day_avg(conn, table, column, end_date):
    """Calculate 7-day average for a metric ending on end_date."""
    try:
        start = (
            datetime.strptime(end_date, "%Y-%m-%d") - timedelta(days=7)
        ).strftime("%Y-%m-%d")
        rows = conn.execute(
            f"SELECT {column} FROM {table} WHERE date > ? AND date <= ?",
            (start, end_date),
        ).fetchall()
        values = [dict(r)[column] for r in rows if dict(r)[column] is not None]
        if values:
            return round(sum(values) / len(values), 1)
        return None
    except Exception:
        return None


def build_funnel_metrics(conn, target_date=None):
    """Build a complete funnel metrics snapshot from the database.

    Args:
        conn: SQLite connection (from DataOS db.py)
        target_date: YYYY-MM-DD string (default: yesterday)

    Returns:
        {
            "date": "2026-02-27",
            "currency": "USD",
            "stages": [
                {
                    "name": "Awareness",
                    "description": "...",
                    "metrics": [
                        {
                            "label": "YouTube Views",
                            "value": 15234,
                            "avg_7d": 12100,
                            "direction": "above",  # above/below/on_par
                            "date": "2026-02-27",
                        },
                        ...
                    ]
                },
                ...
            ],
            "targets": {...}
        }
    """
    if target_date is None:
        target_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    funnel = parse_funnel()
    if not funnel:
        return {"date": target_date, "currency": "USD", "stages": [], "targets": {}}

    result = {
        "date": target_date,
        "currency": funnel["currency"],
        "stages": [],
        "targets": funnel.get("targets", {}),
    }

    for stage in funnel["stages"]:
        stage_data = {
            "name": stage["name"],
            "description": stage["description"],
            "metrics": [],
        }

        for metric in stage["metrics"]:
            if not _table_exists(conn, metric["table"]):
                continue

            # Try target date first, fall back to latest
            value = _get_metric_value(
                conn, metric["table"], metric["column"], target_date
            )
            date_used = target_date

            if value is None:
                value, date_used = _get_latest_value(
                    conn, metric["table"], metric["column"]
                )

            avg_7d = _get_7day_avg(
                conn, metric["table"], metric["column"], date_used or target_date
            )

            # Determine direction vs average
            direction = "on_par"
            if value is not None and avg_7d is not None and avg_7d > 0:
                ratio = value / avg_7d
                if ratio > 1.05:
                    direction = "above"
                elif ratio < 0.95:
                    direction = "below"

            stage_data["metrics"].append({
                "label": metric["label"],
                "value": value,
                "avg_7d": avg_7d,
                "direction": direction,
                "date": date_used,
            })

        # Only include stages that have at least one metric with data
        if any(m["value"] is not None for m in stage_data["metrics"]):
            result["stages"].append(stage_data)

    return result


def format_metrics_text(metrics):
    """Format funnel metrics as plain text for the LLM prompt.

    Produces a readable summary that Gemini can use for analysis.
    """
    if not metrics or not metrics.get("stages"):
        return "No funnel metrics available."

    lines = [f"Date: {metrics['date']}", f"Currency: {metrics['currency']}", ""]

    for stage in metrics["stages"]:
        lines.append(f"{stage['name'].upper()}:")
        if stage["description"]:
            lines.append(f"  ({stage['description']})")

        for m in stage["metrics"]:
            val = m["value"]
            avg = m["avg_7d"]

            if val is None:
                lines.append(f"  {m['label']}: No data")
                continue

            # Format value
            if isinstance(val, float) and val > 1000:
                val_str = f"{val:,.0f}"
            elif isinstance(val, float):
                val_str = f"{val:.1f}"
            else:
                val_str = f"{val:,}" if isinstance(val, int) else str(val)

            # Format average
            avg_str = ""
            if avg is not None:
                if isinstance(avg, float) and avg > 1000:
                    avg_str = f" (7d avg: {avg:,.0f})"
                elif isinstance(avg, float):
                    avg_str = f" (7d avg: {avg:.1f})"
                else:
                    avg_str = f" (7d avg: {avg})"

            # Direction indicator
            arrow = ""
            if m["direction"] == "above":
                arrow = " ↑"
            elif m["direction"] == "below":
                arrow = " ↓"

            lines.append(f"  {m['label']}: {val_str}{arrow}{avg_str}")

        lines.append("")

    # Targets
    if metrics.get("targets"):
        lines.append("MONTHLY TARGETS:")
        for name, target in metrics["targets"].items():
            lines.append(f"  {name}: {target}")

    return "\n".join(lines)


if __name__ == "__main__":
    """Quick test — show funnel structure and current metrics."""
    funnel = parse_funnel()
    if funnel:
        print(f"Currency: {funnel['currency']}")
        print(f"Stages: {len(funnel['stages'])}")
        for s in funnel["stages"]:
            print(f"  {s['name']}: {len(s['metrics'])} metrics")
            for m in s["metrics"]:
                print(f"    - {m['label']} → {m['table']}.{m['column']}")
    else:
        print("No funnel.md found. Run DataOS setup first.")
        print("Checked: context/funnel.md, context/group/funnel.md")

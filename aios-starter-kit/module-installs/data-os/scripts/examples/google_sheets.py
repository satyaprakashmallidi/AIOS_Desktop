"""
DataOS — Google Sheets Collector (Example)

The universal connector — reads any Google Spreadsheet into your database via
the AIOS Google Sheets connector (Composio). No service account JSON in
.env — the user connects Google Sheets once via the Connectors page.

If Sheets isn't connected, this script prints a clear message and skips.

Copy this to scripts/collect_sheets.py (or collect_pnl.py, etc.) to activate.

Env vars (still needed — Composio doesn't know which spreadsheet you want):
    GOOGLE_SHEET_ID    — Spreadsheet ID from URL (the part between /d/ and /edit)
    GOOGLE_SHEET_TAB   — Optional. Tab name (default: first tab)

Tables created: Dynamic — named after the tab (e.g., sheet_feb_26)

NOTE: This example reads a simple date x metrics layout:
  Row 1: Headers (date, metric1, metric2, ...)
  Row 2+: Data rows
Customize the parsing for your specific sheet layout.
"""

import os
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
    """Read data from a Google Sheet via the AIOS Sheets connector."""
    sheet_id = (os.environ.get("GOOGLE_SHEET_ID") or "").strip()
    if not sheet_id:
        return {
            "source": "google_sheets", "status": "skipped",
            "reason": "Missing GOOGLE_SHEET_ID — copy the ID from your "
                      "spreadsheet URL (the part between /d/ and /edit)"
        }

    try:
        composio = Composio()
    except Exception as exc:
        return {
            "source": "google_sheets", "status": "skipped",
            "reason": f"Could not initialize AIOS Composio client: {exc}"
        }

    tab = (os.environ.get("GOOGLE_SHEET_TAB") or "").strip()

    try:
        spreadsheet = composio.execute(
            tool_slug="GOOGLESHEETS_GET_SPREADSHEET_INFO",
            args={"spreadsheetId": sheet_id},
            service="google-sheets",
        ) or {}
    except ConnectorNotConfiguredError:
        return {
            "source": "google_sheets", "status": "skipped",
            "reason": "Google Sheets is not connected. Open AIOS Desktop → Connectors → Google Sheets."
        }
    except Exception as exc:
        return {"source": "google_sheets", "status": "error", "reason": str(exc)}

    # Unwrap potential {"data": {...}} from the relay
    if isinstance(spreadsheet, dict) and "data" in spreadsheet and isinstance(spreadsheet["data"], dict):
        spreadsheet = spreadsheet["data"]

    sheets = [
        (s.get("properties") or {}).get("title", "")
        for s in (spreadsheet.get("sheets") or [])
    ]
    sheets = [s for s in sheets if s]
    if not sheets:
        return {"source": "google_sheets", "status": "error", "reason": "No tabs found in spreadsheet"}

    target_tab = tab if tab and tab in sheets else sheets[0]

    try:
        # GOOGLESHEETS_BATCH_GET takes `ranges` as an array of A1-notation ranges.
        values_resp = composio.execute(
            tool_slug="GOOGLESHEETS_BATCH_GET",
            args={"spreadsheetId": sheet_id, "ranges": [f"'{target_tab}'!A:ZZ"]},
            service="google-sheets",
        ) or {}
    except Exception as exc:
        return {"source": "google_sheets", "status": "error", "reason": str(exc)}

    if isinstance(values_resp, dict) and "data" in values_resp and isinstance(values_resp["data"], dict):
        values_resp = values_resp["data"]

    # Batch-get returns valueRanges: [{range, majorDimension, values: [...]}]
    value_ranges = values_resp.get("valueRanges") or []
    values = (value_ranges[0].get("values") if value_ranges else None) or values_resp.get("values") or []
    if not values or len(values) < 2:
        return {
            "source": "google_sheets", "status": "skipped",
            "reason": f"Sheet '{target_tab}' is empty or has only headers"
        }

    headers = [
        str(h).strip().lower().replace(" ", "_").replace("-", "_")
        for h in values[0]
    ]
    rows = []
    for row in values[1:]:
        padded = list(row) + [""] * (len(headers) - len(row))
        row_dict = {headers[i]: padded[i] for i in range(len(headers))}
        rows.append(row_dict)

    return {
        "source": "google_sheets",
        "status": "success",
        "data": {
            "tab": target_tab,
            "available_tabs": sheets,
            "headers": headers,
            "rows": rows,
            "row_count": len(rows),
        }
    }


def write(conn, result, date):
    """
    Write Google Sheets data to database. Returns records written.

    NOTE: This is a generic writer that creates a table matching your
    sheet's headers. During installation, Claude may customize the table
    name, column types, and primary key for your specific use case.
    """
    if result.get("status") != "success":
        return 0

    data = result["data"]
    headers = data["headers"]
    rows = data["rows"]

    tab_clean = data["tab"].lower().replace(" ", "_").replace("-", "_")
    table_name = f"sheet_{tab_clean}"

    columns = ", ".join(f'"{h}" TEXT' for h in headers)
    pk = ""
    if headers and "date" in headers[0]:
        pk = f', PRIMARY KEY ("{headers[0]}")'
    conn.execute(f'CREATE TABLE IF NOT EXISTS "{table_name}" ({columns}{pk})')

    records = 0
    for row in rows:
        if not any(row.values()):
            continue
        placeholders = ", ".join("?" for _ in headers)
        col_names = ", ".join(f'"{h}"' for h in headers)
        values = [row.get(h, "") for h in headers]
        conn.execute(
            f'INSERT OR REPLACE INTO "{table_name}" ({col_names}) '
            f'VALUES ({placeholders})',
            values
        )
        records += 1
    conn.commit()
    return records


if __name__ == "__main__":
    result = collect()
    if result["status"] == "success":
        data = result["data"]
        print(f"Sheet: {data['tab']} ({data['row_count']} rows)")
        print(f"Available tabs: {', '.join(data['available_tabs'])}")
        print(f"Headers: {', '.join(data['headers'])}")
        if data["rows"]:
            print(f"First row: {data['rows'][0]}")
    else:
        print(f"{result['status']}: {result.get('reason', '')}")

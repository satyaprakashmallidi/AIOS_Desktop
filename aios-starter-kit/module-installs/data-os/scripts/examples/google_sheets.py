"""
DataOS — Google Sheets Collector (Example)

The universal connector — reads any Google Spreadsheet into your database.
If your data lives in a spreadsheet (P&L, KPIs, CRM, outreach tracker),
this collector can pull it.

Copy this to scripts/collect_sheets.py (or collect_pnl.py, etc.) to activate.

Requires:
    GOOGLE_SERVICE_ACCOUNT_JSON  — Service account JSON path
    GOOGLE_SHEET_ID              — Spreadsheet ID from URL

Optional:
    GOOGLE_SHEET_TAB  — Tab name (default: first tab)

Tables created: Dynamic — named after the tab (e.g., sheet_feb_26)
Extra pip: google-api-python-client google-auth

NOTE: This example reads a simple date x metrics layout:
  Row 1: Headers (date, metric1, metric2, ...)
  Row 2+: Data rows
Customize the parsing for your specific sheet layout.
"""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

try:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
except ImportError:
    raise ImportError(
        "Missing packages — run: pip install google-api-python-client google-auth"
    )


def _get_sheets_service():
    """Create an authenticated Google Sheets API client."""
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
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    return build("sheets", "v4", credentials=creds)


def collect():
    """Read data from a Google Sheet."""
    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not sheet_id:
        return {
            "source": "google_sheets", "status": "skipped",
            "reason": "Missing GOOGLE_SHEET_ID — copy the ID from your "
                      "spreadsheet URL (the part between /d/ and /edit)"
        }

    service = _get_sheets_service()
    if not service:
        return {
            "source": "google_sheets", "status": "skipped",
            "reason": "Missing or invalid GOOGLE_SERVICE_ACCOUNT_JSON"
        }

    tab = os.getenv("GOOGLE_SHEET_TAB", "").strip()

    try:
        # Get available tabs
        spreadsheet = service.spreadsheets().get(
            spreadsheetId=sheet_id
        ).execute()
        sheets = [
            s["properties"]["title"]
            for s in spreadsheet.get("sheets", [])
        ]

        # Use specified tab or first tab
        target_tab = tab if tab and tab in sheets else sheets[0]

        # Read all data from the tab
        result = service.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=f"'{target_tab}'!A:ZZ"
        ).execute()
        values = result.get("values", [])

        if not values or len(values) < 2:
            return {
                "source": "google_sheets", "status": "skipped",
                "reason": f"Sheet '{target_tab}' is empty or has only headers"
            }

        # Parse: first row = headers, rest = data
        headers = [
            str(h).strip().lower().replace(" ", "_").replace("-", "_")
            for h in values[0]
        ]
        rows = []
        for row in values[1:]:
            padded = row + [""] * (len(headers) - len(row))
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

    except Exception as e:
        return {"source": "google_sheets", "status": "error", "reason": str(e)}


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

    # Table name derived from the tab (e.g., "Feb 26" -> "sheet_feb_26")
    tab_clean = data["tab"].lower().replace(" ", "_").replace("-", "_")
    table_name = f"sheet_{tab_clean}"

    # Build CREATE TABLE with all TEXT columns
    # (customize column types for your specific sheet)
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

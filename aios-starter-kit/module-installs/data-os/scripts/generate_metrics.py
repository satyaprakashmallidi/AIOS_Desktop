"""
DataOS — Key Metrics Generator

Reads the database and generates a human-readable key-metrics.md file.
This file is loaded by your /prime command so your AI always has fresh data.

Automatically discovers which tables exist and generates sections for each.
Claude will customize this file during installation to match your data sources.

Usage:
    python scripts/generate_metrics.py
"""

import sqlite3
from datetime import datetime
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = WORKSPACE_ROOT / "data" / "data.db"
OUTPUT_PATH = WORKSPACE_ROOT / "context" / "group" / "key-metrics.md"


# --- Formatting helpers ---

def fmt_number(value, prefix="", suffix=""):
    """Format a number with commas. Returns 'No data' if None."""
    if value is None:
        return "No data"
    if isinstance(value, float):
        return f"{prefix}{value:,.0f}{suffix}"
    return f"{prefix}{value:,}{suffix}"


def fmt_currency(value, symbol="$"):
    """Format currency value with symbol and commas."""
    if value is None:
        return "No data"
    return f"{symbol}{value:,.0f}"


def fmt_pct(value):
    """Format a percentage to 1 decimal place."""
    if value is None:
        return "No data"
    return f"{value:.1f}%"


def query_one(conn, sql):
    """Query helper — returns first row as dict or None."""
    try:
        row = conn.execute(sql).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def query_all(conn, sql):
    """Query helper — returns all rows as list of dicts."""
    try:
        return [dict(r) for r in conn.execute(sql).fetchall()]
    except Exception:
        return []


def table_exists(conn, name):
    """Check if a table exists."""
    r = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return r is not None


# ============================================================
# SECTION GENERATORS
# Each function returns a list of markdown lines for its section.
# Claude will add custom section functions here during installation.
# ============================================================


def section_fx_rates(conn):
    """FX rates — the starter collector (always available)."""
    if not table_exists(conn, "fx_rates"):
        return []
    lines = []
    lines.append("## Exchange Rates")
    lines.append("| Currency | Rate (from USD) | As Of |")
    lines.append("|----------|----------------|-------|")
    rows = query_all(conn, """
        SELECT date, currency, rate FROM fx_rates
        WHERE date = (SELECT MAX(date) FROM fx_rates)
        ORDER BY currency
    """)
    for r in rows:
        lines.append(f"| {r['currency']} | {r['rate']:.4f} | {r['date']} |")
    lines.append("")
    return lines


# --- CUSTOMIZATION ZONE ---
# Claude adds your custom section functions below during installation.
# Each follows the same pattern:
#
#   def section_NAME(conn):
#       if not table_exists(conn, "TABLE_NAME"):
#           return []
#       lines = ["## Section Title", "| Metric | Value | As Of |", ...]
#       row = query_one(conn, "SELECT ... FROM TABLE_NAME ORDER BY date DESC LIMIT 1")
#       if row:
#           lines.append(f"| Metric | {fmt_number(row['value'])} | {row['date']} |")
#       return lines


# ============================================================
# MAIN GENERATOR
# ============================================================

# Register all section functions here. Claude adds new ones during install.
SECTIONS = [
    section_fx_rates,
    # section_youtube,
    # section_stripe,
    # section_google_analytics,
    # section_marketing,
]


def generate(conn):
    """Generate the key-metrics markdown content."""
    today = datetime.now().strftime("%Y-%m-%d")
    lines = [
        "# Key Metrics",
        "",
        f"> Auto-generated from database. Last updated: {today}",
        f"> Source: `data/data.db` | Regenerate: `python scripts/generate_metrics.py`",
        "",
    ]

    # Run all registered section generators
    for section_fn in SECTIONS:
        try:
            section_lines = section_fn(conn)
            if section_lines:
                lines.extend(section_lines)
        except Exception as e:
            lines.append(f"<!-- Error in {section_fn.__name__}: {e} -->")
            lines.append("")

    # Data freshness table (auto-discovers all tables)
    lines.append("## Data Freshness")
    lines.append("| Source | Latest Record | Status |")
    lines.append("|--------|---------------|--------|")

    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name != 'collection_log' AND name NOT LIKE 'sqlite_%' "
        "ORDER BY name"
    ).fetchall()

    for t in tables:
        name = t["name"]
        try:
            row = conn.execute(f"SELECT MAX(date) as d FROM {name}").fetchone()
            if row and row["d"]:
                lines.append(f"| {name} | {row['d']} | Connected |")
            else:
                lines.append(f"| {name} | — | Empty |")
        except Exception:
            lines.append(f"| {name} | — | No date column |")

    lines.append("")
    return "\n".join(lines)


def main():
    """Generate key-metrics.md from the database."""
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        print("Run collection first: python scripts/collect.py")
        return

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    content = generate(conn)
    conn.close()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content)
    print(f"Key metrics written to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

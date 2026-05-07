# DataOS — AIOS Module Installer

> A plug-and-play module from the Phanindra Reddy, AIOS, powered by magicteams.ai .


<!-- MODULE METADATA
module: data-os
version: v1
status: RELEASED
released: 2026-02-27
requires: [context-os]
phase: 1
category: Core OS
complexity: complex
api_keys: 1-7 (depends on your sources)
setup_time: 30-60 minutes
-->

---

## FOR CLAUDE

You are helping a user install DataOS — their business data warehouse. Follow these rules:

**This is a GUIDED WORKSHOP, not just an install.** You are not blindly copying files. You are walking the user through a discovery process where you learn about their business, map their data sources, and build a CUSTOM data pipeline tailored to their exact setup.

**Behavior:**
- Assume the user is non-technical unless they tell you otherwise
- Explain what you are doing at each step in plain English BEFORE doing it
- Celebrate small wins ("API key verified — nice, that's the hardest part done!")
- If something fails, do not dump error logs — explain the problem simply and suggest the fix
- Never skip verification steps — if a check fails, stop and help the user fix it
- Use encouraging language throughout — they are building something real

**Pacing:**
- Do NOT rush. Pause after major milestones.
- After the discovery workshop: "Great, we've mapped your data landscape. Ready to start building?"
- After the foundation is built: "Pipeline framework is live — the hard part is done. Now we connect your actual data."
- After each collector: "That source is connected! Let me show you what's in the database now."
- After the full pipeline works: "Your data warehouse is running. Here's what you just built."

**Discovery Workshop (Phase 1):**
- Start by reading the user's ContextOS files (context/overview.md, context/strategy.md, context/team.md) to understand their business
- If ContextOS is not installed, ask 3-4 questions: What does your business do? How do customers find you? What tools/platforms do you use day to day? Where does your revenue come from?
- Based on what you learn, SUGGEST data sources — do not wait for the user to name them
- Present the plan before building — get a "yes" before you start writing files

**Custom Collector Building:**
- Example collectors are in `scripts/examples/`. Read them as PATTERNS, not copy-paste targets.
- Adapt every collector for the user's specific setup (column names, metrics, table structure)
- For data sources NOT in the examples directory, search the web for API documentation and build a custom collector from scratch following the same pattern: `collect() -> dict`, `write(conn, result, date) -> int`
- Every collector must handle missing credentials gracefully (return status="skipped") and never break the pipeline

**Error handling:**
- If Python version is too old: provide exact upgrade instructions for their OS
- If an API key is invalid: walk them through getting a new one step by step
- If pip install fails: try (1) upgrade pip, (2) install build tools, (3) specific fix
- If any command fails: explain what went wrong in one sentence, then provide the fix
- Never say "check the logs" — find the problem and explain it

**Key concepts to reinforce throughout:**
- **Snapshot strategy:** Most APIs give current totals, not historical deltas. We take daily snapshots and calculate changes by comparing dates. This is why daily runs matter.
- **Month-to-date:** The most useful business metric. "Are we doing better this month than last month?" — key-metrics.md answers that.
- **Graceful degradation:** If a credential is missing, that collector is skipped — everything else still runs. The pipeline never fully breaks.

---

## OVERVIEW

Your business data is scattered across a dozen platforms — Stripe for revenue, YouTube for content metrics, Google Analytics for traffic, spreadsheets for P&L. Every time you want to know how things are going, you have to log into five different dashboards and piece the picture together manually.

DataOS fixes that. It pipes all of your data into one local SQLite database on your machine. A single collection script runs every morning, pulls fresh numbers from all your connected sources, and writes them as daily snapshots. Over time, you build a dataset that shows exactly how your business is trending — week over week, month over month.

The real magic: your AI reads this data. Every time you start a Claude Code session and run `/prime`, it loads a freshly generated `key-metrics.md` file with your latest numbers. Your AI knows your revenue, your traffic, your subscriber growth, your churn rate — before you even ask.

**What you'll have when this is done:**
- A local SQLite database collecting daily snapshots of your business metrics
- Automated collectors for each of your data sources (1-7 depending on your tools)
- A `key-metrics.md` file that refreshes with every collection, loaded by `/prime`
- A daily cron job that runs everything automatically while you sleep

**Setup time:** 30-60 minutes (depends on how many data sources you connect)
**Running cost:** Free. All APIs used have free tiers sufficient for daily collection.

---

## PHASE 1: DISCOVERY WORKSHOP

> This is the most important phase. We figure out what to build BEFORE we build it.

### Step 1: Understand the Business

First, let me understand what your business looks like.

Read the user's ContextOS files if they exist:
- `context/overview.md` — what the business does
- `context/strategy.md` — current priorities and goals
- `context/team.md` — who's involved

If these files do not exist or ContextOS is not installed yet, ask:

1. **What does your business do?** (AI agency, content creator, SaaS, coaching, e-commerce — just the basics)
2. **How do customers find you?** (YouTube, social media, ads, referrals, cold outreach)
3. **What tools and platforms do you use day to day?** (Stripe, Google Analytics, spreadsheets, CRM, email marketing)
4. **Where does your revenue come from?** (Subscriptions, one-time sales, retainers, courses, consulting)

### Step 2: Map the Funnel

Walk through their business funnel stage by stage. For each stage, identify WHERE that data currently lives:

**Top of Funnel — How do customers find you?**
- Content: YouTube, TikTok, blog, podcast
- Ads: Google Ads, Meta Ads, LinkedIn Ads
- Outreach: cold email, LinkedIn DMs, referral partners

**Middle of Funnel — How do they engage?**
- Website visits (Google Analytics)
- Community joins (Skool, Discord, Circle)
- Lead magnets / opt-ins (email tool)
- Link clicks (Bitly, UTM tracking)

**Bottom of Funnel — How do they convert?**
- Bookings (Calendly)
- Applications / forms (Typeform, Google Forms)
- Demo requests, DMs, proposals

**Revenue — Where does money come from?**
- Payment processing (Stripe, PayPal, invoicing)
- Subscription management (Stripe, Chargebee)
- Financial tracking (P&L spreadsheet, QuickBooks, Xero)

### Step 3: Identify Data Sources

Based on what you learned in Steps 1-2, present a suggested list of data sources to connect. Organize them by funnel stage:

Example output:
```
Based on your business, here are the data sources I'd recommend connecting:

CONTENT & TRAFFIC
[ ] YouTube — channel stats, video performance (free API key)
[ ] Google Analytics — website traffic and sources (service account)

REVENUE
[ ] Stripe — revenue, subscriptions, MRR (free API key)
[ ] P&L Spreadsheet — monthly financials (service account, same as GA)

MARKETING
[ ] Bitly — link click tracking across content (free API key)

That's 5 sources. Total setup time: ~40 minutes.
```

Ask: **"Did I miss anything? Any other tools where your business data lives?"**

Adjust the list based on their response.

### Step 4: Plan the Connections

For each selected source, briefly explain:
- What authentication is needed (API key, OAuth, service account)
- What data you'll collect
- Estimated time to set up that source (~5-10 minutes each)

Note which sources share credentials (Google Analytics + Google Sheets both use the same service account).

Present the total estimated setup time.

Ask: **"Here's the plan. Ready to start building?"**

[VERIFY] User has confirmed which data sources to connect and is ready to proceed.

---

## PHASE 2: FOUNDATION

### Prerequisites

#### Python 3.10+
```bash
python3 --version
```
Expected: `Python 3.10.x` or higher.

If not installed or too old:
- **macOS:** `brew install python@3.12` (install Homebrew first if needed: https://brew.sh)
- **Linux (Ubuntu/Debian):** `sudo apt update && sudo apt install python3.12 python3.12-venv`
- **Linux (Fedora):** `sudo dnf install python3.12`

#### Claude Code CLI
```bash
claude --version
```
If not installed:
```bash
npm install -g @anthropic-ai/claude-code
```
If npm is not installed, install Node.js first: https://nodejs.org

[VERIFY] Both commands should show version numbers without errors.
Ask: "Everything checks out. Ready to build the foundation?"

---

### Step 1: Create the Workspace Folder Structure

If the user already has a workspace directory (from ContextOS), use it. Otherwise, create one.

```bash
mkdir -p scripts/examples data context/group credentials config
```

This creates:
- `scripts/` — where all your collection scripts live
- `scripts/examples/` — reference implementations for common data sources
- `data/` — where the SQLite database will be stored
- `context/group/` — where key-metrics.md gets generated
- `credentials/` — for service account JSON files (this folder should be gitignored)
- `config/` — for scheduling configuration

If a `.gitignore` exists, make sure it includes:
```
.env
credentials/
data/*.db
```

[VERIFY]
```bash
ls -la scripts/ data/ context/group/ credentials/
```
All directories should exist.

---

### Step 2: Set Up Python Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Create `scripts/requirements.txt`:
```
python-dotenv>=1.0.0
requests>=2.31.0
```

Install base dependencies:
```bash
pip install -r scripts/requirements.txt
```

[VERIFY]
```bash
.venv/bin/python -c "from dotenv import load_dotenv; import requests; print('Base dependencies OK')"
```
Expected: `Base dependencies OK`

---

### Step 3: Install the Database Framework

Create `scripts/db.py` — this is the heart of DataOS. It manages your SQLite database, creates tables, and provides query helpers.

```python
"""
DataOS — Database Framework

Local SQLite database for your business data warehouse.
Creates the database, manages connections, and provides query helpers.

Each collector creates its own tables when first run — no need to
define the schema upfront. The database grows as you add collectors.
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# Database lives in data/ directory at workspace root
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = WORKSPACE_ROOT / "data" / "data.db"


def init_db():
    """
    Initialize the database. Creates it if it doesn't exist.
    Returns a connection with WAL mode and row factory enabled.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    # Collection log — tracks every collection run
    conn.execute("""
        CREATE TABLE IF NOT EXISTS collection_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collected_at TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT,
            records_written INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    return conn


def get_connection():
    """Get a database connection. Initializes DB if needed."""
    if not DB_PATH.exists():
        return init_db()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def log_collection(conn, source, status, records=0, reason=None):
    """Log a collection run to the collection_log table."""
    conn.execute(
        "INSERT INTO collection_log (collected_at, source, status, reason, records_written) "
        "VALUES (?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), source, status, reason, records)
    )
    conn.commit()


def query_one(conn, sql, params=None):
    """Execute a query and return the first row as a dict, or None."""
    try:
        row = conn.execute(sql, params or ()).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def query_all(conn, sql, params=None):
    """Execute a query and return all rows as a list of dicts."""
    try:
        rows = conn.execute(sql, params or ()).fetchall()
        return [dict(row) for row in rows]
    except Exception:
        return []


def table_exists(conn, table_name):
    """Check if a table exists in the database."""
    result = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    ).fetchone()
    return result is not None


def get_latest_date(conn, table_name, date_column="date"):
    """Get the most recent date in a table. Returns string or None."""
    try:
        row = conn.execute(
            f"SELECT MAX({date_column}) as d FROM {table_name}"
        ).fetchone()
        return row["d"] if row else None
    except Exception:
        return None


def get_table_list(conn):
    """List all user tables (excludes sqlite internals and collection_log)."""
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' AND name != 'collection_log' "
        "ORDER BY name"
    ).fetchall()
    return [row["name"] for row in rows]


if __name__ == "__main__":
    # Quick test — creates the database and shows its state
    conn = init_db()
    print(f"Database initialized at: {DB_PATH}")
    print(f"Size: {DB_PATH.stat().st_size / 1024:.1f} KB")
    tables = get_table_list(conn)
    print(f"Tables: {tables if tables else '(none yet — run a collector to create tables)'}")
    conn.close()
```

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python scripts/db.py
```
Expected: `Database initialized at: .../data/data.db` with size shown and empty table list.

---

### Step 4: Install the Configuration Loader

Create `scripts/config.py` — loads API keys from your `.env` file so collectors can use them.

```python
"""
DataOS — Configuration Loader

Reads credentials from .env file in workspace root.
Provides helpers for loading API keys and Google credentials.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from workspace root (one level up from scripts/)
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = WORKSPACE_ROOT / ".env"

load_dotenv(ENV_PATH)


def get_env(key, required=True):
    """
    Get an environment variable. Returns None if not set.
    Callers handle missing credentials gracefully (skip the collector).
    """
    value = os.getenv(key, "").strip()
    if not value:
        return None
    return value


def get_google_credentials_path():
    """
    Get the path to the Google service account JSON file.
    Resolves relative paths against the workspace root.
    """
    path = get_env("GOOGLE_SERVICE_ACCOUNT_JSON")
    if path is None:
        return None
    full_path = Path(path)
    if not full_path.is_absolute():
        full_path = WORKSPACE_ROOT / path
    if not full_path.exists():
        return None
    return str(full_path)
```

---

### Step 5: Install the Collection Orchestrator

Create `scripts/collect.py` — this is the script you run to collect data from ALL your sources. It automatically discovers any `collect_*.py` file in the scripts directory and runs them.

```python
"""
DataOS — Collection Orchestrator

Discovers and runs all active collectors (collect_*.py files in this directory).
After collection, regenerates key-metrics.md so your /prime always has fresh data.

Usage:
    python scripts/collect.py                          # Run all collectors
    python scripts/collect.py --sources youtube,stripe  # Run specific ones
    python scripts/collect.py --date 2026-02-20         # Override date
"""

import sys
import os
import argparse
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def discover_collectors():
    """Find all collect_*.py files in the scripts directory."""
    collectors = {}
    for filepath in sorted(SCRIPT_DIR.glob("collect_*.py")):
        # Skip this orchestrator file
        if filepath.name == "collect.py":
            continue
        # Extract source name: collect_youtube.py -> youtube
        name = filepath.stem.replace("collect_", "")
        collectors[name] = filepath
    return collectors


def import_collector(name, filepath):
    """Dynamically import a collector module."""
    spec = importlib.util.spec_from_file_location(f"collect_{name}", str(filepath))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    parser = argparse.ArgumentParser(description="Collect data from all sources")
    parser.add_argument(
        "--sources", type=str, default=None,
        help="Comma-separated list of sources to run (default: all)"
    )
    parser.add_argument(
        "--date", type=str, default=None,
        help="Override collection date (YYYY-MM-DD, default: today)"
    )
    args = parser.parse_args()

    today = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # Discover available collectors
    available = discover_collectors()
    if not available:
        print(f"[{timestamp}] No collectors found. Add collect_*.py files to scripts/",
              file=sys.stderr)
        sys.exit(1)

    # Determine which to run
    if args.sources:
        names = [s.strip() for s in args.sources.split(",")]
        unknown = [s for s in names if s not in available]
        if unknown:
            print(f"[{timestamp}] Unknown sources ignored: {', '.join(unknown)}",
                  file=sys.stderr)
        names = [s for s in names if s in available]
    else:
        names = list(available.keys())

    # Initialize database
    sys.path.insert(0, str(SCRIPT_DIR))
    from db import init_db, log_collection

    conn = init_db()
    print(f"[{timestamp}] Collection started — {len(names)} sources for date={today}",
          file=sys.stderr)

    results = []
    for name in names:
        filepath = available[name]
        print(f"  Collecting {name}...", file=sys.stderr, end="")

        try:
            mod = import_collector(name, filepath)
            result = mod.collect()
            status = result.get("status", "unknown")

            if status == "success":
                records = mod.write(conn, result, today)
                log_collection(conn, name, "success", records)
                print(f" OK ({records} records)", file=sys.stderr)
                results.append((name, "success", records))
            elif status == "skipped":
                reason = result.get("reason", "")
                log_collection(conn, name, "skipped", reason=reason)
                print(f" SKIPPED ({reason})", file=sys.stderr)
                results.append((name, "skipped", 0))
            else:
                reason = result.get("reason", "")
                log_collection(conn, name, "error", reason=reason)
                print(f" ERROR ({reason})", file=sys.stderr)
                results.append((name, "error", 0))

        except Exception as e:
            log_collection(conn, name, "exception", reason=str(e))
            print(f" EXCEPTION ({e})", file=sys.stderr)
            results.append((name, "exception", 0))

    conn.close()

    # Summary
    successes = sum(1 for _, s, _ in results if s == "success")
    total_records = sum(r for _, _, r in results)
    skipped = sum(1 for _, s, _ in results if s == "skipped")
    errors = sum(1 for _, s, _ in results if s in ("error", "exception"))

    summary = (f"[{timestamp}] Done: {successes} success, "
               f"{skipped} skipped, {errors} errors, {total_records} total records")
    print(summary, file=sys.stderr)
    print(summary)

    # Post-collection: regenerate key metrics
    if successes > 0:
        try:
            from generate_metrics import main as regen
            regen()
            print(f"[{timestamp}] Key metrics regenerated", file=sys.stderr)
        except Exception as e:
            print(f"[{timestamp}] Warning: metrics regen failed: {e}", file=sys.stderr)

    sys.exit(0 if successes > 0 else 1)


if __name__ == "__main__":
    main()
```

---

### Step 6: Install the Key Metrics Generator

Create `scripts/generate_metrics.py` — this reads your database and generates a human-readable `key-metrics.md` file that your `/prime` command loads every session.

```python
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
```

---

### Step 7: Install the Starter Collector

Create `scripts/collect_fx_rates.py` — this is the zero-auth starter collector that proves the pipeline works.

```python
"""
DataOS — FX Rates Collector (Starter)

Fetches foreign exchange rates from the Frankfurter API (European Central Bank data).
No API key needed — this is the perfect first collector to test your pipeline.

Tables created: fx_rates
"""

import sqlite3
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    raise ImportError(
        "Missing 'requests' package — run: pip install requests"
    )

API_URL = "https://api.frankfurter.app/latest"

# Customize this list to the currencies you care about
TARGET_CURRENCIES = ["NZD", "AUD", "GBP", "EUR", "CAD", "SGD", "JPY"]


def collect():
    """Fetch latest FX rates. No authentication needed."""
    try:
        currencies = ",".join(TARGET_CURRENCIES)
        response = requests.get(
            f"{API_URL}?from=USD&to={currencies}", timeout=10
        )
        response.raise_for_status()
        data = response.json()

        return {
            "source": "fx_rates",
            "status": "success",
            "data": {
                "base": data.get("base", "USD"),
                "date": data.get("date"),
                "rates": data.get("rates", {}),
            }
        }
    except Exception as e:
        return {"source": "fx_rates", "status": "error", "reason": str(e)}


def write(conn, result, date):
    """Write FX rates to database. Returns records written."""
    # Create table if it doesn't exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fx_rates (
            date TEXT NOT NULL,
            currency TEXT NOT NULL,
            rate REAL NOT NULL,
            base TEXT DEFAULT 'USD',
            collected_at TEXT,
            PRIMARY KEY (date, currency)
        )
    """)

    if result.get("status") != "success":
        conn.commit()
        return 0

    data = result["data"]
    rates = data.get("rates", {})
    rate_date = data.get("date", date)
    collected_at = datetime.now(timezone.utc).isoformat()
    records = 0

    for currency, rate in rates.items():
        conn.execute(
            "INSERT OR REPLACE INTO fx_rates "
            "(date, currency, rate, base, collected_at) VALUES (?, ?, ?, ?, ?)",
            (rate_date, currency, rate, "USD", collected_at)
        )
        records += 1

    conn.commit()
    return records


if __name__ == "__main__":
    # Quick test — run this to verify the pipeline works
    result = collect()
    if result["status"] == "success":
        print(f"FX Rates for {result['data']['date']}:")
        for curr, rate in sorted(result["data"]["rates"].items()):
            print(f"  USD -> {curr}: {rate:.4f}")
    else:
        print(f"Error: {result.get('reason')}")
```

---

### Step 8: Test the Pipeline

This is the moment of truth. Let's run the full collection pipeline and make sure everything works.

```bash
cd /path/to/workspace && .venv/bin/python scripts/collect.py --sources fx_rates
```

[VERIFY] Expected output (on stderr):
```
  Collecting fx_rates... OK (7 records)
[...] Done: 1 success, 0 skipped, 0 errors, 7 total records
```

Now verify the database has data:
```bash
.venv/bin/python scripts/db.py
```

[VERIFY] Expected: Database shows `fx_rates` table in the list.

Now generate key metrics:
```bash
.venv/bin/python scripts/generate_metrics.py
```

[VERIFY] Expected: `Key metrics written to: .../context/group/key-metrics.md`

Read the file and show it to the user — they should see an Exchange Rates table with current rates and a Data Freshness section showing `fx_rates | today's date | Connected`.

**Milestone:** "Your pipeline works! That's the hard part done — the framework is installed, the database is live, and the metrics generator is running. Everything from here is just connecting your real data sources one at a time. Ready?"

---

## PHASE 3: CONNECT DATA SOURCES

> Only follow the sections below that match what the user selected in Phase 1.
> Skip everything else. Each section is independent — do them in any order.
> After each source is connected, run a collection test before moving to the next.

---

### Create the .env File

Before connecting any sources, create the `.env` file at the workspace root. Start with the template and fill in values as we go through each source.

```bash
# Create .env from the template
cp scripts/.env.example .env 2>/dev/null || touch .env
```

If `.env.example` does not exist, create `.env` with this starter content:
```
# DataOS — Environment Configuration
# Fill in values for the data sources you're connecting.
# Empty values are skipped — only fill in what you use.
```

We'll add credentials to this file as we set up each source.

---

### SOURCE: YouTube

> Skip this section if the user did not select YouTube in Phase 1.

**What you'll get:** Daily channel snapshots (subscribers, total views, video count) plus performance data for every video published in the last 30 days (views, likes, comments).

**What you need:**
- A YouTube API key (free, takes 3 minutes)
- Your YouTube channel ID

**Extra packages:**
```bash
.venv/bin/pip install google-api-python-client google-auth
```

#### Get Your YouTube API Key

1. Go to https://console.cloud.google.com/apis/credentials
2. If you don't have a Google Cloud project yet, click "Create Project" at the top, name it anything (e.g., "My Data Pipeline"), and click Create
3. Once you're in the project, click "+ CREATE CREDENTIALS" at the top
4. Select "API key"
5. Copy the key that appears (it looks like `AIzaSy...`)
6. Click "Close"
7. Now enable the YouTube Data API: go to https://console.cloud.google.com/apis/library/youtube.googleapis.com
8. Click "Enable"

Save the key to `.env`:
```
YOUTUBE_API_KEY=your_key_here
```

[VERIFY]
```bash
.venv/bin/python -c "
import os; from dotenv import load_dotenv; load_dotenv()
key = os.getenv('YOUTUBE_API_KEY', '')
import requests
r = requests.get(f'https://www.googleapis.com/youtube/v3/channels?part=id&mine=false&key={key}&id=UC')
print('API key valid!' if r.status_code != 403 else 'API key INVALID — check the key')
"
```

#### Get Your Channel ID

1. Go to https://www.youtube.com and sign in
2. Click your profile picture (top right) > "View your channel"
3. Look at the URL — it will be `youtube.com/channel/UCxxxxxxx` or `youtube.com/@yourhandle`
4. If it shows a handle (@name), go to https://www.youtube.com/account_advanced to find your Channel ID (starts with `UC`)

Save to `.env`:
```
YOUTUBE_CHANNEL_ID=your_channel_id_here
```

#### Install the YouTube Collector

Read the example collector at `scripts/examples/youtube.py` and copy it to `scripts/collect_youtube.py`.

Customize for the user:
- Update the `TARGET_CURRENCIES` equivalent (not applicable here, but check if they want to track specific video IDs or playlists)
- The default collector tracks the last 30 days of videos — this works for most creators

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python scripts/collect_youtube.py
```
Expected: Shows channel name, subscriber count, recent video count.

Then run through the pipeline:
```bash
.venv/bin/python scripts/collect.py --sources youtube
```
Expected: `Collecting youtube... OK (X records)`

**"YouTube is connected! You're now tracking subscribers, views, and video performance daily."**

---

### SOURCE: Stripe

> Skip this section if the user did not select Stripe in Phase 1.

**What you'll get:** Daily snapshots of MRR, active subscriptions, new subscriptions, cancellations, churn rate, and month-to-date revenue. Supports multiple Stripe accounts.

**What you need:**
- A Stripe API key (restricted, read-only)

**Extra packages:**
```bash
.venv/bin/pip install stripe
```

#### Get Your Stripe API Key

1. Go to https://dashboard.stripe.com/apikeys
2. Under "Standard keys", find "Secret key" and click "Reveal test key" to see the format
3. For production data, you need the **live** secret key — but we recommend creating a **restricted key** instead:
   - Click "+ Create restricted key"
   - Name it "DataOS Read Only"
   - Set ALL permissions to **Read** (not Write)
   - The key resources you need read access to: Charges, Customers, Subscriptions, Balance
   - Click "Create key"
   - Copy the key (starts with `rk_live_...`)

Save to `.env`:
```
STRIPE_API_KEY_MAIN=rk_live_your_key_here
```

**Multiple Stripe accounts:** If you have more than one Stripe account (e.g., one for agency revenue, one for a SaaS product), add each on a separate line:
```
STRIPE_API_KEY_AGENCY=rk_live_...
STRIPE_API_KEY_SAAS=rk_live_...
```
The collector automatically discovers and collects from all `STRIPE_API_KEY_*` entries.

[VERIFY]
```bash
.venv/bin/python -c "
import os; from dotenv import load_dotenv; load_dotenv()
import stripe
keys = {k: v for k, v in os.environ.items() if k.startswith('STRIPE_API_KEY_') and v.strip()}
for name, key in keys.items():
    stripe.api_key = key
    try:
        acct = stripe.Account.retrieve()
        print(f'{name}: Connected ({acct.get(\"business_profile\", {}).get(\"name\", \"OK\")})')
    except Exception as e:
        print(f'{name}: FAILED — {e}')
"
```
Expected: Each account shows "Connected" with the business name.

#### Install the Stripe Collector

Read the example collector at `scripts/examples/stripe.py` and copy it to `scripts/collect_stripe.py`.

Customize for the user:
- If they use a single currency, note it. If they have multi-currency accounts, the collector auto-detects each account's default currency.
- The default tracks MRR, revenue MTD, active/new/canceled subs, and churn rate.

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python scripts/collect_stripe.py
```
Expected: Shows MRR, revenue MTD, active subscriptions for each account.

Then run through the pipeline:
```bash
.venv/bin/python scripts/collect.py --sources stripe
```
Expected: `Collecting stripe... OK (X records)`

**"Stripe is connected! Revenue, MRR, and subscription metrics are now tracked daily."**

---

### SOURCE: Google Service Account (Shared Setup)

> This section is needed if the user selected Google Analytics, Google Sheets, or both.
> Only do this once — the same service account works for all Google sources.

**What this is:** A Google Service Account is like a robot user that can read your Google data. It's used by both the Google Analytics and Google Sheets collectors.

1. Go to https://console.cloud.google.com
2. If you don't have a project yet, create one (or use the same one from YouTube setup)
3. In the left sidebar, go to **IAM & Admin** > **Service Accounts**
4. Click **"+ CREATE SERVICE ACCOUNT"** at the top
5. Name: `dataos-reader` (or anything you like)
6. Description: "Read-only access for data collection"
7. Click **"Create and Continue"**
8. For Role, you can skip this (click "Continue") — we'll grant access at the individual service level
9. Click **"Done"**
10. You'll see your new service account in the list. Click on its email address.
11. Go to the **"Keys"** tab
12. Click **"Add Key"** > **"Create new key"**
13. Select **JSON** and click **"Create"**
14. A JSON file will download — this is your credentials file

Save the JSON file:
```bash
# Move the downloaded file to your credentials folder
cp ~/Downloads/your-project-name-*.json credentials/google-service-account.json
```

Add to `.env`:
```
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/google-service-account.json
```

**Important:** Note the email address of your service account (looks like `dataos-reader@your-project.iam.gserviceaccount.com`). You'll need to share access with this email for Google Sheets and Google Analytics.

Now enable the APIs you need:
- **If using Google Sheets:** Go to https://console.cloud.google.com/apis/library/sheets.googleapis.com and click "Enable"
- **If using Google Analytics:** Go to https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com and click "Enable"
- **If using YouTube (and haven't already):** Go to https://console.cloud.google.com/apis/library/youtube.googleapis.com and click "Enable"

[VERIFY]
```bash
.venv/bin/python -c "
import json; from pathlib import Path
p = Path('credentials/google-service-account.json')
if p.exists():
    data = json.loads(p.read_text())
    print(f'Service account: {data.get(\"client_email\", \"unknown\")}')
    print(f'Project: {data.get(\"project_id\", \"unknown\")}')
    print('Credentials file is valid!')
else:
    print('ERROR: credentials/google-service-account.json not found')
"
```
Expected: Shows service account email and project name.

---

### SOURCE: Google Analytics (GA4)

> Skip this section if the user did not select Google Analytics in Phase 1.
> Requires: Google Service Account setup (see above).

**What you'll get:** Daily website traffic snapshots — sessions, users, new users, page views, bounce rate, engagement rate — plus a breakdown of traffic sources (where visitors come from).

**What you need:**
- Google Service Account (set up above)
- Your GA4 Property ID

**Extra packages:**
```bash
.venv/bin/pip install google-analytics-data google-auth
```

#### Get Your GA4 Property ID

1. Go to https://analytics.google.com
2. Click the gear icon (Admin) in the bottom left
3. In the "Property" column, click **"Property Settings"**
4. Your Property ID is at the top — it's a number like `123456789`

Save to `.env`:
```
GA4_PROPERTY_ID=your_property_id_here
```

#### Grant Access to Your Service Account

1. In Google Analytics, go to Admin (gear icon)
2. In the "Property" column, click **"Property Access Management"**
3. Click the **"+"** button at the top right > **"Add users"**
4. Enter your service account email (the one from the Google Service Account setup)
5. Set role to **"Viewer"** (read-only is all we need)
6. Click **"Add"**

[VERIFY]
```bash
.venv/bin/python -c "
import os; from dotenv import load_dotenv; load_dotenv()
from pathlib import Path
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.oauth2.service_account import Credentials

creds_path = Path(os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON', ''))
if not creds_path.is_absolute():
    creds_path = Path.cwd() / creds_path

prop_id = os.getenv('GA4_PROPERTY_ID', '')
creds = Credentials.from_service_account_file(str(creds_path), scopes=['https://www.googleapis.com/auth/analytics.readonly'])
client = BetaAnalyticsDataClient(credentials=creds)
from google.analytics.data_v1beta.types import DateRange, Metric, RunReportRequest
resp = client.run_report(RunReportRequest(
    property=f'properties/{prop_id}',
    date_ranges=[DateRange(start_date='yesterday', end_date='yesterday')],
    metrics=[Metric(name='sessions')]
))
sessions = resp.rows[0].metric_values[0].value if resp.rows else '0'
print(f'GA4 connected! Yesterday sessions: {sessions}')
"
```
Expected: Shows yesterday's session count.

If it fails with a permissions error: double-check that you added the service account email as a Viewer in GA4 and that the Analytics Data API is enabled in Google Cloud Console.

#### Install the Google Analytics Collector

Read the example collector at `scripts/examples/google_analytics.py` and copy it to `scripts/collect_google_analytics.py`.

Customize for the user:
- The default pulls sessions, users, page views, bounce rate, engagement rate, and top traffic sources
- If they want additional metrics (conversions, events), add them to the metrics list

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python scripts/collect_google_analytics.py
```
Expected: Shows yesterday's GA4 data — sessions, users, page views.

Then run through the pipeline:
```bash
.venv/bin/python scripts/collect.py --sources google_analytics
```
Expected: `Collecting google_analytics... OK (X records)`

**"Google Analytics is connected! You're now tracking website traffic, user engagement, and traffic sources daily."**

---

### SOURCE: Google Sheets

> Skip this section if the user did not select Google Sheets in Phase 1.
> Requires: Google Service Account setup (see above).

**What you'll get:** Any data from a Google Spreadsheet pulled into your database. Common uses: P&L tracking, marketing KPIs, CRM data, outreach metrics, client tracking.

**What you need:**
- Google Service Account (set up above)
- Your Google Sheet ID (from the URL)

**Extra packages (if not already installed from GA4):**
```bash
.venv/bin/pip install google-api-python-client google-auth
```

#### Get Your Sheet ID

1. Open your Google Sheet
2. Look at the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
3. Copy the long string between `/d/` and `/edit` — that's your Sheet ID

Save to `.env`:
```
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SHEET_TAB=Sheet1
```
(Replace `Sheet1` with the actual tab name you want to read, or leave blank for the first tab.)

#### Share the Sheet with Your Service Account

1. Open your Google Sheet
2. Click "Share" (top right)
3. Paste your service account email address
4. Set permission to **"Viewer"**
5. Uncheck "Notify people" (it's a robot, not a person)
6. Click "Share"

[VERIFY]
```bash
.venv/bin/python -c "
import os; from dotenv import load_dotenv; load_dotenv()
from pathlib import Path
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

creds_path = Path(os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON', ''))
if not creds_path.is_absolute():
    creds_path = Path.cwd() / creds_path
sheet_id = os.getenv('GOOGLE_SHEET_ID', '')

creds = Credentials.from_service_account_file(str(creds_path), scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
service = build('sheets', 'v4', credentials=creds)
spreadsheet = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
tabs = [s['properties']['title'] for s in spreadsheet.get('sheets', [])]
print(f'Sheet connected! Tabs: {tabs}')
"
```
Expected: Shows the list of tab names in your spreadsheet.

If it fails with a permissions error: make sure you shared the sheet with the service account email, and that the Google Sheets API is enabled in Google Cloud Console.

#### Install the Google Sheets Collector

Read the example collector at `scripts/examples/google_sheets.py` and copy it to the appropriate script name. For a P&L sheet, use `scripts/collect_pnl.py`. For marketing KPIs, use `scripts/collect_marketing.py`. For a generic sheet, use `scripts/collect_sheets.py`.

**Important:** The example is a generic spreadsheet reader. During installation, Claude should customize it:
- Set the correct table name (not the generic `sheet_*` pattern)
- Define proper column types (numbers, dates, currencies — not all TEXT)
- Set the right primary key
- Parse any special formatting (currency symbols, percentage signs, date formats)

Ask the user: **"What kind of data is in this spreadsheet?"** Then customize the write() function accordingly.

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python scripts/collect_sheets.py
```
Expected: Shows tab name, row count, and headers from the spreadsheet.

Then run through the pipeline:
```bash
.venv/bin/python scripts/collect.py --sources sheets
```
Expected: `Collecting sheets... OK (X records)`

**"Your spreadsheet data is connected! The database now has a snapshot of your sheet data that will update daily."**

---

### SOURCE: Bitly

> Skip this section if the user did not select Bitly in Phase 1.

**What you'll get:** Daily click data for all your Bitly links — which links are getting clicked, 1-day and 30-day click counts, with tags for categorization.

**What you need:**
- A Bitly access token (free)

No extra packages needed — uses `requests` which is already installed.

#### Get Your Bitly Access Token

1. Go to https://app.bitly.com/settings/api/
2. Under "Access token", enter your Bitly password
3. Click "Generate token"
4. Copy the token that appears

Save to `.env`:
```
BITLY_ACCESS_TOKEN=your_token_here
```

[VERIFY]
```bash
.venv/bin/python -c "
import os; from dotenv import load_dotenv; load_dotenv()
import requests
token = os.getenv('BITLY_ACCESS_TOKEN', '')
r = requests.get('https://api-ssl.bitly.com/v4/user', headers={'Authorization': f'Bearer {token}'})
if r.status_code == 200:
    data = r.json()
    print(f'Bitly connected! Account: {data.get(\"name\", data.get(\"login\", \"OK\"))}')
else:
    print(f'Bitly FAILED (status {r.status_code}) — check your access token')
"
```
Expected: Shows your Bitly account name.

#### Install the Bitly Collector

Read the example collector at `scripts/examples/bitly.py` and copy it to `scripts/collect_bitly.py`.

The default collector works well as-is for most setups — it grabs all links with click counts.

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python scripts/collect_bitly.py
```
Expected: Shows total links and click counts.

Then run through the pipeline:
```bash
.venv/bin/python scripts/collect.py --sources bitly
```
Expected: `Collecting bitly... OK (X records)`

**"Bitly is connected! Link click tracking is now part of your daily pipeline."**

---

### SOURCE: Custom (Any Other API)

> Use this section for any data source not covered by the examples above.
> Common custom sources: Calendly, HubSpot, Notion, Airtable, ConvertKit/Kit,
> Meta Ads, Google Ads, Shopify, Gumroad, Paddle, Lemlist, Instantly, etc.

**When the user has a data source not in the examples:**

1. Ask what platform/tool it is
2. Search the web for their API documentation
3. Build a custom collector following the standard pattern

**The pattern for custom collectors:**

```python
"""
DataOS — {Source Name} Collector

{What this collects from where.}

Requires:
    {ENV_VAR_NAME} — {where to get it}

Tables created: {table_name}
"""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

try:
    import requests
except ImportError:
    raise ImportError("Missing 'requests' — run: pip install requests")


def collect():
    """Collect data from {source}."""
    api_key = os.getenv("{ENV_VAR_NAME}", "").strip()
    if not api_key:
        return {
            "source": "{source_name}", "status": "skipped",
            "reason": "Missing {ENV_VAR_NAME} — {how to get it}"
        }

    try:
        # Make API call(s) here
        # ...
        return {
            "source": "{source_name}",
            "status": "success",
            "data": { ... }
        }
    except Exception as e:
        return {"source": "{source_name}", "status": "error", "reason": str(e)}


def write(conn, result, date):
    """Write data to database. Returns records written."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS {table_name} (
            date TEXT NOT NULL,
            ...
            collected_at TEXT,
            PRIMARY KEY (date, ...)
        )
    """)

    if result.get("status") != "success":
        conn.commit()
        return 0

    collected_at = datetime.now(timezone.utc).isoformat()
    records = 0

    # Write records here
    # ...

    conn.commit()
    return records


if __name__ == "__main__":
    result = collect()
    if result["status"] == "success":
        print(f"Collected: {result['data']}")
    else:
        print(f"{result['status']}: {result.get('reason', '')}")
```

**Steps for building a custom collector:**
1. Search the web for the API docs of the platform
2. Identify the authentication method (API key, OAuth token, etc.)
3. Identify the endpoints that give you the metrics you want
4. Build the `collect()` function to call those endpoints
5. Design the database table (what columns, what's the primary key)
6. Build the `write()` function to store the data
7. Save as `scripts/collect_{source_name}.py`
8. Add the credential to `.env`
9. Test: `python scripts/collect.py --sources {source_name}`

[VERIFY] After building any custom collector:
```bash
cd /path/to/workspace && .venv/bin/python scripts/collect_{source_name}.py
```
Expected: Shows collected data without errors.

Then pipeline test:
```bash
.venv/bin/python scripts/collect.py --sources {source_name}
```
Expected: `Collecting {source_name}... OK (X records)`

---

## PHASE 4: KEY METRICS GENERATOR

> After all collectors are connected, we customize the key metrics file.

### Step 1: Add Section Functions

Open `scripts/generate_metrics.py` and add a section function for each connected source.

For each source the user connected, Claude should add a function in the CUSTOMIZATION ZONE following this pattern:

**YouTube section example:**
```python
def section_youtube(conn):
    """YouTube channel performance."""
    if not table_exists(conn, "youtube_daily"):
        return []
    lines = ["## YouTube"]
    row = query_one(conn, "SELECT * FROM youtube_daily ORDER BY date DESC LIMIT 1")
    if row:
        lines.append(f"| Metric | Value | As Of |")
        lines.append(f"|--------|-------|-------|")
        lines.append(f"| Subscribers | {fmt_number(row['subscribers'])} | {row['date']} |")
        lines.append(f"| Total Views | {fmt_number(row['total_views'])} | {row['date']} |")
        lines.append(f"| Videos (30d) | {row['videos_published_30d']} | {row['date']} |")
        lines.append(f"| Views (30d) | {fmt_number(row['views_30d'])} | {row['date']} |")
    lines.append("")
    return lines
```

**Stripe section example:**
```python
def section_stripe(conn):
    """Revenue and subscription metrics."""
    if not table_exists(conn, "stripe_daily"):
        return []
    lines = ["## Revenue"]
    rows = query_all(conn, "SELECT * FROM stripe_daily WHERE date = (SELECT MAX(date) FROM stripe_daily)")
    if rows:
        lines.append(f"| Account | MRR | Revenue MTD | Active Subs | Churn | As Of |")
        lines.append(f"|---------|-----|-------------|-------------|-------|-------|")
        for row in rows:
            lines.append(f"| {row['account']} | {fmt_currency(row['mrr'])} ({row['currency']}) | {fmt_currency(row['revenue_mtd'])} | {row['active_subscriptions']} | {fmt_pct(row['churn_rate'])} | {row['date']} |")
    lines.append("")
    return lines
```

### Step 2: Register Section Functions

Add each new function to the `SECTIONS` list:

```python
SECTIONS = [
    section_fx_rates,
    section_youtube,       # uncomment if connected
    section_stripe,        # uncomment if connected
    section_google_analytics,  # uncomment if connected
    # ... add your custom sections here
]
```

### Step 3: Generate and Review

```bash
cd /path/to/workspace && .venv/bin/python scripts/generate_metrics.py
```

[VERIFY] Read the generated `context/group/key-metrics.md` and show it to the user. It should have:
- A section for each connected data source with current numbers
- A Data Freshness table showing all tables and their latest record dates

Ask: **"This is what your AI will see every session. Does it cover the metrics you care about? Anything you'd like to add or change?"**

Iterate if needed — add more metrics, change formatting, add calculated fields.

### Step 4: Create the Data Access Reference

"You now have a database full of business data. But your AI needs to know how to USE it — what tables exist, what columns are in each one, and how to write queries. Let's create a reference guide."

Create `reference/data-access.md` — a living document that teaches your AI how to query the database. Generate this file based on what was actually connected during this install.

**Required sections:**

1. **SQLite Data Warehouse** — Location (`data/data.db`), how to connect (Python sqlite3 example showing `sqlite3.connect("data/data.db")`), note that Claude can run SQL directly in sessions
2. **Connected Data Sources** — Table with: Source, Table name(s), Collection script, What it tracks (one row per connected source)
3. **Table Schemas** — For each table: column name, type, and plain-English description. Get this from `PRAGMA table_info(TABLE_NAME)` plus what you know from building the collectors.
4. **Common Queries** — 5-10 useful SQL examples. Include at least: latest snapshot per source, trend over last 30 days, month-over-month comparison. Cross-source joins are especially valuable (e.g., website traffic vs revenue).
5. **Data Collection** — How to run collection manually (`python scripts/collect.py`), how to run specific sources, where logs live.

**How to generate it:**

1. Connect to the database and list all tables: `SELECT name FROM sqlite_master WHERE type='table'`
2. For each table, get the schema: `PRAGMA table_info(TABLE_NAME)`
3. Write one section per table with column descriptions based on what you know from building the collectors
4. Write the example queries — tailor them to the user's actual data sources
5. Include notes about metric types where relevant (snapshot vs cumulative vs period-sum)

**Quality bar:** A future Claude session should be able to read this file and immediately run meaningful queries against the database without reading any source code.

[VERIFY] Read the generated `reference/data-access.md` and confirm it covers all connected tables with schemas and example queries.

---

### Step 5: Wire Into /prime and CLAUDE.md

"This is the most important step. We're going to make your AI data-aware — every session, it'll know your numbers AND know it has a full database to query."

**5a. Update the /prime command**

Read the user's existing prime command (`.claude/commands/prime.md`). Make these three changes:

1. **Add key-metrics.md to the read list.** Find the section where files are listed (numbered list or bullets under "Read") and add an entry for `context/group/key-metrics.md` — described as "Current business metrics (auto-generated from database)".

2. **Add the data-access reference as an on-demand doc.** If the prime command has an "On-Demand Loading" or "Load when needed" section, add `reference/data-access.md` — described as "Full table schemas, SQL query examples, collection scripts". If there's no on-demand section, create one titled "On-Demand Loading" with a note that these files are NOT read during /prime but loaded when a task requires deep detail.

3. **Update the summary section.** If the /prime command has a "Summary" or "After reading, provide" section, add a bullet: **Data status** — Review key-metrics.md data freshness. Flag anything stale (>2 days old). Note you can run live SQL queries against `data/data.db`.

This is critical — it tells Claude two things: (a) actively report the numbers it sees in the metrics file, and (b) it has direct database access for deeper analysis beyond what's in the metrics file.

**Handle the current-data.md transition:**

ContextOS created `context/current-data.md` for manually tracking metrics and business state. DataOS replaces the *metrics* portion of that file automatically. Read `context/current-data.md` and decide:

- **If it contains manually entered metrics** (revenue figures, subscriber counts, traffic numbers) — those are now auto-generated in key-metrics.md. Remove the metric sections from current-data.md.
- **If it contains qualitative notes** (project status, blockers, team notes, strategic observations) — keep those. Rename the file to something clearer if helpful (e.g., `context/current-notes.md`).
- **If it's mostly metrics** — you can remove it entirely and explain: "DataOS now handles this automatically. Your key-metrics.md file updates every morning with fresh numbers from the database — no more manually updating a data file."

**5b. Update CLAUDE.md**

Read `CLAUDE.md` and make these updates:

1. **Workspace structure section** — add these entries in the appropriate locations within the existing tree:
   - `data/` directory containing `data.db` — "SQLite database — all metrics, daily snapshots"
   - `context/group/key-metrics.md` — "Auto-generated current metrics (from DB)"
   - `reference/data-access.md` — "Full table schemas, SQL queries, collection details"
   - Under `scripts/`: `db.py` (database framework), `config.py` (env loader), `collect.py` (collection orchestrator), `collect_*.py` (individual collectors), `generate_metrics.py` (metrics generator)

2. **Commands section** — add a `/update-data` entry explaining it runs `python scripts/collect.py` to refresh data and regenerate key-metrics.md on demand. Note the daily cron handles this automatically.

3. **Session workflow** — add notes that `/prime` loads current metrics from the database, and that for deeper analysis Claude can query `data/data.db` directly (load `reference/data-access.md` for schemas and examples).

4. **Add a Data section** that tells future Claude sessions about the data warehouse. It should explain:
   - All business metrics are collected daily into `data/data.db` (SQLite)
   - `key-metrics.md` is auto-generated and loaded by `/prime` each session
   - For direct database queries, load `reference/data-access.md` for all table schemas and example SQL
   - Claude can run SQL directly via Python's sqlite3 module: `sqlite3.connect("data/data.db")`

[VERIFY] Read both the updated /prime command and CLAUDE.md. Confirm:
- /prime reads key-metrics.md
- /prime mentions database access in its summary section
- /prime lists data-access.md as on-demand reference
- CLAUDE.md includes the data/ directory, scripts, and data access notes

**Milestone:** "Your workspace is now fully data-aware. Every session starts with fresh metrics, and Claude knows it has a full database to query for deeper analysis. Try running /prime — you'll see it report your actual business numbers and note that it can run live queries against your data."

---

## PHASE 5: AUTOMATE

> Set up daily collection so you never have to run it manually.

### Option A: macOS (launchd)

This runs your collection pipeline at 6:00 AM every day.

Create `config/com.aios.data-collect.plist` with the user's actual paths filled in:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aios.data-collect</string>

    <key>ProgramArguments</key>
    <array>
        <string>WORKSPACE_PATH/.venv/bin/python</string>
        <string>WORKSPACE_PATH/scripts/collect.py</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>WORKSPACE_PATH/data/collect.log</string>

    <key>StandardErrorPath</key>
    <string>WORKSPACE_PATH/data/collect.log</string>

    <key>WorkingDirectory</key>
    <string>WORKSPACE_PATH</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

Replace `WORKSPACE_PATH` with the actual absolute path to the user's workspace.

Install and activate:
```bash
cp config/com.aios.data-collect.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.aios.data-collect.plist
```

Test it runs:
```bash
launchctl start com.aios.data-collect
```

[VERIFY] Check the log file:
```bash
cat data/collect.log
```
Expected: Collection output showing success/skip/error for each source.

If you need to stop it:
```bash
launchctl unload ~/Library/LaunchAgents/com.aios.data-collect.plist
```

---

### Option B: Linux (cron)

```bash
crontab -e
```

Add this line (replace the path with the user's actual workspace path):
```
0 6 * * * cd /path/to/workspace && .venv/bin/python scripts/collect.py >> data/collect.log 2>&1
```

[VERIFY]
```bash
crontab -l | grep collect
```
Expected: Shows the cron entry.

---

### Important Notes About Scheduling

- **Your machine needs to be awake** at the scheduled time (6:00 AM by default). If it's asleep, the job will run when it next wakes up (launchd) or be skipped entirely (cron).
- **For laptops (macOS):** Go to System Settings > Energy > enable "Prevent automatic sleeping when the display is off" — or plug in the charger overnight.
- **Logs live at** `data/collect.log` — check here if things seem off.
- **Change the time** by editing the plist (Hour/Minute) or cron expression. Some people prefer running at midnight, others at 7 AM before they start work.

**Milestone:** "Automation is set up. Your data pipeline will run every morning at 6 AM, pull fresh data from all your sources, and regenerate your key metrics file. By the time you sit down to work, your AI already knows how the business is doing."

---

## PHASE 6: FULL PIPELINE TEST

Run the complete pipeline end to end one final time:

```bash
cd /path/to/workspace && .venv/bin/python scripts/collect.py
```

[VERIFY] Expected: All connected sources show "OK", skipped sources (missing credentials) show "SKIPPED", and the summary line shows your total records.

Then verify the metrics file:
```bash
.venv/bin/python scripts/generate_metrics.py
```

Show the user the final `context/group/key-metrics.md` file.

**Final celebration:** "DataOS is fully installed. Here's what you just built:
- A local SQLite database at `data/data.db` collecting daily snapshots
- {N} data source collectors running automatically
- A key-metrics.md file that refreshes every morning
- A daily cron job that handles everything while you sleep

Your AI now has access to fresh business data every session. When you run /prime, it loads your latest metrics — revenue, traffic, subscribers, whatever you connected — and can answer questions like 'How are we doing this month vs last month?' with actual numbers."

---

## WHAT'S NEXT

Now that DataOS is running, here are your options:

1. **Let it collect for a week.** The real power of daily snapshots comes from having history. After 7 days you'll start seeing meaningful trends. After 30 days, month-over-month comparisons become useful.

2. **Add more collectors.** As your business grows or you start using new tools, just create a new `collect_*.py` file following the pattern. The orchestrator auto-discovers it.

3. **Ask your AI about the data.** With `/prime` loading your key metrics, try asking things like:
   - "How's revenue trending this month?"
   - "Which YouTube videos performed best last week?"
   - "What's our website traffic trend?"
   - Your AI can query the database directly for deeper analysis.

4. **Explore related modules:**
   - **IntelOS** — meeting intelligence and team call analysis (pairs perfectly with DataOS)
   - **ProductivityOS** — GTD system with projects, actions, and weekly reviews
   - **ContentOS** — content pipeline with idea capture, development, and scheduling



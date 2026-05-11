"""
DataOS — Stripe Revenue Collector (Example)

Collects revenue, subscription, and MRR metrics from Stripe via the AIOS
Stripe connector (Composio). No STRIPE_API_KEY_* in .env — the user connects
Stripe once via the Connectors page in AIOS Desktop.

If Stripe isn't connected, this script prints a clear message and skips —
DataOS continues with other sources.

Copy this to scripts/collect_stripe.py to activate.

Tables created: stripe_daily
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


def _safe_iter_pages(composio: Composio, slug: str, args: dict):
    """Yield items across paginated Stripe responses.

    Composio's Stripe tools return Stripe's native pagination shape:
        { "data": [...], "has_more": bool, "next_page_starting_after": "..." }
    """
    while True:
        result = composio.execute(tool_slug=slug, args=args, service="stripe") or {}
        data = result.get("data", []) or []
        for item in data:
            yield item
        if not result.get("has_more"):
            return
        cursor = result.get("next_page_starting_after") or (data[-1].get("id") if data else None)
        if not cursor:
            return
        args = {**args, "starting_after": cursor}


def collect():
    """Collect Stripe data via the AIOS Stripe connector."""
    try:
        composio = Composio()
    except Exception as exc:
        return {
            "source": "stripe", "status": "skipped",
            "reason": f"Could not initialize AIOS Composio client: {exc}"
        }

    # Detect currency via STRIPE_RETRIEVE_BALANCE — Composio's Stripe toolkit
    # doesn't expose a generic "get my account" tool, but the balance object
    # has a top-level `available[].currency` which gives us the account currency.
    try:
        balance = composio.execute(
            tool_slug="STRIPE_RETRIEVE_BALANCE", args={}, service="stripe"
        ) or {}
    except ConnectorNotConfiguredError:
        return {
            "source": "stripe", "status": "skipped",
            "reason": "Stripe is not connected. Open AIOS Desktop → Connectors → Stripe."
        }
    except Exception as exc:
        return {"source": "stripe", "status": "error", "reason": str(exc)}

    # Unwrap potential {"data": {...}} wrapper from the relay
    if isinstance(balance, dict) and "data" in balance and isinstance(balance["data"], dict):
        balance = balance["data"]

    available = balance.get("available") or []
    currency = ((available[0] or {}).get("currency") if available else "usd").upper()
    # Account name isn't available via Composio's Stripe tools — use a generic
    # label. Identify-side prompt does the same.
    account_name = "stripe"

    # Current month boundaries
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_start_ts = int(month_start.timestamp())

    # Active subscriptions + MRR calculation
    active_subs = 0
    mrr = 0.0
    try:
        for sub in _safe_iter_pages(composio, "STRIPE_LIST_SUBSCRIPTIONS", {"status": "active", "limit": 100}):
            active_subs += 1
            for item in ((sub.get("items") or {}).get("data") or []):
                price = item.get("price") or {}
                amount = price.get("unit_amount") or 0
                interval = ((price.get("recurring") or {}).get("interval")) or "month"
                qty = item.get("quantity") or 1
                monthly = amount * qty / 100
                if interval == "year":
                    monthly /= 12
                elif interval == "week":
                    monthly *= 4.33
                mrr += monthly
    except Exception as exc:
        return {"source": "stripe", "status": "error", "reason": f"list subscriptions: {exc}"}

    # New subscriptions this month
    new_subs = 0
    try:
        for _ in _safe_iter_pages(composio, "STRIPE_LIST_SUBSCRIPTIONS",
                                  {"created[gte]": month_start_ts, "limit": 100}):
            new_subs += 1
    except Exception:
        pass

    # Revenue this month (successful charges)
    revenue_mtd = 0.0
    try:
        for charge in _safe_iter_pages(composio, "STRIPE_LIST_CHARGES",
                                       {"created[gte]": month_start_ts, "limit": 100}):
            if charge.get("status") == "succeeded":
                revenue_mtd += (charge.get("amount") or 0) / 100
    except Exception:
        pass

    # Canceled this month
    canceled = 0
    try:
        for sub in _safe_iter_pages(composio, "STRIPE_LIST_SUBSCRIPTIONS",
                                    {"status": "canceled", "limit": 100}):
            canceled_at = sub.get("canceled_at")
            if canceled_at and canceled_at >= month_start_ts:
                canceled += 1
    except Exception:
        pass

    churn_rate = (canceled / active_subs * 100) if active_subs > 0 else 0.0

    data = {
        "account": account_name,
        "currency": currency,
        "mrr": round(mrr, 2),
        "active_subscriptions": active_subs,
        "new_subscriptions": new_subs,
        "canceled": canceled,
        "revenue_mtd": round(revenue_mtd, 2),
        "churn_rate": round(churn_rate, 2),
    }

    return {
        "source": "stripe",
        "status": "success",
        "data": {"accounts": {account_name: data}, "errors": []}
    }


def write(conn, result, date):
    """Write Stripe data to database. Returns records written."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stripe_daily (
            date TEXT NOT NULL,
            account TEXT NOT NULL,
            currency TEXT,
            mrr REAL,
            revenue_mtd REAL,
            active_subscriptions INTEGER,
            new_subscriptions INTEGER,
            canceled INTEGER,
            churn_rate REAL,
            collected_at TEXT,
            PRIMARY KEY (date, account)
        )
    """)

    if result.get("status") != "success":
        conn.commit()
        return 0

    collected_at = datetime.now(timezone.utc).isoformat()
    records = 0
    for name, data in result["data"]["accounts"].items():
        conn.execute(
            "INSERT OR REPLACE INTO stripe_daily "
            "(date, account, currency, mrr, revenue_mtd, active_subscriptions, "
            "new_subscriptions, canceled, churn_rate, collected_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (date, name, data["currency"], data["mrr"], data["revenue_mtd"],
             data["active_subscriptions"], data["new_subscriptions"],
             data["canceled"], data["churn_rate"], collected_at)
        )
        records += 1
    conn.commit()
    return records


if __name__ == "__main__":
    result = collect()
    if result["status"] == "success":
        for name, data in result["data"]["accounts"].items():
            print(f"\n{data['account']} ({data['currency']}):")
            print(f"  MRR: ${data['mrr']:,.2f}")
            print(f"  Revenue MTD: ${data['revenue_mtd']:,.2f}")
            print(f"  Active subs: {data['active_subscriptions']}")
            print(f"  New: {data['new_subscriptions']}, Canceled: {data['canceled']}")
    else:
        print(f"{result['status']}: {result.get('reason', '')}")

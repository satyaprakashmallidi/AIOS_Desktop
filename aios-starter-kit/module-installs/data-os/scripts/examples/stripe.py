"""
DataOS — Stripe Revenue Collector (Example)

Collects revenue, subscription, and churn metrics from Stripe.
Supports multiple accounts — add STRIPE_API_KEY_YOURNAME=sk_live_... to .env.

Copy this to scripts/collect_stripe.py to activate.

Requires:
    At least one STRIPE_API_KEY_* in .env
    Get keys at: dashboard.stripe.com/apikeys (use restricted, read-only)

Tables created: stripe_daily
Extra pip: stripe
"""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

try:
    import stripe
except ImportError:
    raise ImportError(
        "Missing 'stripe' package — run: pip install stripe"
    )


def _collect_account(api_key, account_name):
    """Collect data from a single Stripe account."""
    stripe.api_key = api_key

    # Detect account currency
    try:
        account = stripe.Account.retrieve()
        currency = (account.get("default_currency") or "usd").upper()
    except Exception:
        currency = "USD"

    # Current month boundaries
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_start_ts = int(month_start.timestamp())

    # Active subscriptions + MRR calculation
    active_subs = 0
    mrr = 0.0
    subs_iter = stripe.Subscription.list(status="active", limit=100)
    for sub in subs_iter.auto_paging_iter():
        active_subs += 1
        for item in sub.get("items", {}).get("data", []):
            amount = item.get("price", {}).get("unit_amount", 0) or 0
            interval = item.get("price", {}).get("recurring", {}).get("interval", "month")
            qty = item.get("quantity", 1) or 1
            monthly = amount * qty / 100
            if interval == "year":
                monthly /= 12
            elif interval == "week":
                monthly *= 4.33
            mrr += monthly

    # New subscriptions this month
    new_subs = 0
    for _ in stripe.Subscription.list(
        created={"gte": month_start_ts}, limit=100
    ).auto_paging_iter():
        new_subs += 1

    # Revenue this month (successful charges)
    revenue_mtd = 0.0
    for charge in stripe.Charge.list(
        created={"gte": month_start_ts}, limit=100
    ).auto_paging_iter():
        if charge.status == "succeeded":
            revenue_mtd += (charge.amount or 0) / 100

    # Canceled this month
    canceled = 0
    for sub in stripe.Subscription.list(
        status="canceled", limit=100
    ).auto_paging_iter():
        if sub.canceled_at and sub.canceled_at >= month_start_ts:
            canceled += 1

    churn_rate = (canceled / active_subs * 100) if active_subs > 0 else 0.0

    return {
        "account": account_name,
        "currency": currency,
        "mrr": round(mrr, 2),
        "active_subscriptions": active_subs,
        "new_subscriptions": new_subs,
        "canceled": canceled,
        "revenue_mtd": round(revenue_mtd, 2),
        "churn_rate": round(churn_rate, 2),
    }


def collect():
    """Collect Stripe data from all configured accounts."""
    # Find all STRIPE_API_KEY_* variables in .env
    accounts = {}
    for key, value in os.environ.items():
        if key.startswith("STRIPE_API_KEY_") and value.strip():
            name = key.replace("STRIPE_API_KEY_", "").lower()
            accounts[name] = value.strip()

    if not accounts:
        return {
            "source": "stripe", "status": "skipped",
            "reason": "No STRIPE_API_KEY_* found in .env — "
                      "add STRIPE_API_KEY_MAIN=sk_live_... "
                      "(get yours at dashboard.stripe.com/apikeys)"
        }

    results = {}
    errors = []
    for name, api_key in accounts.items():
        try:
            results[name] = _collect_account(api_key, name)
        except Exception as e:
            errors.append(f"{name}: {e}")

    if not results:
        return {
            "source": "stripe", "status": "error",
            "reason": "; ".join(errors)
        }

    return {
        "source": "stripe",
        "status": "success",
        "data": {"accounts": results, "errors": errors}
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

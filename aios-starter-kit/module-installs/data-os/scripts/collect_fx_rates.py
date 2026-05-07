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

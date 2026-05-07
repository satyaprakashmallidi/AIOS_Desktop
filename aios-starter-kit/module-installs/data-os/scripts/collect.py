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

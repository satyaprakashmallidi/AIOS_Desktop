"""
IntelOS — Master collection script.

Runs all configured collectors (meetings + Slack), writes to the database,
and classifies new meetings. This is the script that gets scheduled on a cron.

Usage:
    python scripts/collect_all.py                   # Run all collectors
    python scripts/collect_all.py --meetings-only   # Only collect meetings
    python scripts/collect_all.py --slack-only       # Only collect Slack
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, timezone

# Ensure scripts/ is on the path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import init_db, write_meetings, write_slack, get_meeting_stats


def run(meetings_only: bool = False, slack_only: bool = False):
    """Run all configured collectors and write to database."""
    print(f"IntelOS collection starting at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    conn = init_db()

    # --- Meetings ---
    if not slack_only:
        meeting_records = []

        # Try Fireflies
        try:
            from collect_fireflies import collect as collect_fireflies
            ff_meetings = collect_fireflies()
            if ff_meetings:
                meeting_records.extend(ff_meetings)
        except ImportError:
            pass
        except Exception as e:
            print(f"Fireflies error: {e}")

        # Try Fathom
        try:
            from collect_fathom import collect as collect_fathom
            fathom_meetings = collect_fathom()
            if fathom_meetings:
                meeting_records.extend(fathom_meetings)
        except ImportError:
            pass
        except Exception as e:
            print(f"Fathom error: {e}")

        # Write meetings to DB
        if meeting_records:
            count = write_meetings(conn, meeting_records)
            print(f"Meetings: {count} records written to database")
        else:
            print("Meetings: no new records collected")

        # Classify new meetings
        try:
            from classify import classify_all
            classified = classify_all(conn)
            if classified:
                print(f"Classifier: {classified} meetings classified")
        except Exception as e:
            print(f"Classifier error: {e}")

    # --- Slack ---
    if not meetings_only:
        try:
            from collect_slack import collect as collect_slack
            messages, stats = collect_slack()
            if messages:
                count = write_slack(conn, messages)
                print(f"Slack: {count} messages written to database")
            else:
                print("Slack: no messages collected")
        except Exception as e:
            print(f"Slack error: {e}")

    # --- Summary ---
    print("\n" + "=" * 60)
    stats = get_meeting_stats(conn)
    print(f"Database totals:")
    print(f"  Meetings:       {stats['total_meetings']}")
    print(f"  Slack messages:  {stats['total_slack_messages']}")
    print(f"  Team members:    {stats['team_members']}")
    if stats['latest_meeting_date']:
        print(f"  Latest meeting:  {stats['latest_meeting_date']}")
    print("=" * 60)

    conn.close()
    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IntelOS — collect meetings and messages")
    parser.add_argument("--meetings-only", action="store_true", help="Only collect meetings")
    parser.add_argument("--slack-only", action="store_true", help="Only collect Slack messages")
    args = parser.parse_args()

    run(meetings_only=args.meetings_only, slack_only=args.slack_only)

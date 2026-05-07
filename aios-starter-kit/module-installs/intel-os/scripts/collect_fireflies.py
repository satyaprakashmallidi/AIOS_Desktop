"""
IntelOS — Fireflies.ai meeting transcript collector.

Pulls new meeting transcripts from Fireflies via GraphQL API.
Outputs a list of meeting dicts ready for db.write_meetings().

Usage:
    python scripts/collect_fireflies.py              # Last 7 days
    python scripts/collect_fireflies.py --days 30    # Last 30 days
"""

import os
import json
import argparse
import requests
from pathlib import Path
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
# Also try parent (workspace root)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql"

TRANSCRIPTS_QUERY = """
query GetTranscripts($fromDate: DateTime, $limit: Int, $skip: Int) {
    transcripts(fromDate: $fromDate, limit: $limit, skip: $skip) {
        id
        title
        date
        duration
        meeting_attendees {
            displayName
            email
        }
        sentences {
            text
            speaker_name
            start_time
            end_time
        }
        summary {
            action_items
            short_summary
            overview
        }
    }
}
"""


def _build_transcript_text(sentences: list[dict]) -> str:
    """Build readable transcript from sentences."""
    lines = []
    for s in sentences:
        speaker = s.get("speaker_name", "Unknown")
        text = s.get("text", "").strip()
        if text:
            lines.append(f"[{speaker}] {text}")
    return "\n".join(lines)


def _build_participants(attendees: list[dict]) -> str:
    """Build JSON string of attendees."""
    participants = []
    for a in attendees:
        p = {}
        if a.get("displayName"):
            p["name"] = a["displayName"]
        if a.get("email"):
            p["email"] = a["email"]
        if p:
            participants.append(p)
    return json.dumps(participants)


def collect(days: int = 7) -> list[dict]:
    """
    Collect Fireflies transcripts from the last N days.

    Returns a list of meeting dicts ready for db.write_meetings().
    """
    api_key = os.getenv("FIREFLIES_API_KEY")
    if not api_key:
        print("Skipped: FIREFLIES_API_KEY not set in .env")
        return []

    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    since_date = since_dt.strftime("%Y-%m-%dT00:00:00Z")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    all_transcripts = []
    skip = 0
    limit = 50

    while True:
        variables = {"fromDate": since_date, "limit": limit, "skip": skip}

        try:
            resp = requests.post(
                FIREFLIES_ENDPOINT,
                headers=headers,
                json={"query": TRANSCRIPTS_QUERY, "variables": variables},
                timeout=60,
            )
            resp.raise_for_status()
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response else "unknown"
            print(f"Error: Fireflies API returned HTTP {status}.")
            if status == 401:
                print("  → Your API key might be invalid. Check it at https://app.fireflies.ai/integrations")
            return []
        except requests.exceptions.ConnectionError:
            print("Error: Could not connect to Fireflies. Check your internet connection.")
            return []

        data = resp.json()
        if "errors" in data:
            msg = data["errors"][0].get("message", "Unknown error")
            print(f"Error from Fireflies API: {msg}")
            return []

        transcripts = data.get("data", {}).get("transcripts", [])
        if not transcripts:
            break

        all_transcripts.extend(transcripts)
        if len(transcripts) < limit:
            break
        skip += limit

    # Convert to standard meeting format
    meetings = []
    for t in all_transcripts:
        transcript_id = t.get("id")
        if not transcript_id:
            continue

        sentences = t.get("sentences") or []
        attendees = t.get("meeting_attendees") or []
        summary_data = t.get("summary") or {}

        transcript_text = _build_transcript_text(sentences)

        # Build summary
        summary_parts = []
        if summary_data.get("overview"):
            summary_parts.append(summary_data["overview"])
        if summary_data.get("short_summary"):
            summary_parts.append(summary_data["short_summary"])
        summary = "\n\n".join(summary_parts)

        # Action items
        action_items = summary_data.get("action_items")
        action_items_raw = json.dumps(action_items) if action_items else None

        # Parse date (Fireflies returns millisecond timestamp)
        meeting_date = t.get("date", "")
        start_time = None
        if meeting_date:
            try:
                dt = datetime.fromtimestamp(int(meeting_date) / 1000, tz=timezone.utc)
                date_str = dt.strftime("%Y-%m-%d")
                start_time = dt.strftime("%H:%M:%S")
            except (ValueError, TypeError, OSError):
                date_str = str(meeting_date)[:10]
        else:
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Duration (Fireflies returns seconds)
        duration = t.get("duration")
        duration_minutes = None
        if duration is not None:
            try:
                duration_minutes = round(float(duration) / 60)
            except (ValueError, TypeError):
                pass

        meetings.append({
            "meeting_id": f"fireflies_{transcript_id}",
            "source": "fireflies",
            "title": t.get("title", "Untitled Meeting"),
            "date": date_str,
            "start_time": start_time,
            "duration_minutes": duration_minutes,
            "participants": _build_participants(attendees),
            "transcript_text": transcript_text,
            "summary": summary,
            "action_items_raw": action_items_raw,
            "external_url": f"https://app.fireflies.ai/view/{transcript_id}",
        })

    print(f"Fireflies: collected {len(meetings)} meetings from the last {days} days")
    return meetings


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Collect Fireflies meeting transcripts")
    parser.add_argument("--days", type=int, default=7, help="Number of days to look back (default: 7)")
    args = parser.parse_args()

    meetings = collect(days=args.days)
    if meetings:
        print(f"\nSample meeting: {meetings[0]['title']} ({meetings[0]['date']})")
        print(f"  Duration: {meetings[0].get('duration_minutes', '?')} min")
        print(f"  Transcript length: {len(meetings[0].get('transcript_text', ''))} chars")
    else:
        print("No meetings collected.")

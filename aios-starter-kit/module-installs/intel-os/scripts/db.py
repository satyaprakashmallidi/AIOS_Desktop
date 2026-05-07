"""
IntelOS — Database setup and helper functions.

Creates and manages the SQLite database for meeting transcripts,
Slack messages, team registry, and collection logs.
"""

import sqlite3
import json
from pathlib import Path
from datetime import datetime, timezone

# Database lives in data/ folder relative to workspace root
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = WORKSPACE_ROOT / "data" / "intel.db"


SCHEMA_SQL = """
-- Meeting transcripts from any recorder (Fireflies, Fathom, custom)
CREATE TABLE IF NOT EXISTS meetings (
    meeting_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT,
    date TEXT NOT NULL,
    start_time TEXT,
    duration_minutes INTEGER,
    participants TEXT,
    transcript_text TEXT,
    summary TEXT,
    action_items_raw TEXT,
    stream TEXT,
    call_type TEXT,
    classified_at TEXT,
    external_url TEXT,
    collected_at TEXT NOT NULL
);

-- Slack messages (one row per message)
CREATE TABLE IF NOT EXISTS slack_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    user_id TEXT,
    user_name TEXT,
    ts TEXT NOT NULL,
    thread_ts TEXT,
    message_type TEXT DEFAULT 'message',
    text TEXT,
    has_files INTEGER DEFAULT 0,
    reactions TEXT,
    reply_count INTEGER DEFAULT 0,
    collected_at TEXT NOT NULL,
    UNIQUE(workspace, channel_id, ts)
);

-- Team member registry (for meeting classification)
CREATE TABLE IF NOT EXISTS staff_registry (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    team TEXT NOT NULL,
    department TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    added_at TEXT NOT NULL
);

-- Collection log (tracks every collection run)
CREATE TABLE IF NOT EXISTS collection_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collected_at TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    records_written INTEGER DEFAULT 0
);
"""


def get_connection() -> sqlite3.Connection:
    """Get a database connection. Creates the file and tables if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> sqlite3.Connection:
    """Initialize the database with all tables."""
    conn = get_connection()
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_collection(conn: sqlite3.Connection, source: str, status: str,
                   reason: str = None, records: int = 0):
    """Log a collection run."""
    conn.execute(
        "INSERT INTO collection_log (collected_at, source, status, reason, records_written) "
        "VALUES (?, ?, ?, ?, ?)",
        (_now_iso(), source, status, reason, records)
    )
    conn.commit()


def write_meetings(conn: sqlite3.Connection, meetings: list[dict]) -> int:
    """Write meeting records to database. Returns count written."""
    records = 0
    now = _now_iso()
    for m in meetings:
        mid = m.get("meeting_id")
        if not mid:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO meetings "
            "(meeting_id, source, title, date, start_time, duration_minutes, "
            "participants, transcript_text, summary, action_items_raw, "
            "stream, call_type, classified_at, external_url, collected_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
            "COALESCE((SELECT stream FROM meetings WHERE meeting_id = ?), NULL), "
            "COALESCE((SELECT call_type FROM meetings WHERE meeting_id = ?), NULL), "
            "COALESCE((SELECT classified_at FROM meetings WHERE meeting_id = ?), NULL), "
            "?, ?)",
            (mid, m.get("source", "unknown"), m.get("title"),
             m.get("date"), m.get("start_time"), m.get("duration_minutes"),
             m.get("participants"), m.get("transcript_text"),
             m.get("summary"), m.get("action_items_raw"),
             mid, mid, mid,
             m.get("external_url"), now)
        )
        records += 1
    log_collection(conn, meetings[0].get("source", "meetings") if meetings else "meetings",
                   "success", records=records)
    conn.commit()
    return records


def write_slack(conn: sqlite3.Connection, messages: list[dict]) -> int:
    """Write Slack messages to database. Returns count written."""
    records = 0
    now = _now_iso()
    for msg in messages:
        reactions = msg.get("reactions")
        reactions_str = json.dumps(reactions) if reactions else None
        conn.execute(
            "INSERT OR REPLACE INTO slack_messages "
            "(workspace, channel_id, channel_name, user_id, user_name, "
            "ts, thread_ts, message_type, text, has_files, reactions, "
            "reply_count, collected_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (msg["workspace"], msg["channel_id"], msg.get("channel_name"),
             msg.get("user_id"), msg.get("user_name"),
             msg["ts"], msg.get("thread_ts"), msg.get("message_type", "message"),
             msg.get("text"), msg.get("has_files", 0), reactions_str,
             msg.get("reply_count", 0), now)
        )
        records += 1
    log_collection(conn, "slack", "success", records=records)
    conn.commit()
    return records


def write_staff(conn: sqlite3.Connection, staff_list: list[dict]) -> int:
    """Write team members to the staff registry. Returns count written."""
    now = _now_iso()
    count = 0
    for staff in staff_list:
        conn.execute(
            "INSERT OR REPLACE INTO staff_registry "
            "(email, name, role, team, department, is_active, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?, COALESCE("
            "(SELECT added_at FROM staff_registry WHERE email = ?), ?))",
            (staff["email"], staff["name"], staff["role"],
             staff.get("team", "general"), staff.get("department", "general"),
             staff.get("is_active", 1), staff["email"], now)
        )
        count += 1
    conn.commit()
    return count


# --- Query helpers ---

def get_daily_slack_transcript(conn: sqlite3.Connection, date: str,
                                workspace: str = None) -> str:
    """Get a full day's Slack messages as a readable transcript.

    Returns all messages for a given date, formatted as:
    [#channel] sender: message text

    Useful for feeding into an LLM for daily summary or search.
    """
    query = """
        SELECT channel_name, user_name, text, ts
        FROM slack_messages
        WHERE DATE(datetime(CAST(ts AS REAL), 'unixepoch')) = ?
    """
    params = [date]
    if workspace:
        query += " AND workspace = ?"
        params.append(workspace)
    query += " ORDER BY ts ASC"

    rows = conn.execute(query, params).fetchall()
    if not rows:
        return f"No Slack messages found for {date}."

    lines = []
    for row in rows:
        channel = row["channel_name"] or "unknown"
        user = row["user_name"] or "unknown"
        text = row["text"] or ""
        lines.append(f"[#{channel}] {user}: {text}")

    return "\n".join(lines)


def search_meetings(conn: sqlite3.Connection, query: str,
                     days: int = 30) -> list[dict]:
    """Search meeting transcripts and titles for a keyword/phrase.

    Returns matching meetings with title, date, and a snippet of the match.
    """
    rows = conn.execute(
        "SELECT meeting_id, title, date, duration_minutes, participants, "
        "summary, transcript_text FROM meetings "
        "WHERE date >= date('now', ?) "
        "AND (title LIKE ? OR transcript_text LIKE ? OR summary LIKE ?) "
        "ORDER BY date DESC",
        (f"-{days} days", f"%{query}%", f"%{query}%", f"%{query}%")
    ).fetchall()
    return [dict(r) for r in rows]


def search_slack(conn: sqlite3.Connection, query: str,
                  days: int = 30) -> list[dict]:
    """Search Slack messages for a keyword/phrase.

    Returns matching messages with channel, sender, and text.
    """
    rows = conn.execute(
        "SELECT workspace, channel_name, user_name, text, ts "
        "FROM slack_messages WHERE text LIKE ? "
        "AND DATE(datetime(CAST(ts AS REAL), 'unixepoch')) >= date('now', ?) "
        "ORDER BY ts DESC LIMIT 50",
        (f"%{query}%", f"-{days} days")
    ).fetchall()
    return [dict(r) for r in rows]


def get_meeting_stats(conn: sqlite3.Connection) -> dict:
    """Get a quick summary of what's in the database."""
    meetings = conn.execute("SELECT COUNT(*) FROM meetings").fetchone()[0]
    slack = conn.execute("SELECT COUNT(*) FROM slack_messages").fetchone()[0]
    staff = conn.execute("SELECT COUNT(*) FROM staff_registry").fetchone()[0]

    latest_meeting = conn.execute(
        "SELECT date FROM meetings ORDER BY date DESC LIMIT 1"
    ).fetchone()
    latest_slack = conn.execute(
        "SELECT MAX(ts) FROM slack_messages"
    ).fetchone()

    return {
        "total_meetings": meetings,
        "total_slack_messages": slack,
        "team_members": staff,
        "latest_meeting_date": latest_meeting[0] if latest_meeting else None,
        "latest_slack_ts": latest_slack[0] if latest_slack else None,
    }


if __name__ == "__main__":
    conn = init_db()
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [row["name"] for row in cursor.fetchall()]
    print(f"Database initialized at: {DB_PATH}")
    print(f"Tables ({len(tables)}): {', '.join(tables)}")
    stats = get_meeting_stats(conn)
    print(f"Stats: {stats}")
    conn.close()

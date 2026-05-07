#!/usr/bin/env python3
"""GTD inbox writer — append items to gtd/inbox.md with file locking.

Safely adds items to the GTD inbox from any source (scripts, pipelines,
cron jobs). Uses file locking to prevent corruption from concurrent writes.

Usage:
    # As a module
    from inbox_writer import capture_to_inbox
    capture_to_inbox("Call Sarah about the proposal", source="manual")

    # From command line
    python3 scripts/inbox_writer.py "Call Sarah about the proposal"
"""

import fcntl
import sys
from datetime import datetime, timezone
from pathlib import Path

# Find workspace root by looking for gtd/ folder
_SCRIPT_DIR = Path(__file__).resolve().parent
_WORKSPACE_ROOT = _SCRIPT_DIR.parent
if not (_WORKSPACE_ROOT / "gtd").is_dir():
    # Try one more level up
    _WORKSPACE_ROOT = _WORKSPACE_ROOT.parent

INBOX_PATH = _WORKSPACE_ROOT / "gtd" / "inbox.md"
EMPTY_MARKER = "_(Empty — inbox is at zero)_"


def _timestamp() -> str:
    """Current timestamp in inbox format."""
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def capture_to_inbox(item: str, source: str = "manual") -> str:
    """
    Append a single item to gtd/inbox.md with file locking.

    Args:
        item: The text to capture
        source: Source identifier (manual, telegram, claude, voice, meeting)

    Returns:
        The formatted line that was written
    """
    if not INBOX_PATH.exists():
        raise FileNotFoundError(
            f"Inbox not found at {INBOX_PATH} — make sure you're in your workspace root "
            f"and the GTD module is installed (gtd/inbox.md should exist)"
        )

    timestamp = _timestamp()
    line = f"- [{timestamp}] (source:{source}) {item}"

    with open(INBOX_PATH, "r+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            content = f.read()

            # Remove empty marker if present
            if EMPTY_MARKER in content:
                content = content.replace(EMPTY_MARKER, "").rstrip()

            # Ensure content ends with one newline
            if content and not content.endswith("\n"):
                content += "\n"

            content += line + "\n"

            f.seek(0)
            f.truncate()
            f.write(content)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)

    return line


def capture_batch(items: list[str], source: str = "manual") -> int:
    """
    Append multiple items to inbox at once (still uses file locking).

    Args:
        items: List of item texts to capture
        source: Source identifier

    Returns:
        Number of items written
    """
    for item in items:
        capture_to_inbox(item, source=source)
    return len(items)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
        result = capture_to_inbox(text, source="cli")
        print(f"Captured: {result}")
    else:
        # Demo with sample data
        sample_items = [
            "Call accountant about Q1 taxes",
            "Research new project management tools",
            "Follow up with Sarah on proposal",
        ]
        count = capture_batch(sample_items, source="demo")
        print(f"Captured {count} items to inbox")

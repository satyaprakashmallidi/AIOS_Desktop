"""
Daily Brief — Adaptive Mega-Prompt Builder

Assembles all available intelligence into a single prompt for Gemini:
- Business context (from ContextOS files)
- Funnel metrics (from DataOS database)
- Meeting transcripts (from IntelOS, if installed)
- Slack messages (from IntelOS, if installed)

The prompt adapts to what the user actually has — if they don't have
meetings or Slack, those sections are simply omitted.
"""

import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent


# ============================================================
# BRIEF PRESETS — Configurable report structures
# ============================================================

PRESETS = {
    "solo": {
        "name": "Solo Operator",
        "sections": [
            "executive_summary",
            "key_signals",
            "metrics_analysis",
            "action_items",
        ],
        "word_budget": 1500,
        "pdf_pages": "1-2",
    },
    "small_team": {
        "name": "Small Team",
        "sections": [
            "executive_summary",
            "key_signals",
            "metrics_analysis",
            "meeting_highlights",
            "slack_digest",
            "strategic_recommendations",
            "action_items",
        ],
        "word_budget": 3000,
        "pdf_pages": "3-5",
    },
    "agency": {
        "name": "Agency",
        "sections": [
            "executive_summary",
            "key_signals",
            "metrics_analysis",
            "department_analysis",
            "meeting_highlights",
            "slack_digest",
            "cross_stream_patterns",
            "strategic_recommendations",
            "action_items",
        ],
        "word_budget": 6000,
        "pdf_pages": "8-15",
    },
}


# ============================================================
# CONTEXT LOADING
# ============================================================

def load_business_context():
    """Load business context from ContextOS files.

    Reads whatever context files exist — adapts to the user's setup.
    Returns a single text block with all context concatenated.
    """
    # Priority-ordered list of context files to try
    context_files = [
        "context/overview.md",
        "context/group/overview.md",
        "context/strategy.md",
        "context/group/strategy.md",
        "context/team.md",
        "context/group/team.md",
        "context/about-me.md",
        "context/current-state.md",
        "context/funnel.md",
        "context/group/funnel.md",
        "context/group/key-metrics.md",
        "context/key-metrics.md",
    ]

    blocks = []
    loaded = set()

    for rel_path in context_files:
        full_path = WORKSPACE_ROOT / rel_path
        if full_path.exists():
            # Avoid loading both context/X.md and context/group/X.md
            filename = full_path.name
            if filename in loaded:
                continue
            loaded.add(filename)

            try:
                content = full_path.read_text()
                if content.strip():
                    blocks.append(f"=== {rel_path} ===\n{content}")
            except Exception:
                pass

    return "\n\n".join(blocks) if blocks else "No business context available."


def load_meeting_transcripts(conn, target_date):
    """Load meeting transcripts from IntelOS database tables.

    Groups by department/stream if the meetings table has been classified.
    Returns formatted text block, or empty string if no meetings table.
    """
    try:
        # Check if meetings table exists
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'"
        ).fetchone()
        if not row:
            return ""

        # Pull meetings from the target date
        meetings = conn.execute(
            "SELECT * FROM meetings WHERE date = ? ORDER BY start_time",
            (target_date,),
        ).fetchall()

        if not meetings:
            # Try a wider window (some recorders have lag)
            yesterday = (
                datetime.strptime(target_date, "%Y-%m-%d") - timedelta(days=1)
            ).strftime("%Y-%m-%d")
            meetings = conn.execute(
                "SELECT * FROM meetings WHERE date BETWEEN ? AND ? ORDER BY date, start_time",
                (yesterday, target_date),
            ).fetchall()

        if not meetings:
            return ""

        blocks = []
        for i, m in enumerate(meetings, 1):
            m = dict(m)
            title = m.get("title") or "Untitled"
            date = m.get("date", "")
            duration = m.get("duration_minutes") or "?"
            stream = m.get("stream") or "general"
            participants = m.get("participants") or "Unknown"
            transcript = m.get("transcript_text") or "(No transcript)"

            header = (
                f"--- CALL {i}: {title} | {date} | {duration} min ---\n"
                f"Department: {stream}\n"
                f"Participants: {participants}"
            )
            blocks.append(f"{header}\n\n{transcript}")

        return "\n\n\n".join(blocks)

    except Exception:
        return ""


def load_slack_messages(conn, target_date):
    """Load Slack messages from IntelOS database tables.

    Returns formatted text block, or empty string if no Slack data.
    """
    try:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='slack_messages'"
        ).fetchone()
        if not row:
            return ""

        # Pull messages from the target date
        messages = conn.execute(
            "SELECT * FROM slack_messages WHERE date(ts) = ? "
            "ORDER BY workspace, channel_name, ts",
            (target_date,),
        ).fetchall()

        # Fall back to collected_at date if ts doesn't have date component
        if not messages:
            messages = conn.execute(
                "SELECT * FROM slack_messages WHERE date(collected_at) = ? "
                "ORDER BY workspace, channel_name, ts",
                (target_date,),
            ).fetchall()

        if not messages:
            return ""

        # Group by workspace → channel
        grouped = {}
        for msg in messages:
            msg = dict(msg)
            workspace = msg.get("workspace", "main")
            channel = msg.get("channel_name") or msg.get("channel_id", "unknown")
            key = f"{workspace}/{channel}"
            if key not in grouped:
                grouped[key] = []
            user = msg.get("user_name") or "Unknown"
            text = msg.get("text") or ""
            grouped[key].append(f"[{user}] {text}")

        blocks = []
        for channel, msgs in grouped.items():
            blocks.append(f"--- #{channel} ({len(msgs)} messages) ---")
            blocks.append("\n".join(msgs[:50]))  # Cap at 50 per channel

        return "\n\n".join(blocks)

    except Exception:
        return ""


# ============================================================
# MEGA-PROMPT ASSEMBLY
# ============================================================

def build_mega_prompt(metrics_text, context_text, meetings_text="",
                      slack_text="", preset="small_team",
                      custom_sections=None):
    """Assemble the full mega-prompt for Gemini.

    Args:
        metrics_text: Formatted funnel metrics (from metrics.py)
        context_text: Business context (from load_business_context)
        meetings_text: Meeting transcripts (from load_meeting_transcripts)
        slack_text: Slack messages (from load_slack_messages)
        preset: Which preset template to use
        custom_sections: Override preset sections with a custom list

    Returns:
        Complete prompt string ready for Gemini
    """
    config = PRESETS.get(preset, PRESETS["small_team"])
    sections = custom_sections or config["sections"]
    word_budget = config["word_budget"]

    # Build the section instruction
    section_instructions = _build_section_instructions(
        sections, word_budget, bool(meetings_text), bool(slack_text)
    )

    prompt_parts = [
        _build_system_instruction(sections, word_budget),
        "\n\n=== BUSINESS CONTEXT ===\n",
        context_text,
        "\n\n=== FUNNEL METRICS ===\n",
        metrics_text,
    ]

    if meetings_text:
        prompt_parts.append("\n\n=== MEETING TRANSCRIPTS ===\n")
        prompt_parts.append(meetings_text)

    if slack_text:
        prompt_parts.append("\n\n=== SLACK MESSAGES ===\n")
        prompt_parts.append(slack_text)

    prompt_parts.append("\n\n=== OUTPUT INSTRUCTIONS ===\n")
    prompt_parts.append(section_instructions)

    return "".join(prompt_parts)


def _build_system_instruction(sections, word_budget):
    """Build the system-level instruction for Gemini."""
    return f"""You are writing a daily intelligence brief for a business owner. You have been given their full business context, funnel metrics, and (if available) meeting transcripts and Slack messages from the past day.

Your job is to SYNTHESIZE — not summarize. Connect dots across data sources. Spot patterns. Flag things that need attention. Be specific: names, numbers, percentages, direct quotes.

RULES:
- Total output: approximately {word_budget} words
- Use the currency specified in the funnel metrics section
- Lead with the single most important signal — the one thing the owner needs to know first
- Compare metrics to 7-day averages — say "above/below average" with specific numbers
- If meeting transcripts are provided, extract key decisions, action items, and notable signals
- If Slack messages are provided, highlight important threads and decisions
- Write with conviction, not caution — this is a trusted advisor briefing, not a cautious report
- Use markdown headers (## for sections)
- Be specific: "$53K from 3 deals" not "good revenue day"
- If data is missing for a section, skip it entirely — do not write "No data available"
"""


def _build_section_instructions(sections, word_budget, has_meetings, has_slack):
    """Build per-section output instructions."""
    # Word budget per section (roughly proportional)
    budget_map = {
        "executive_summary": 300,
        "key_signals": 200,
        "metrics_analysis": 400,
        "meeting_highlights": 500,
        "department_analysis": 800,
        "slack_digest": 400,
        "cross_stream_patterns": 400,
        "strategic_recommendations": 500,
        "action_items": 200,
    }

    section_defs = {
        "executive_summary": (
            "## The Day in Brief\n"
            "Write a 200-300 word narrative that tells the story of what happened. "
            "Flowing prose, no bullet points. Lead with the single most important signal. "
            "Connect metrics to causes (new content? weekend? campaign?). "
            "End with one sentence on what to watch today."
        ),
        "key_signals": (
            "## Key Signals\n"
            "8-12 one-line signals, each starting with an emoji:\n"
            "🔥 = wins, momentum, deals closed\n"
            "⚠️ = risks, drops, blockers\n"
            "📌 = recurring patterns, strategic themes\n"
            "💡 = opportunities, ideas\n"
            "📊 = notable metric movements\n"
            "Every signal must be specific: names, numbers, quotes. No generic observations."
        ),
        "metrics_analysis": (
            "## Metrics Analysis\n"
            "Analyze the funnel metrics by stage. For each stage with data:\n"
            "- What happened (specific numbers vs averages)\n"
            "- Why it might have happened (connect to events, content, campaigns)\n"
            "- What it means for the business\n"
            "Focus on movements and anomalies, not just reporting flat numbers."
        ),
        "meeting_highlights": (
            "## Meeting Highlights\n"
            "For each meeting/call:\n"
            "- Key decisions made\n"
            "- Action items (who committed to what)\n"
            "- Notable signals (prospects, risks, opportunities)\n"
            "- Direct quotes where compelling\n"
            "Group by department if meetings span multiple teams."
            if has_meetings
            else None
        ),
        "department_analysis": (
            "## Department Analysis\n"
            "Break down meetings by department/stream. For each:\n"
            "- Team patterns (what's working, what's struggling)\n"
            "- Individual performance signals\n"
            "- Curriculum/process gaps (coaching calls)\n"
            "- Retention signals (success calls)\n"
            "- Pipeline health (sales calls)\n"
            "Be specific — name people, quote them, cite patterns."
            if has_meetings
            else None
        ),
        "slack_digest": (
            "## Slack Digest\n"
            "Highlight the most important Slack threads:\n"
            "- Decisions made\n"
            "- Requests needing response\n"
            "- Team dynamics signals\n"
            "- Anything the owner should know about or respond to\n"
            "Skip channels with nothing notable."
            if has_slack
            else None
        ),
        "cross_stream_patterns": (
            "## Cross-Stream Patterns\n"
            "Identify 2-4 patterns that ONLY become visible by combining intelligence "
            "across multiple sources (metrics + meetings + Slack). Each pattern should:\n"
            "- Name the pattern in a bold heading\n"
            "- Explain the connection with specific evidence from 2+ sources\n"
            "- State why it matters right now\n"
            "Skip obvious observations — only genuinely surprising connections."
            if (has_meetings or has_slack)
            else None
        ),
        "strategic_recommendations": (
            "## Strategic Recommendations\n"
            "Based on everything you've read:\n"
            "1. **Concerns** (1-3) — things that should worry leadership. Be specific.\n"
            "2. **Opportunities** (1-3) — things to capitalize on right now.\n"
            "3. **Quick SWOT** — 1 sentence each: Strength, Weakness, Opportunity, Threat "
            "(based on today's data only).\n"
            "Every recommendation should be actionable by a specific person or team."
        ),
        "action_items": (
            "## Action Items\n"
            "Consolidated list of everything that needs doing:\n"
            "- Tasks extracted from meetings (who, what, deadline)\n"
            "- Responses needed from Slack\n"
            "- Metric-driven actions (e.g., 'investigate churn spike')\n"
            "Prioritize by urgency. Maximum 10 items."
        ),
    }

    instructions = [
        "Produce the following sections in this exact order. "
        "Use ## markdown headers exactly as shown.\n"
    ]

    for section in sections:
        definition = section_defs.get(section)
        if definition is None:
            continue
        budget = budget_map.get(section, 300)
        instructions.append(f"\n{definition}\n(~{budget} words)")

    return "\n".join(instructions)


if __name__ == "__main__":
    """Quick test — show what context is available."""
    ctx = load_business_context()
    token_estimate = len(ctx) // 4
    print(f"Business context loaded: ~{token_estimate:,} tokens")
    print(f"Files found: {ctx.count('===') // 2}")
    print()
    for preset_key, preset_val in PRESETS.items():
        print(f"Preset '{preset_key}' ({preset_val['name']}):")
        print(f"  Sections: {', '.join(preset_val['sections'])}")
        print(f"  Word budget: ~{preset_val['word_budget']} words")
        print(f"  PDF length: {preset_val['pdf_pages']} pages")

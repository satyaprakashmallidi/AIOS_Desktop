"""
Daily Brief — Telegram Delivery

Sends the daily brief to a dedicated Telegram topic:
1. Funnel dashboard PNG (sendPhoto)
2. Executive summary + key signals (sendMessage, HTML)
3. Full report as PDF (sendDocument) — if PDF generation available

Also handles topic creation and caching.
"""

import asyncio
import json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
TOPIC_CACHE_PATH = WORKSPACE_ROOT / "data" / "daily-brief-topic.json"

TELEGRAM_MESSAGE_LIMIT = 4096


def _md_to_telegram_html(text):
    """Convert markdown formatting to Telegram HTML.

    Handles: **bold** → <b>, *italic* → <i>, ## headers → <b>
    Strips other markdown syntax that Telegram doesn't support.
    """
    if not text:
        return ""
    # Headers → bold
    text = re.sub(r"^## (.+)$", r"<b>\1</b>", text, flags=re.MULTILINE)
    text = re.sub(r"^### (.+)$", r"<b>\1</b>", text, flags=re.MULTILINE)
    # Bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    # Italic
    text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
    return text


def _truncate_at_sentence(text, max_chars):
    """Truncate text at the nearest sentence boundary before max_chars."""
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    for end in [". ", ".\n", "! ", "!\n", "? ", "?\n"]:
        idx = truncated.rfind(end)
        if idx > max_chars * 0.5:
            return truncated[: idx + 1].rstrip()
    last_nl = truncated.rfind("\n")
    if last_nl > max_chars * 0.5:
        return truncated[:last_nl].rstrip()
    return truncated.rstrip() + "..."


def extract_sections(brief_text):
    """Extract named sections from the brief markdown.

    Returns dict mapping section names to their content.
    """
    sections = {}
    current = None
    current_lines = []

    for line in brief_text.split("\n"):
        if line.startswith("## "):
            if current:
                sections[current] = "\n".join(current_lines).strip()
            current = line.lstrip("# ").strip()
            current_lines = []
        elif current:
            current_lines.append(line)

    if current:
        sections[current] = "\n".join(current_lines).strip()

    return sections


def build_telegram_messages(brief_text, date):
    """Build Telegram messages from the brief text.

    Returns list of (text, parse_mode) tuples.
    """
    sections = extract_sections(brief_text)
    messages = []

    # Message 1: Executive summary + key signals
    parts = []

    summary = sections.get("The Day in Brief", "")
    if summary:
        parts.append(f"<b>📋 THE DAY IN BRIEF — {date}</b>\n")
        html_summary = _md_to_telegram_html(summary)
        if len(html_summary) > 1800:
            html_summary = _truncate_at_sentence(html_summary, 1800)
        parts.append(html_summary)

    signals = sections.get("Key Signals", "")
    if signals:
        parts.append(f"\n\n<b>🔥 KEY SIGNALS</b>\n")
        html_signals = _md_to_telegram_html(signals)
        if len(html_signals) > 1200:
            html_signals = _truncate_at_sentence(html_signals, 1200)
        parts.append(html_signals)

    if parts:
        msg1 = "\n".join(parts)
        if len(msg1) > TELEGRAM_MESSAGE_LIMIT:
            msg1 = _truncate_at_sentence(msg1, TELEGRAM_MESSAGE_LIMIT - 10)
        messages.append((msg1, "HTML"))

    # Message 2: Strategic content (recommendations + action items)
    strat_parts = []

    recs = sections.get("Strategic Recommendations", "")
    if recs:
        strat_parts.append("<b>⚡ STRATEGIC RECOMMENDATIONS</b>\n")
        html_recs = _md_to_telegram_html(recs)
        if len(html_recs) > 2000:
            html_recs = _truncate_at_sentence(html_recs, 2000)
        strat_parts.append(html_recs)

    actions = sections.get("Action Items", "")
    if actions:
        strat_parts.append("\n\n<b>📋 ACTION ITEMS</b>\n")
        html_actions = _md_to_telegram_html(actions)
        if len(html_actions) > 1500:
            html_actions = _truncate_at_sentence(html_actions, 1500)
        strat_parts.append(html_actions)

    if strat_parts:
        msg2 = "\n".join(strat_parts)
        if len(msg2) > TELEGRAM_MESSAGE_LIMIT:
            msg2 = _truncate_at_sentence(msg2, TELEGRAM_MESSAGE_LIMIT - 10)
        messages.append((msg2, "HTML"))

    return messages


async def _get_or_create_topic(bot, group_id, topic_name="📊 Daily Brief"):
    """Find or create a forum topic in the Telegram group.

    Caches the topic ID to avoid re-creating.
    """
    if TOPIC_CACHE_PATH.exists():
        try:
            cache = json.loads(TOPIC_CACHE_PATH.read_text())
            cached_id = cache.get("topic_id")
            if cached_id:
                return cached_id
        except (json.JSONDecodeError, KeyError):
            pass

    try:
        result = await bot.create_forum_topic(
            chat_id=group_id, name=topic_name
        )
        topic_id = result.message_thread_id
        TOPIC_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOPIC_CACHE_PATH.write_text(json.dumps({"topic_id": topic_id}))
        logger.info(f"Created forum topic '{topic_name}' (id: {topic_id})")
        return topic_id
    except Exception as e:
        error_str = str(e)
        if any(k in error_str.upper() for k in ["FORUM", "TOPIC", "400"]):
            logger.info("Forum topics not enabled — sending without topic")
            return None
        logger.warning(f"Could not create forum topic: {e}")
        return None


async def _send_to_telegram(image_bytes, messages, date, topic_id_override=None):
    """Send dashboard image and messages to Telegram."""
    from aiogram import Bot
    from aiogram.types import BufferedInputFile

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    group_id_str = os.environ.get("TELEGRAM_GROUP_ID")

    if not bot_token or not group_id_str:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID must be set in .env"
        )

    group_id = int(group_id_str)
    bot = Bot(token=bot_token)

    try:
        # Determine topic
        topic_id = topic_id_override
        if topic_id is None:
            env_topic = os.environ.get("TELEGRAM_DAILY_BRIEF_TOPIC_ID")
            if env_topic:
                topic_id = int(env_topic)
            else:
                topic_id = await _get_or_create_topic(bot, group_id)

        # 1. Send dashboard image
        if image_bytes:
            photo = BufferedInputFile(image_bytes, filename=f"brief-{date}.png")
            await bot.send_photo(
                chat_id=group_id,
                photo=photo,
                caption=f"📊 Daily Brief — {date}",
                message_thread_id=topic_id,
            )

        # 2. Send text messages
        for text, parse_mode in messages:
            await bot.send_message(
                chat_id=group_id,
                text=text,
                parse_mode=parse_mode,
                message_thread_id=topic_id,
            )

        return True
    finally:
        await bot.session.close()


def deliver_brief(image_bytes, brief_text, date):
    """Send the daily brief to Telegram.

    Args:
        image_bytes: Dashboard PNG bytes (or None)
        brief_text: Full markdown brief text
        date: Date string for captions

    Returns:
        True if delivered, False on error
    """
    messages = build_telegram_messages(brief_text, date)

    try:
        return asyncio.run(
            _send_to_telegram(image_bytes, messages, date)
        )
    except Exception as e:
        logger.error(f"Telegram delivery failed: {e}")
        return False


if __name__ == "__main__":
    """Quick test — build messages from sample brief text."""
    sample = """## The Day in Brief
Yesterday was a strong day. Revenue hit $12,400 from 2 new deals, above the 7-day average of $8,200. YouTube views were up at 15,234 vs the usual 12,100 — likely driven by the new video on AI automation published Tuesday.

Demo bookings held steady at 8, right on the weekly average. The sales pipeline looks healthy heading into March.

Watch today: the webinar follow-up sequence kicks off at 9am.

## Key Signals
🔥 **Two new deals closed** — $12,400 total, both from webinar attendees
📊 **YouTube views up 26%** vs 7-day average (15,234 vs 12,100)
⚠️ **Churn tick up** — 3 cancellations yesterday vs 1.5 daily average
💡 **Demo booking from enterprise lead** — Fortune 500 company, potential $50K deal

## Strategic Recommendations
### Concerns
1. **Churn acceleration** — 3 cancellations in one day. Check if related to billing cycle or product issue.

### Opportunities
1. **Enterprise lead** — Fast-track the Fortune 500 demo. Prepare case studies.

## Action Items
- [ ] Review 3 churn cases — check reasons and timing
- [ ] Prep enterprise demo materials by Thursday
- [ ] Follow up on webinar attendee who asked about custom pricing
"""
    messages = build_telegram_messages(sample, "2026-02-27")
    for i, (text, mode) in enumerate(messages, 1):
        print(f"--- Message {i} ({mode}, {len(text)} chars) ---")
        print(text[:200] + "..." if len(text) > 200 else text)
        print()

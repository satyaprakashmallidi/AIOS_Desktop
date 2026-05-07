#!/usr/bin/env python3
"""
Daily Brief — Main Orchestrator

Generates your morning intelligence brief by pulling data from all
connected sources, synthesizing with Gemini, and delivering to Telegram.

Usage:
    python scripts/daily_brief.py                    # Yesterday's brief
    python scripts/daily_brief.py --date 2026-02-26  # Specific date
    python scripts/daily_brief.py --dry-run           # Preview without sending
    python scripts/daily_brief.py --no-deliver        # Save only, skip Telegram
    python scripts/daily_brief.py --preset agency     # Use agency preset
    python scripts/daily_brief.py --test              # Quick test (dry run + print)
"""

import argparse
import json
import logging
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("daily_brief")

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = WORKSPACE_ROOT / "outputs" / "daily-brief"
DB_PATH = WORKSPACE_ROOT / "data" / "data.db"


def _get_db_connection():
    """Get a database connection. Uses DataOS db.py if available."""
    try:
        from scripts.db import get_connection
        return get_connection()
    except ImportError:
        if not DB_PATH.exists():
            logger.error(f"Database not found at {DB_PATH}")
            logger.error("Run DataOS collection first: python scripts/collect.py")
            sys.exit(1)
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        return conn


def _call_gemini(prompt, model=None):
    """Call Gemini API for synthesis.

    Returns: {"text": str, "input_tokens": int, "output_tokens": int, "cost_usd": float}
    """
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY not set in .env")
        sys.exit(1)

    model = model or os.environ.get("BRIEF_MODEL", "gemini-2.5-flash")
    client = genai.Client(api_key=api_key)

    # Pricing per 1M tokens
    pricing = {
        "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
        "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
        "gemini-3-pro-preview": {"input": 2.00, "output": 12.00},
        "gemini-3.1-pro-preview": {"input": 2.00, "output": 12.00},
    }

    model_pricing = pricing.get(model, pricing["gemini-2.5-flash"])

    config = types.GenerateContentConfig(
        max_output_tokens=16384,
        temperature=0.3,
        http_options=types.HttpOptions(timeout=300_000),
    )

    try:
        response = client.models.generate_content(
            model=model, contents=prompt, config=config
        )
        input_tokens = response.usage_metadata.prompt_token_count
        output_tokens = response.usage_metadata.candidates_token_count
        cost = (
            input_tokens * model_pricing["input"] / 1_000_000
            + output_tokens * model_pricing["output"] / 1_000_000
        )

        logger.info(
            f"Gemini: {input_tokens:,} in, {output_tokens:,} out, ${cost:.4f}"
        )

        return {
            "text": response.text or "",
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost,
            "model": model,
        }
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return {"text": "", "error": str(e), "cost_usd": 0.0}


def run_daily_brief(target_date=None, preset="small_team", dry_run=False,
                    deliver=True, model=None):
    """Run the full daily brief pipeline.

    Args:
        target_date: YYYY-MM-DD (default: yesterday)
        preset: "solo", "small_team", or "agency"
        dry_run: If True, print to stdout and skip saving/delivery
        deliver: If True, send to Telegram
        model: Override Gemini model

    Returns:
        Path to saved brief, or brief text if dry_run
    """
    if target_date is None:
        target_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    logger.info(f"Generating daily brief for {target_date} (preset: {preset})")

    # 1. Connect to database
    conn = _get_db_connection()

    # 2. Build funnel metrics
    from scripts.metrics import build_funnel_metrics, format_metrics_text

    funnel_metrics = build_funnel_metrics(conn, target_date)
    metrics_text = format_metrics_text(funnel_metrics)
    logger.info(
        f"Funnel metrics: {len(funnel_metrics.get('stages', []))} stages loaded"
    )

    # 3. Load business context
    from scripts.prompt import load_business_context

    context_text = load_business_context()
    logger.info(f"Business context: ~{len(context_text) // 4:,} tokens")

    # 4. Load meeting transcripts (if IntelOS is installed)
    from scripts.prompt import load_meeting_transcripts

    meetings_text = load_meeting_transcripts(conn, target_date)
    if meetings_text:
        logger.info(f"Meeting transcripts: ~{len(meetings_text) // 4:,} tokens")
    else:
        logger.info("No meeting transcripts (IntelOS meetings not found or empty)")

    # 5. Load Slack messages (if IntelOS Slack is installed)
    from scripts.prompt import load_slack_messages

    slack_text = load_slack_messages(conn, target_date)
    if slack_text:
        logger.info(f"Slack messages: ~{len(slack_text) // 4:,} tokens")
    else:
        logger.info("No Slack messages (IntelOS Slack not found or empty)")

    # 6. Build the mega-prompt
    from scripts.prompt import build_mega_prompt

    mega_prompt = build_mega_prompt(
        metrics_text=metrics_text,
        context_text=context_text,
        meetings_text=meetings_text,
        slack_text=slack_text,
        preset=preset,
    )
    logger.info(f"Mega-prompt assembled: ~{len(mega_prompt) // 4:,} tokens")

    # 7. Call Gemini
    result = _call_gemini(mega_prompt, model=model)

    if result.get("error"):
        logger.error(f"Brief generation failed: {result['error']}")
        conn.close()
        return None

    brief_text = result["text"]

    # 8. Add metadata header
    header = (
        f"# Daily Brief — {target_date}\n\n"
        f"> Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        f"> Model: {result.get('model', 'unknown')}\n"
        f"> Tokens: {result.get('input_tokens', 0):,} in / "
        f"{result.get('output_tokens', 0):,} out\n"
        f"> Cost: ${result.get('cost_usd', 0):.4f}\n"
        f"> Preset: {preset}\n\n---\n\n"
    )
    full_brief = header + brief_text

    if dry_run:
        conn.close()
        return full_brief

    # 9. Save to file
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{target_date}.md"
    output_path.write_text(full_brief)
    logger.info(f"Brief saved to: {output_path}")

    # 10. Generate dashboard image
    image_bytes = None
    try:
        from scripts.dashboard import generate_dashboard_image
        image_bytes = generate_dashboard_image(funnel_metrics)
        logger.info(f"Dashboard image: {len(image_bytes):,} bytes")
    except Exception:
        logger.exception("Dashboard image generation failed (continuing without it)")

    # 11. Deliver to Telegram
    if deliver:
        try:
            from scripts.deliver import deliver_brief
            delivered = deliver_brief(image_bytes, brief_text, target_date)
            if delivered:
                logger.info("Brief delivered to Telegram")
            else:
                logger.warning("Telegram delivery failed (brief still saved to file)")
        except Exception:
            logger.exception("Telegram delivery error (brief still saved to file)")

    conn.close()

    logger.info(
        f"Daily brief complete. Cost: ${result.get('cost_usd', 0):.4f}. "
        f"Saved to: {output_path}"
    )
    return str(output_path)


def main():
    parser = argparse.ArgumentParser(description="Daily Brief Generator")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD, default: yesterday)")
    parser.add_argument(
        "--preset",
        choices=["solo", "small_team", "agency"],
        default=None,
        help="Report preset (default: from .env or small_team)",
    )
    parser.add_argument("--model", help="Override Gemini model")
    parser.add_argument(
        "--dry-run", action="store_true", help="Print brief to stdout, don't save"
    )
    parser.add_argument(
        "--deliver", action="store_true", default=True,
        help="Send to Telegram (default: True)"
    )
    parser.add_argument(
        "--no-deliver", dest="deliver", action="store_false",
        help="Skip Telegram delivery"
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Quick test mode (dry run + print)"
    )
    args = parser.parse_args()

    preset = args.preset or os.environ.get("BRIEF_PRESET", "small_team")

    if args.test:
        result = run_daily_brief(
            target_date=args.date,
            preset=preset,
            dry_run=True,
            deliver=False,
            model=args.model,
        )
        if result:
            print(result)
        else:
            print("Brief generation failed. Check logs above.")
        return

    result = run_daily_brief(
        target_date=args.date,
        preset=preset,
        dry_run=args.dry_run,
        deliver=args.deliver and not args.dry_run,
        model=args.model,
    )

    if args.dry_run and result:
        print(result)
    elif result:
        print(f"Brief saved to: {result}")
    else:
        print("Brief generation failed. Check logs above.")
        sys.exit(1)


if __name__ == "__main__":
    main()

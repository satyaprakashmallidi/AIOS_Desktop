# IntelOS

> Give your AI a perfect memory — every meeting and message, searchable forever.

## What This Does

- **Collects meeting recordings** automatically from Fireflies, Fathom, or your custom recorder into a searchable database
- **Collects Slack messages** daily — every channel, every thread, resolved to real names
- **Classifies meetings** by department/team so you can filter by stream (sales, engineering, etc.)
- **Instant search** — ask your AI to find any meeting or Slack conversation by person, topic, or date

## What You Need

- A computer (Mac or Linux)
- Claude Code installed
- ContextOS + DataOS modules installed (or willingness to run standalone)
- A meeting recorder account: [Fireflies](https://fireflies.ai) (free tier) or [Fathom](https://fathom.ai) (free tier) — or your existing recorder
- A Slack workspace (optional)

## How to Install

1. Give this folder to Claude Code
2. Say: "Read INSTALL.md and help me set this up"
3. Follow along — Claude handles everything

**Estimated setup time:** 20-30 minutes

## Running Cost

- **Meeting collection:** Free (Fireflies and Fathom both have free tiers)
- **Slack collection:** Free (Slack API is free for reading messages)
- **Storage:** Free (SQLite on your machine, grows ~1MB per 100 meetings)
- **Total: $0/month** for basic usage

## What's Inside

| File | Purpose |
|------|---------|
| `INSTALL.md` | Installation guide (Claude reads this) |
| `scripts/db.py` | Database setup and query helpers |
| `scripts/collect_fireflies.py` | Fireflies meeting collector |
| `scripts/collect_fathom.py` | Fathom meeting collector |
| `scripts/collect_slack.py` | Slack message collector |
| `scripts/classify.py` | Meeting classifier (by department) |
| `scripts/collect_all.py` | Master collection script (runs all collectors) |
| `scripts/.env.example` | API key template |
| `config/com.aios.intel-collect.plist` | macOS scheduling template |

---

> A plug-and-play module from Liam Ottley's AAA Accelerator — the #1 AI business launch
> & AIOS program. Grab this and 15+ more at [aaaaccelerator.com](https://aaaaccelerator.com)

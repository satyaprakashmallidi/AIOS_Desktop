# ProductivityOS

> A complete Getting Things Done system for your business — capture everything, process it, track it, review it weekly.

| Field | Value |
|-------|-------|
| Module | `productivity-os` |
| Version | v1 |
| Status | RELEASED |
| Released | 2026-02-26 |
| Phase | 3 - Productivity |
| Requires | Phase 1 (ContextOS) |
| Setup Time | 10-15 minutes |
| Running Cost | Free |

## What This Does

- **One inbox** captures everything from your head, meetings, voice notes, and conversations
- **Decision tree processing** routes every item to the right place (projects, actions, waiting-for, someday, trash)
- **Dashboard** shows all active projects, next actions, and delegated items at a glance — auto-refreshed after every change
- **Weekly review** walks you through a guided 4-phase process to keep the whole system trustworthy
- **Context-based actions** organize your to-do list by what you need (at computer, on calls, with team, etc.)

## What You Need

- A computer (Mac or Linux)
- Claude Code installed

## How to Install

1. Give this folder to Claude Code
2. Say: "Read INSTALL.md and help me set this up"
3. Follow along — Claude handles everything

## What's Inside

| File | Purpose |
|------|---------|
| `INSTALL.md` | Installation guide (Claude reads this) |
| `templates/*.md` | GTD file templates (inbox, projects, actions, etc.) |
| `templates/process-command.md` | /process command for inbox processing |
| `templates/review-command.md` | /review command for weekly reviews |
| `reference/gtd-methodology.md` | Full GTD methodology reference |
| `scripts/refresh_dashboard.py` | Dashboard auto-refresh script |
| `scripts/inbox_writer.py` | Safe concurrent inbox appends |

---

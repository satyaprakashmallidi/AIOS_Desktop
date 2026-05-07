# Daily Brief — AIOS Module

Wake up to an AI-synthesized morning intelligence report covering your business metrics, meeting highlights, Slack activity, and strategic recommendations — delivered to your phone before you start work.

## What It Does

Every morning, a single Gemini call processes all your connected data sources and produces:

- **Dashboard image** — Your funnel metrics vs 7-day averages, color-coded
- **Narrative brief** — The story of yesterday in 200-300 words
- **Key signals** — 8-12 specific signals that need your attention
- **Meeting highlights** — Decisions, action items, notable signals from calls
- **Strategic recommendations** — What to do about what you're seeing

Delivered to a dedicated Telegram topic. Reply to drill into anything.

## Prerequisites

| Module | Phase | Why |
|--------|-------|-----|
| ContextOS | 1 | Business context for the AI |
| DataOS | 1 | Funnel metrics + database |
| IntelOS | 2 | Meeting transcripts + Slack messages |
| CommandOS | 2 | Telegram bot for delivery |

## Presets

| Preset | Sections | PDF Length | Best For |
|--------|----------|-----------|----------|
| Solo Operator | Metrics + signals + narrative + actions | 1-2 pages | Solo founders |
| Small Team | Above + meetings + Slack + strategic recs | 3-5 pages | Teams of 3-10 |
| Agency | Full analysis + per-department + cross-stream | 8-15 pages | Agencies with multiple departments |

## Cost

~$1-3/month (one Gemini API call per day)

## Setup

Open Claude Code, read INSTALL.md, and say: "Help me set up the Daily Brief."

Setup time: 20-30 minutes.

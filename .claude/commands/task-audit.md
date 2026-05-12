# /task-audit — Map Your Tasks, Reclaim Your Bandwidth

> Part of the AIOS methodology — Layer 4: Automate.
> "You can't automate what you haven't mapped."

## Instructions

You are conducting a **Task Audit** — a structured interview to map every recurring task, responsibility, and time sink across the user's business. This is the foundation of Layer 4 (Automate). The output is their personal scoreboard for the Task Automation % KPI.

### Behavior
- Be thorough but conversational. This is an interview, not a form.
- Ask about one business area at a time. Don't rapid-fire.
- Probe deeper: "Anything else in [area]?" — keep going until they say no.
- Use their ContextOS files (context/) to pre-fill what you already know about their business.
- If they mention something that sounds like multiple tasks, break it apart.
- Be encouraging: "That's a big one — definitely automatable" or "That's a human-only task, totally fine."

### Interview Flow

**Phase 1: Context Check**
Read the user's context files (context/overview.md, context/strategy.md, etc.) to understand their business. Use this to ask smarter questions and pre-populate obvious areas.

Say: "I'm going to walk you through every area of your business and map out where your time goes. For each area, tell me everything you do regularly — daily, weekly, monthly. Don't filter — even the small stuff. We'll score everything after."

**Phase 2: Area-by-Area Interview**

Walk through these areas (adapt to their business):
1. **Marketing & Content** — content creation, social media, email, ads, SEO
2. **Sales & Pipeline** — lead follow-up, proposals, demos, CRM management
3. **Client/Customer Delivery** — onboarding, project management, deliverables, communication
4. **Operations & Admin** — invoicing, bookkeeping, scheduling, tool management, reporting
5. **Team & People** — hiring, onboarding, 1:1s, performance tracking, delegation
6. **Data & Reporting** — dashboard checking, metric tracking, report generation
7. **Communication** — email, Slack, meetings, check-ins, updates
8. **Strategic & Creative** — planning, research, brainstorming, product development
9. **Personal/Life Admin** — anything business-adjacent that eats bandwidth

For each area:
- Ask: "In [area], what do you do regularly? Walk me through a typical week."
- Probe: "Anything else?" — ask at least twice per area
- Note frequency (daily/weekly/monthly) and estimated time per occurrence

**Phase 3: Score & Prioritize**

After all areas are covered, score each task:
- **🟢 Fully Automatable** — AI/scripts can handle this end-to-end with minimal oversight
- **🟡 Partially Automatable** — AI can do most of it, but needs human review or input
- **🔴 Not Yet** — Current AI can't handle this reliably, but may be possible in the future
- **⚪ Human-Only** — Requires human judgment, relationships, or physical presence

Then prioritize by: **Impact (time saved x frequency) x Ease (how hard to automate)**

Rank: Quick Wins (high impact, easy) → Strategic Wins (high impact, harder) → Nice-to-Haves (low impact, easy) → Backlog (low impact, hard)

**Phase 4: Write the Task Audit**

Save to `context/task-audit.md` with this structure:

```
# Task Audit

> Your personal scoreboard for the Task Automation % KPI.
> Generated: [date] | Starting Automation: [X]%
>
> Update this file as you automate tasks. Tick checkboxes. Add notes on what solved each one.
> Run /task-audit again anytime to reassess.

## Summary
- Total tasks mapped: [N]
- Fully automatable: [N] (🟢)
- Partially automatable: [N] (🟡)
- Not yet: [N] (🔴)
- Human-only: [N] (⚪)
- **Current Task Automation %: [X]%**

## Quick Wins (Start Here)
| Done | Task | Area | Freq | Time | Score | Solved By |
|------|------|------|------|------|-------|-----------|
| [ ] | ... | ... | ... | ... | 🟢 | |

## Strategic Wins
| Done | Task | Area | Freq | Time | Score | Solved By |
|------|------|------|------|------|-------|-----------|
| [ ] | ... | ... | ... | ... | 🟢/🟡 | |

## Nice-to-Haves
| Done | Task | Area | Freq | Time | Score | Solved By |
|------|------|------|------|------|-------|-----------|
| [ ] | ... | ... | ... | ... | 🟡 | |

## Backlog
| Done | Task | Area | Freq | Time | Score | Solved By |
|------|------|------|------|------|-------|-----------|
| [ ] | ... | ... | ... | ... | 🔴 | |

## Human-Only (Keep These)
| Task | Area | Freq | Time | Notes |
|------|------|------|------|-------|
| ... | ... | ... | ... | ... |
```

**Phase 5: Celebrate & Point Forward**

Say: "Your Task Audit is done. You've mapped [N] tasks across [N] areas. [X]% are fully automatable and [Y]% are partially automatable — that's [Z] tasks you can start crossing off.

Your starting Task Automation % is [X]%. Every task you automate moves that number up.

**What to do next:**
1. Check the **Module Library** — many of these tasks are already solved by existing modules
2. Run **/brainstorm** — it reads your Task Audit and helps you figure out the best things to automate
3. Run **/explore [idea]** — when you know what you want to build, explore how to build it
4. Come back and tick the checkboxes as you automate each task — watch your % climb"

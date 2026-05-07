# Review

> Guided weekly review using the GTD methodology. Processes inbox, walks through all project/action lists, scans areas and someday-maybe, rebuilds the dashboard. Run weekly (Fridays recommended). Target: 30-60 minutes.

---

## Instructions

You are running a **GTD weekly review**. This is the most important habit in the system — it keeps the GTD files trustworthy and complete. Follow the phases below interactively.

---

## Phase 1: Load Context

Read all GTD files:

1. `gtd/dashboard.md` — Current state overview
2. `gtd/inbox.md` — Items to process
3. `gtd/projects.md` — Master project list
4. `gtd/next-actions.md` — Actions by context
5. `gtd/waiting-for.md` — Delegated items
6. `gtd/someday-maybe.md` — Back-burner ideas
7. `gtd/areas.md` — Areas of responsibility
8. `gtd/review-checklist.md` — Review protocol and trigger lists

---

## Phase 2: GET CLEAR

**Goal:** Empty all inboxes and capture everything floating in your head.

### 2.1 Process Inbox
1. Read `gtd/inbox.md`
2. If items exist, walk through each one using the GTD decision tree
3. Route each item to the correct GTD file
4. Empty inbox to zero

### 2.2 Mind Sweep
1. Present the trigger list categories from `gtd/review-checklist.md`
2. Go through each category — ask "Any open loops here?"
3. Capture everything new to inbox, then process it

**STOP after GET CLEAR and confirm before proceeding.**

---

## Phase 3: GET CURRENT

**Goal:** Ensure all lists reflect reality. Every project has a next action.

### 3.1 Review Calendar
- Ask about the past week: any follow-ups needed?
- Ask about the next 2 weeks: any preparation needed?

### 3.2 Walk Through Next Actions
- Present each context section from `gtd/next-actions.md`
- For each action: "Done? Still relevant? Needs updating?"
- Mark completed, remove stale, add new

### 3.3 Walk Through Waiting For
- Present each item from `gtd/waiting-for.md`
- Flag anything overdue — suggest follow-up
- Move received items to Completed section

### 3.4 Walk Through Projects
- Present each project from `gtd/projects.md`
- For each: "Still active? Any progress? Status change?"
- **Stuck project test:** Does every active project have at least one next action?
- Add new projects, move completed ones, kill dead ones

**STOP after GET CURRENT and confirm before proceeding.**

---

## Phase 4: GET CREATIVE

**Goal:** Look up and out. Spot neglected areas and fresh opportunities.

### 4.1 Scan Someday/Maybe
- Present categories from `gtd/someday-maybe.md`
- "Anything ready to activate? Anything to delete? New ideas?"

### 4.2 Scan Areas
- Present `gtd/areas.md` with current health notes
- "Any area being neglected? Any area missing a project?"

### 4.3 Open Brainstorm
- "Any big-picture ideas or strategic thoughts from this review?"
- Capture to appropriate GTD file

---

## Phase 5: REBUILD

**Goal:** Update the dashboard with fresh data.

1. Run `python3 scripts/refresh_dashboard.py` to recompute counts
2. Update the Flagged/Urgent section if needed
3. Set "Last Review" to today's date
4. Set "Next Review" to one week from today
5. Report summary:
   - Items processed from inbox
   - Projects added / completed / killed
   - Next actions added / completed
   - Waiting-for items flagged or resolved
   - Areas that need attention
   - Next review date

---

## Critical Rules

- **Interactive** — This is a conversation, not a monologue. Present lists, ask questions, wait for responses.
- **Don't skip phases** — Each serves a purpose. GET CLEAR before GET CURRENT before GET CREATIVE.
- **Specific actions** — Next actions must be physical and visible. "Think about pricing" is not an action. "Draft three pricing options in a doc" is.
- **Every project needs a next action** — The #1 failure mode.
- **Update files as you go** — Don't just discuss changes, write them.
- **Time-box** — If a topic goes deep, capture it and move on. The review is about breadth, not depth.

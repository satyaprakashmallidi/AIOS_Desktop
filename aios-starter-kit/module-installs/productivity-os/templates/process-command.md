# Process

> Process the GTD inbox to zero. Walks through each captured item using the GTD decision tree — routes to projects, next-actions, waiting-for, someday-maybe, or trash.

---

## Instructions

You are helping the user **process their GTD inbox to zero**. Every item gets a decision — nothing stays in the inbox.

---

## Step 1: Load Inbox

1. Read `gtd/inbox.md`
2. If inbox is empty, report: "Inbox is at zero — nothing to process." and stop.
3. Count items and report: "You have [N] items in the inbox. Let's process them."

Also read for context (so you can route items to the right places):
- `gtd/projects.md` — existing projects
- `gtd/next-actions.md` — existing actions
- `gtd/waiting-for.md` — existing delegated items
- `gtd/someday-maybe.md` — existing backlog

---

## Step 2: Process Each Item

Present items **one at a time** (or in small batches if clearly related). For each item, walk through the GTD decision tree:

### Decision Tree

```
"Is this actionable?"
  |
  NO --> Ask:
  |   "Trash it?" --> Delete from inbox
  |   "Someday/Maybe?" --> Move to gtd/someday-maybe.md (choose category)
  |   "Reference?" --> Note where to file it
  |
  YES --> Ask:
      "Is this a multi-step outcome?" --> YES: Add to gtd/projects.md
      "What's the very next physical action?"
      |
      Takes <2 minutes? --> "Do it now."
      |
      Someone else should do it?
      |   YES --> Add to gtd/waiting-for.md (who, what, date)
      |
      I should do it, >2 min
          Has a specific date/time? --> Calendar item
          As soon as I can? --> Add to gtd/next-actions.md (choose context)
```

### Context Options for Next Actions
- **@me** — Only you can do this (decisions, approvals, creative work)
- **@claude** — Work to do with Claude Code
- **@calls** — Phone/video calls to make
- **@team** — Items to discuss with team members (specify who)
- **@errands** — Physical, in-person tasks
- **@think** — Creative thinking, brainstorming, reflection
- **@record** — Things to capture, document, write up

---

## Step 3: Route and Clear

As items are processed:
1. Write each item to its destination file immediately
2. Remove the item from `gtd/inbox.md`
3. If a new project was created, ensure it has at least one next action

---

## Step 4: Wrap Up

After all items are processed:
1. Confirm `gtd/inbox.md` is empty (at zero)
2. Run `python3 scripts/refresh_dashboard.py` to update the dashboard
3. Report summary:
   - Items processed: [N]
   - New projects: [list]
   - New next actions: [list]
   - New waiting-for items: [list]
   - Moved to someday-maybe: [list]
   - Trashed: [count]

---

## Critical Rules

- **One item at a time** — Don't batch process without input on each item
- **Top item first** — Process from the top, not cherry-picking
- **Next action must be physical** — "Handle the project" is not a next action. "Email Sarah asking for the report" is.
- **Two-minute rule** — If the action takes <2 minutes, do it right now
- **Don't put it back** — Every item exits the inbox. No "I'll deal with it later."
- **Update files as you go** — Write changes in real time, don't wait until the end

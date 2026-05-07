# ProductivityOS — AIOS Module Installer


<!-- MODULE METADATA
module: productivity-os
version: v1
status: RELEASED
released: 2026-02-26
requires: [context-os]
phase: 3
category: Core OS
complexity: simple
api_keys: 0
setup_time: 10-15 minutes
-->

---

## FOR CLAUDE

You are helping a user install a Getting Things Done (GTD) productivity system in their Claude Code workspace. Follow these rules:

**Behavior:**
- Assume the user is non-technical unless they tell you otherwise
- Explain what you are doing at each step in plain English BEFORE doing it
- Celebrate small wins ("Dashboard is live — nice, your system is already taking shape!")
- If something fails, do not dump error logs — explain the problem simply and suggest the fix
- Never skip verification steps — if a check fails, stop and help the user fix it
- Use encouraging language throughout — they are building something real

**Pacing:**
- Do NOT rush. Pause after major milestones.
- After creating the GTD files: "Your GTD system is set up. Before we go further, let me explain how it works."
- After teaching the methodology: "Now you understand the system. Ready to customize it for your business?"
- After customization: "Your GTD system is personalized. Let's test it."
- After test: "It works! Here's how to use it day-to-day."

**Error handling:**
- If Python version is too old -> provide exact upgrade instructions for their OS
- If any command fails -> explain what went wrong in one sentence, then provide the fix
- Never say "check the logs" — find the problem and explain it

**Important:** This module involves TEACHING the user, not just installing files. The GTD methodology section must be explained clearly before moving to customization. Most users will not have heard of GTD before.

---

## OVERVIEW

Read this to the user before starting:

We're about to set up a **Getting Things Done (GTD) productivity system** in your workspace. This is a complete system for managing every commitment, task, idea, and project across your business and personal life.

Here's what you'll have when we're done:

- **An inbox** where you capture everything — ideas, tasks, follow-ups, anything on your mind
- **A project list** tracking every outcome you're working toward
- **A next actions list** organized by context (at computer, on calls, with team, etc.)
- **A waiting-for list** tracking everything you've delegated or are expecting from others
- **A someday/maybe list** for ideas you might want to act on later
- **A dashboard** that shows your entire operational picture at a glance — auto-refreshed
- **Two commands** — `/process` (empty your inbox using a decision tree) and `/review` (guided weekly review)

**Setup time:** 10-15 minutes
**Cost:** Free — no API keys, no external services
**How it works:** Everything is markdown files that Claude Code reads and updates. No database, no code to run (except a small dashboard refresh script).

---

## SCOPING

Before installation, present the user with a choice:

**RECOMMENDED** (Smart defaults — works for most people)
- 7 context tags: @me, @claude, @calls, @team, @errands, @think, @record
- 3 business areas: Main Business, Side Projects, Personal
- Standard GTD categories for someday/maybe
- Dashboard auto-refresh after every change

Estimated setup time: 10 minutes

**CUSTOM** (Walk through every option together)
- Context tags: Choose which ones make sense for your workflow (default: @me, @claude, @calls, @team, @errands, @think, @record)
- Business areas: Define your own project groupings (departments, business units, clients, etc.)
- Someday/maybe categories: Customize the parking lot categories
- Areas of responsibility: Define your professional and personal areas

Ask: "Want to go with RECOMMENDED, or would you like to walk through the options?"

If RECOMMENDED -> proceed with defaults, briefly note what was chosen.
If CUSTOM -> walk through each option, explain trade-offs, let them choose.

**After scoping, ask one more question:**
"Do you have the **AIOS Telegram Module** installed? If so, I can also set up mobile GTD tools — capture tasks, complete actions, and check your dashboard from your phone."

If YES -> note this for Step 7 (Telegram Integration).
If NO -> skip Step 7.

---

## PREREQUISITES

Check each prerequisite. Verify it works before proceeding.

### Python 3.10+
```bash
python3 --version
```
If not installed or too old:
- macOS: `brew install python@3.12`
- Linux: `sudo apt install python3.12`

### Claude Code
```bash
claude --version
```
If not installed: `npm install -g @anthropic-ai/claude-code`

[VERIFY] Both commands should show version numbers without errors.
Ask: "Everything checks out. Ready to start building?"

---

## INSTALL

### Step 1: Create the GTD folder

"First, I'm going to create a `gtd/` folder in your workspace. This is where all your GTD files will live."

Create the folder:
```bash
mkdir -p gtd
```

Now copy all 8 template files from `templates/` into `gtd/`:
- `dashboard.md` — Your operational hub (loaded every session)
- `inbox.md` — Raw capture bucket
- `projects.md` — Master project list
- `next-actions.md` — Actions organized by context
- `waiting-for.md` — Delegated items
- `someday-maybe.md` — Ideas for later
- `areas.md` — Areas of responsibility
- `review-checklist.md` — Weekly review protocol + decision tree + trigger lists

Copy the template files into the workspace's `gtd/` folder.

[VERIFY] Run `ls gtd/` — should show all 8 files.

---

### Step 2: Install the commands

"Now I'm setting up two commands you'll use regularly — `/process` to empty your inbox, and `/review` for your weekly review."

Create the commands directory if it doesn't exist:
```bash
mkdir -p .claude/commands
```

Copy `templates/process-command.md` to `.claude/commands/process.md`
Copy `templates/review-command.md` to `.claude/commands/review.md`

[VERIFY] Run `ls .claude/commands/` — should show `process.md` and `review.md`.

---

### Step 3: Install the scripts

"These two small scripts keep your dashboard up to date automatically."

Copy `scripts/refresh_dashboard.py` to `scripts/refresh_dashboard.py` (create `scripts/` if needed).
Copy `scripts/inbox_writer.py` to `scripts/inbox_writer.py`.

[VERIFY]
```bash
python3 scripts/refresh_dashboard.py
```
Expected: "Dashboard refreshed: 0 projects, 0 actions, 0 waiting-for"

"Dashboard refresh is working. This runs automatically whenever you make changes through the commands."

---

### Step 4: Install the methodology reference

"This file teaches Claude (and you) how the GTD system works — the decision tree, the weekly review process, the principles. It's your reference manual."

Create the reference directory if it doesn't exist:
```bash
mkdir -p reference
```

Copy `reference/gtd-methodology.md` to `reference/gtd-methodology.md` in the workspace.

---

### Step 5: TEACH — Explain the GTD system

**This is the most important step.** Before customizing, the user needs to understand how GTD works. Read them through these key concepts:

**The Core Idea:**
"Your mind is terrible at remembering things at the right time. It creates anxiety by cycling through unfinished tasks. GTD gives you a trusted external system — if everything is captured and organized, your brain can focus on the work instead of worrying about what you're forgetting."

**The 5 Steps:**
1. **Capture** — Get everything out of your head into the inbox
2. **Clarify** — For each item: "Is this actionable?" If yes, what's the next physical action?
3. **Organize** — Put it in the right bucket (project, action, waiting-for, someday, reference, trash)
4. **Reflect** — Weekly review to keep the system trustworthy
5. **Engage** — Choose what to do based on context, time, energy, and priority

**The Decision Tree (the heart of /process):**
```
Item from inbox
  |
  "Is this actionable?"
  |
  NO --> Trash / Someday-Maybe / Reference
  |
  YES --> "What's the desired outcome?"
    |
    If 2+ steps needed --> Add to Projects list
    |
    "What's the NEXT physical action?"
    |
    Takes <2 min? --> Do it NOW (2-minute rule)
    |
    Someone else should do it? --> Delegate --> Waiting-For list
    |
    I should do it, >2 min --> Add to Next Actions (by context)
```

**Context Tags:**
"Your next actions are organized by what you need to do them. When you're at your computer, you look at @claude. When you need to make calls, you look at @calls. This way you're never scrolling past actions you can't do right now."

**The Weekly Review:**
"Once a week (Friday recommended), run `/review`. Claude walks you through 4 phases: empty your inbox, walk through all your lists, check for stuck projects, and brainstorm new ideas. This is what keeps the system alive. Without it, lists go stale and you stop trusting the system."

**Ask:** "Does this make sense? Any questions before we customize it for your business?"

Pause and answer any questions. Point them to `reference/gtd-methodology.md` for the full deep dive.

---

### Step 6: CUSTOMIZE — Personalize for their business

Now customize the template files based on the scoping decisions from earlier.

**If RECOMMENDED was chosen:**
- Update `gtd/projects.md` area sections to: Main Business, Side Projects, Personal
- Update `gtd/next-actions.md` context sections to: @me, @claude, @calls, @team, @errands, @think, @record
- Update `gtd/areas.md` with generic professional areas (Business Operations, Client/Customer Management, Product/Service Delivery, Marketing & Sales, Finance, Team & People) and personal areas (Health, Finances, Relationships, Personal Development, Living Environment)
- Leave someday-maybe categories as-is (Business Ideas, Content Ideas, Skills, Tools & Systems, Personal Goals)

**If CUSTOM was chosen:**
- Apply the user's chosen business areas to `gtd/projects.md` (replace the ## section headers)
- Apply the user's chosen context tags to `gtd/next-actions.md` (replace the ### sections)
- Apply the user's chosen areas to `gtd/areas.md`
- Apply the user's chosen categories to `gtd/someday-maybe.md`

**For everyone:** Ask the user:
"What's your name? I'll personalize the commands so they address you directly."

Update the /process and /review commands to use their name instead of the generic placeholder.

[VERIFY] Open `gtd/dashboard.md` — it should show their customized areas with zero counts.

"Your GTD system is personalized. Let's do your first brain dump!"

---

### Step 7: Telegram Integration (Optional)

Only if the user confirmed they have the AIOS Telegram Module installed.

"Since you have the Telegram bot set up, I can add GTD tools so you can capture tasks, complete actions, and check your dashboard from your phone."

Explain what the integration adds:
- "Capture [item]" — adds to inbox from Telegram
- "Done: [action]" — marks an action complete
- "What's on my plate?" — quick status from dashboard
- "Brain dump mode" — rapid-fire capture multiple items
- "Add action @calls [text]" — add directly to next actions

**Implementation:** The GTD Telegram tools need to be integrated into the user's existing Telegram bot orchestrator. This depends on their specific bot setup. Provide guidance:

1. The core GTD tool functions are in `scripts/inbox_writer.py` (for capture) and `scripts/refresh_dashboard.py` (for dashboard refresh)
2. For a complete Telegram integration, they should install the AIOS Telegram Module first, then add GTD tools to the orchestrator
3. If their bot supports custom tools/functions, the key operations are:
   - Read any GTD file and return content
   - Append to inbox with timestamp and source tag
   - Find and check off an action in next-actions.md
   - Add a new action under a context section
   - Refresh the dashboard after any write

"For now, the desktop GTD system is fully functional. The Telegram integration is an upgrade you can add later."

---

## TEST

### Brain Dump Test

"Let's test the system with a quick brain dump. Tell me 3-5 things that are on your mind right now — tasks, ideas, follow-ups, anything."

Capture each item to `gtd/inbox.md` with timestamp and source:
```
- [YYYY-MM-DD HH:MM] (source:claude) [Item text]
```

Then run `/process` to walk through the decision tree with the user for each item.

After processing:
- Confirm inbox is empty
- Run `python3 scripts/refresh_dashboard.py` to update counts
- Show them the dashboard: "Look — your dashboard now shows your projects, actions, and delegated items. This updates automatically."

### Weekly Review Test

"Your system is live. The next step is to schedule your first weekly review. When works for you? Friday afternoon is the classic GTD time."

Note the day they choose. Suggest they set a recurring calendar reminder.

"When the time comes, just open Claude Code and type `/review`. I'll walk you through the whole thing."

---

## WHAT'S NEXT

Now that your GTD system is running, here are your options:

1. **Use it daily** — Capture everything to your inbox. Process it regularly. Check your dashboard at the start of every session. Run `/review` weekly.
2. **Add the Data Pipeline module** — Connect your business tools (Stripe, Google Analytics, etc.) so your AI can see your metrics alongside your task management.
3. **Add the Daily Brief module** — Get a morning intelligence report that combines your GTD status with business metrics.
4. **Add the Telegram Command Center module** — Manage your GTD system and entire AIOS from your phone.

**Pro tip:** The system compounds over time. The more you capture and process, the more your AI understands your business. After a few weeks of consistent use, Claude Code will have deep context on every project, every commitment, and every area of your business.

---


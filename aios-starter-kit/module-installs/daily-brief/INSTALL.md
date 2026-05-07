# Daily Brief — AIOS Module Installer

> A plug-and-play module from the AAA Accelerator.
> Grab this and 15+ more at [aaaaccelerator.com](https://aaaaccelerator.com)

<!-- MODULE METADATA
module: daily-brief
version: v1
status: RELEASED
released: 2026-02-27
requires: [Phase 1 + intel-os + command-os]
phase: 2
category: Core OS
complexity: complex
api_keys: 1
setup_time: 20-30 minutes
-->

---

## FOR CLAUDE

You are helping a user install the Daily Brief — their AI-generated morning intelligence report. Follow these rules:

**This is a GUIDED SETUP with an interactive scoping phase.** You're not just copying files — you're learning what data they have, what they care about, and building a brief that's tailored to THEIR business.

**Behavior:**
- Assume the user is non-technical unless they tell you otherwise
- Explain what you are doing at each step in plain English BEFORE doing it
- Celebrate small wins ("First brief generated — let's see how it looks!")
- If something fails, do not dump error logs — explain the problem simply and suggest the fix
- Never skip verification steps — if a check fails, stop and help the user fix it
- Use encouraging language throughout — they are building something real

**Pacing:**
- Do NOT rush. Pause after major milestones.
- After prerequisites: "Everything checks out. Let's figure out what you want in your morning brief."
- After scoping: "Great, we know exactly what to build. Let me set it up."
- After the first test brief: "Here's your first brief! Take a look — we can tweak the format, the dashboard image, or the content."
- After iteration: "Looking good. Let's set it to run automatically every morning."

**Testing is iterative:**
- After generating the first test brief, ALWAYS ask: "What do you think? Anything you'd change?"
- Common feedback areas:
  - Dashboard image layout or colors
  - Which sections feel useful vs filler
  - Telegram message length (too long? too short?)
  - Level of detail in the narrative
  - Sections they want added or removed
- Make changes based on feedback and regenerate. Repeat until they're happy.
- Do NOT rush to automation — get the brief right first.

**Error handling:**
- If Gemini API key is invalid → walk them through getting a new one at aistudio.google.com
- If no funnel.md found → guide them through creating one (reference Phase 4 Step 6 of DataOS)
- If no meetings/Slack data → that's fine, brief works without them. Mention they can add IntelOS later.
- If Telegram delivery fails → check bot token and group ID from CommandOS setup
- If pip install fails → try (1) upgrade pip, (2) install build tools, (3) specific fix

---

## OVERVIEW

You've got data flowing into your database, meetings being recorded, Slack being collected, and a Telegram bot on your phone. But every morning you still open Claude Code and ask "What happened yesterday?" manually.

The Daily Brief fixes that. At 7am every morning, it pulls ALL your data together — funnel metrics, meeting transcripts, Slack conversations — and sends a single Gemini call that synthesizes everything into an intelligent morning report. A dashboard image shows your metrics at a glance. A narrative tells the story of your day. Key signals flag what needs your attention. Strategic recommendations tell you what to do about it.

It's delivered to a dedicated topic in your Telegram group. Reply to drill into anything — a full Claude agent spins up with the brief as context.

**What you'll have when this is done:**
- A morning brief delivered to Telegram every day at 7am (or your preferred time)
- A funnel dashboard image showing your metrics vs 7-day averages
- An adaptive AI report that covers whatever data you have — metrics, meetings, Slack, or all three
- An interactive Telegram topic where you can reply to ask follow-up questions
- All briefs saved as markdown files in `outputs/daily-brief/`

**Setup time:** 20-30 minutes
**Running cost:** ~$1-3/month (Gemini API — one call per day)

---

## PREREQUISITES

Before starting, verify these modules are installed and working:

### 1. ContextOS + DataOS (Phase 1)

```bash
# Check context files exist
ls context/overview.md context/strategy.md 2>/dev/null || ls context/group/overview.md context/group/strategy.md 2>/dev/null
```
Expected: At least overview.md and strategy.md should exist.

```bash
# Check database exists with data
cd /path/to/workspace && .venv/bin/python -c "
from scripts.db import get_connection, get_table_list
conn = get_connection()
tables = get_table_list(conn)
print(f'Database tables: {tables}')
conn.close()
"
```
Expected: Should list at least a few tables (fx_rates, youtube_daily, stripe_daily, etc.)

```bash
# Check funnel.md exists
cat context/funnel.md 2>/dev/null || cat context/group/funnel.md 2>/dev/null
```
Expected: Should show funnel stages. If this file doesn't exist, we'll create it during setup (see Phase 1 Step 2 below).

### 2. IntelOS (Phase 2)

```bash
cd /path/to/workspace && .venv/bin/python -c "
from scripts.db import get_connection
conn = get_connection()
# Check meetings table
row = conn.execute(\"SELECT COUNT(*) as c FROM meetings\").fetchone()
print(f'Meetings in DB: {dict(row)[\"c\"]}')
conn.close()
"
```
Expected: Should show a count (even 0 is OK — meetings will flow in over time).

If the meetings table doesn't exist, IntelOS may not be installed. The Daily Brief still works without meetings — it just won't have meeting analysis sections. Suggest installing IntelOS to get the full experience.

### 3. CommandOS (Phase 2)

```bash
# Check Telegram bot is configured
echo $TELEGRAM_BOT_TOKEN | head -c 10
echo $TELEGRAM_GROUP_ID
```
Expected: Should show the start of a bot token and a group ID. If not set, CommandOS needs to be installed first.

[VERIFY] All three prerequisites should pass. If any are missing, explain which module to install first and stop.

Ask: "Prerequisites look good. Let me take a look at your data to figure out the best brief for you."

---

## PHASE 1: SCOPING — Figure Out What Goes in the Brief

### Step 1: Inventory Their Data

Read the user's workspace to understand what data they have:

1. Read their funnel.md (context/funnel.md or context/group/funnel.md) to understand their business funnel
2. Read their key-metrics.md to see what metrics are flowing
3. Check what tables exist in the database
4. Check if meetings table has recent data
5. Check if slack_messages table has recent data

Present a summary:

```
Here's what I found in your workspace:

DATA SOURCES
✅ Funnel metrics: {N} stages ({stage names})
✅ Database: {N} tables with data through {latest_date}
{✅ or ❌} Meetings: {N} meetings in the last 7 days
{✅ or ❌} Slack: {N} messages in the last 24 hours
{✅ or ❌} Funnel map: {exists or needs creation}

This means your brief can include:
- Funnel dashboard + metrics analysis (from DataOS)
{- Meeting highlights + action items (from IntelOS) — if meetings exist}
{- Slack digest (from IntelOS) — if Slack exists}
- Strategic recommendations + key signals (always)
```

### Step 2: Create Funnel Map (if missing)

If `context/funnel.md` (or `context/group/funnel.md`) doesn't exist, create it now.

Read the user's context files and database tables. Walk them through:
1. What are your funnel stages? (how do people go from discovering you to paying?)
2. Which database tables map to each stage?
3. What's your currency?
4. Any monthly targets?

Create the funnel file using this format:

```markdown
# Business Funnel

> How your business converts attention into revenue.
> Created during Daily Brief setup. Read by /prime and Daily Brief.

## Currency
{USD or local currency}

## Stages

### 1. {Stage Name}
{One sentence description}
- {Metric label} → {table_name.column_name}

### 2. {Stage Name}
{One sentence description}
- {Metric label} → {table_name.column_name}

{...more stages...}

## Monthly Targets
- {Target}: {Value}
```

Only include metrics that map to tables that actually exist in the database.

### Step 3: Choose a Preset

Present the three presets:

```
Which style of brief fits your setup?

1. SOLO OPERATOR (Recommended if you're a solo founder or small team without many meetings)
   → Metrics dashboard, narrative, key signals, action items
   → Short and punchy — 1-2 page PDF
   → Perfect for: "Give me the numbers and tell me what to focus on"

2. SMALL TEAM (Recommended if you have a team and regular meetings)
   → Everything above + meeting highlights, Slack digest, strategic recommendations
   → Balanced depth — 3-5 page PDF
   → Perfect for: "What happened across the team and what should I know?"

3. AGENCY (Recommended if you run an agency with multiple departments)
   → Full analysis — per-department call analysis, cross-stream patterns, deep strategic recs
   → Comprehensive — 8-15 page PDF
   → Perfect for: "I want to see everything across all teams and departments"
```

After they pick a preset, ask: **"Want to customize further? I can toggle specific sections on or off, or adjust the level of detail."**

If they want to customize:
- Show the full section list for their preset with [x] marks
- Let them toggle sections on/off
- Let them adjust word budget (shorter = faster + cheaper, longer = more detail)

Record their choice. This will be saved as `BRIEF_PRESET` in .env.

[VERIFY] User has confirmed their preset and any customizations.

Ask: "Perfect. Let me build your brief pipeline now."

---

## PHASE 2: INSTALL

### Step 1: Install Dependencies

Add daily brief requirements to the existing venv:

```bash
cd /path/to/workspace && .venv/bin/pip install google-genai matplotlib aiogram
```

[VERIFY]
```bash
.venv/bin/python -c "from google import genai; import matplotlib; import aiogram; print('Dependencies OK')"
```
Expected: `Dependencies OK`

### Step 2: Get Gemini API Key

If the user already has `GEMINI_API_KEY` in their .env (some DataOS collectors use it), skip this step.

Otherwise:

1. Go to https://aistudio.google.com/apikey
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Select any project (or create one — the name doesn't matter)
5. Copy the key — it starts with `AIza...`

Add to `.env`:
```
GEMINI_API_KEY=AIza...your-key-here
```

[VERIFY]
```bash
cd /path/to/workspace && .venv/bin/python -c "
import os
from dotenv import load_dotenv
load_dotenv()
from google import genai
client = genai.Client(api_key=os.environ['GEMINI_API_KEY'])
r = client.models.generate_content(model='gemini-2.5-flash', contents='Say hello in exactly 3 words.')
print(f'Gemini OK: {r.text.strip()}')
"
```
Expected: A 3-word greeting from Gemini.

### Step 3: Install the Scripts

Create the following files from the module's `scripts/` directory. Read each file and write it to the user's workspace at the corresponding path:

1. `scripts/daily_brief.py` — Main orchestrator
2. `scripts/metrics.py` — Funnel metrics builder
3. `scripts/prompt.py` — Mega-prompt assembler
4. `scripts/dashboard.py` — Dashboard image generator
5. `scripts/deliver.py` — Telegram delivery

**IMPORTANT:** After writing the files, customize `scripts/prompt.py` based on the user's scoping choices:
- If they chose a preset, set the default preset in the `PRESETS` dict
- If they customized sections, update the preset's `sections` list
- If they adjusted word budget, update the `word_budget` value

Also update `scripts/metrics.py`:
- Set `WORKSPACE_ROOT` correctly if their workspace structure differs
- Verify the funnel.md location matches their actual file path

### Step 4: Configure Environment

Add brief settings to `.env`:
```
# Daily Brief settings
BRIEF_PRESET={their chosen preset: solo, small_team, or agency}
BRIEF_MODEL=gemini-2.5-flash
# BRIEF_PDF_LENGTH=medium  # short, medium, or comprehensive
```

[VERIFY] Read back the .env to confirm all required keys are set:
- `GEMINI_API_KEY` — for Gemini synthesis
- `TELEGRAM_BOT_TOKEN` — from CommandOS
- `TELEGRAM_GROUP_ID` — from CommandOS
- `BRIEF_PRESET` — their chosen preset

---

## PHASE 3: TEST — Generate and Iterate

### Step 1: Generate First Brief

Run a test brief for yesterday:

```bash
cd /path/to/workspace && .venv/bin/python scripts/daily_brief.py --test
```

This runs in dry-run mode (prints to stdout, doesn't save or deliver).

Show the user the full brief output. Point out:
- The narrative section ("This is the story of your day")
- The key signals ("These are the things that need your attention")
- The metrics analysis ("This breaks down your funnel by stage")
- Meeting highlights (if they have meetings)
- Strategic recommendations ("This is what the AI thinks you should do")

**Ask: "Here's your first brief! Take a look. What do you think?"**

### Step 2: Test the Dashboard Image

```bash
cd /path/to/workspace && .venv/bin/python -c "
from scripts.metrics import build_funnel_metrics
from scripts.dashboard import generate_dashboard_image
from scripts.db import get_connection
conn = get_connection()
metrics = build_funnel_metrics(conn)
img = generate_dashboard_image(metrics, save_path='test_dashboard.png')
print(f'Dashboard saved to test_dashboard.png ({len(img):,} bytes)')
conn.close()
"
```

Show them the image file. Ask: "Here's the dashboard image that'll be sent with each brief. Does the layout work for you?"

### Step 3: Iterate

Based on their feedback, make adjustments:

**Common tweaks:**
- **"Too long"** → Reduce word budget in the preset, remove sections
- **"Too short"** → Increase word budget, add sections
- **"I don't need meeting analysis"** → Remove `meeting_highlights` from sections
- **"Dashboard looks weird"** → Adjust colors, layout, or metrics in dashboard.py
- **"Wrong metrics showing"** → Update funnel.md to add/remove metric mappings
- **"Narrative is too generic"** → Add more specific context to the system instruction in prompt.py
- **"Want different sections"** → Modify the sections list and add custom section definitions

After each change, regenerate:
```bash
.venv/bin/python scripts/daily_brief.py --test
```

**Repeat until they say they're happy with the brief.** Do NOT move to automation until the brief format is settled.

### Step 4: Test Telegram Delivery

Once the brief content is right, test the full delivery:

```bash
cd /path/to/workspace && .venv/bin/python scripts/daily_brief.py --date $(date -v-1d +%Y-%m-%d)
```

This will:
1. Generate the brief
2. Create the dashboard image
3. Send both to a "Daily Brief" topic in their Telegram group
4. Save the full brief to `outputs/daily-brief/{date}.md`

[VERIFY] Check Telegram — they should see:
1. A dashboard image in the Daily Brief topic
2. A narrative + key signals message
3. A strategic recommendations + action items message (if their preset includes them)

Also verify the saved file:
```bash
ls -la outputs/daily-brief/
```

If Telegram delivery fails:
- Check TELEGRAM_BOT_TOKEN is correct
- Check TELEGRAM_GROUP_ID is correct
- Check the bot is added to the group as an admin
- If topics aren't enabled on the group, the bot will send to the general chat instead

Ask: "Brief delivered! Check your Telegram. Does everything look right on your phone?"

### Step 5: Register as Interactive Topic

For the Daily Brief topic to be interactive (so they can reply and get an agent), the CommandOS bot needs to know about it.

Check if the topic ID was cached:
```bash
cat data/daily-brief-topic.json 2>/dev/null
```

If the topic was created, add the topic ID to .env:
```
TELEGRAM_DAILY_BRIEF_TOPIC_ID={topic_id from the JSON file}
```

Then update the CommandOS bot configuration to register this topic as interactive. The exact method depends on how their CommandOS is set up:
- If they have `apps/command/main.py` → add the interactive topic registration
- If they have a simpler bot setup → add the topic ID to the config

**Note:** If CommandOS doesn't support interactive topics yet, that's OK. The brief will still be delivered — they just won't be able to reply to it for follow-up questions. This can be added later.

---

## PHASE 4: AUTOMATE

### Option A: macOS (launchd)

Create the scheduling plist from the module's `config/com.aios.daily-brief.plist`:

Replace `WORKSPACE_PATH` with the actual absolute path to the user's workspace.

Adjust the time if they want something other than 7:00 AM:
```xml
<key>Hour</key>
<integer>7</integer>
<key>Minute</key>
<integer>0</integer>
```

**Important timing:** The Daily Brief should run AFTER the DataOS collection cron. If DataOS runs at 6:00 AM, schedule the brief for 7:00 AM (default). This ensures fresh data is in the database when the brief generates.

Install and activate:
```bash
cp config/com.aios.daily-brief.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.aios.daily-brief.plist
```

### Option B: Linux (cron)

```bash
crontab -e
```

Add (adjust the time and path):
```
0 7 * * * cd /path/to/workspace && .venv/bin/python scripts/daily_brief.py --deliver >> data/daily-brief.log 2>&1
```

### Important Notes

- **Run AFTER data collection.** If DataOS collects at 6 AM, schedule the brief for 7 AM.
- **Your machine needs to be awake.** Same rule as DataOS — if it's a laptop, plug it in overnight.
- **Logs live at** `data/daily-brief.log` — check here if briefs stop appearing.
- **Cost:** Each brief costs approximately $0.03-0.10 depending on data volume and model. At ~$0.05/day, that's about $1.50/month.
- **To change the time:** Edit the plist (Hour/Minute) or cron expression.

[VERIFY] Check the cron is loaded:
```bash
launchctl list | grep daily-brief  # macOS
# or
crontab -l | grep daily-brief  # Linux
```

---

## PHASE 5: WIRE INTO WORKSPACE

### Step 1: Update /prime

Add the Daily Brief output to /prime so every session knows about recent briefs:

Update `.claude/commands/prime.md` to include:
- `outputs/daily-brief/` as an on-demand reference — "Read the latest daily brief for context on yesterday's business state"
- Mention in the summary section: "The Daily Brief runs at 7am — check the Daily Brief topic in Telegram for today's brief, or read `outputs/daily-brief/` for recent briefs"

### Step 2: Update CLAUDE.md

Add to the workspace structure:
```
├── outputs/
│   └── daily-brief/           # Auto: 7am daily — morning intelligence briefs
```

Add to commands section:
```
### Daily Brief (automated)
Morning intelligence report synthesizing funnel metrics, meeting transcripts,
and Slack messages. Delivered to Telegram at 7am. Reply in the Daily Brief
topic for interactive follow-up. Manual run: `python scripts/daily_brief.py`
```

### Step 3: Clean Up Test Files

```bash
rm -f test_dashboard.png
```

---

## WHAT'S NEXT

**Milestone:** "Your Daily Brief is live. Every morning at {time}, you'll get a synthesized intelligence report on your phone covering your metrics, meetings, and team activity. Reply to drill into anything. Here's what you just built:

- An adaptive AI brief that reads your funnel, meetings, and Slack
- A dashboard image showing your metrics vs 7-day trends
- Telegram delivery with an interactive reply feature
- All briefs archived in `outputs/daily-brief/` for future reference

**Cost:** ~$1-3/month (one Gemini call per day)."

1. **Let it run for a week.** The brief gets more useful as patterns emerge. After a few days of briefs, you'll start to see the AI connect dots across time — "revenue is trending up over the last 3 days" or "this is the third time in a week that churn has spiked."

2. **Reply to drill in.** When something in the brief catches your eye, just reply in the Telegram topic. A full Claude agent spins up with your brief as context and can query the database, read files, and give you deeper analysis.

3. **Adjust over time.** As your business changes — new data sources, new team members, new priorities — update your funnel.md and the brief adapts automatically. To change sections or depth, update the preset in .env and the prompt in `scripts/prompt.py`.

4. **Explore related modules:**
   - **ProductivityOS** — Add a GTD system. Future Brief versions will include a task/project snapshot.
   - **Content Pipeline** — Add content intelligence. Future Brief versions will include content ideas.
   - **AI Landscape Monitor** — Track AI model rankings automatically.

---

> Built by Liam Ottley for the AAA Accelerator — [aaaaccelerator.com](https://aaaaccelerator.com)

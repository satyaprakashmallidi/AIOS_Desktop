# IntelOS — AIOS Module Installer

> A plug-and-play module from the AAA Accelerator.
> Grab this and 15+ more at [aaaaccelerator.com](https://aaaaccelerator.com)

<!-- MODULE METADATA
module: intel-os
version: v1
status: RELEASED
released: 2026-02-26
requires: [context-os, data-os]
phase: 2
category: Core OS
complexity: medium
api_keys: 1-3
setup_time: 20-30 minutes
-->

---

## FOR CLAUDE

You are helping a user install IntelOS — the intelligence collection layer for their AIOS. This module collects meeting recordings and Slack messages into a searchable database. Follow these rules:

**Behavior:**
- Assume the user is non-technical unless they tell you otherwise
- Explain what you are doing at each step in plain English BEFORE doing it
- Celebrate small wins ("First meeting pulled in — your AI can now remember your calls!")
- If something fails, do not dump error logs — explain the problem simply and suggest the fix
- Never skip verification steps — if a check fails, stop and help the user fix it
- Use encouraging language throughout — they are building something real

**Pacing:**
- Do NOT rush. Pause after major milestones.
- After prerequisites: "We've got everything we need. Ready to start building?"
- After API keys: "All keys verified. The boring part is done — now the fun stuff."
- After installation: "It's installed. Let's test it."
- After test: "It works! Here's what you just built and what you can do with it."

**Error handling:**
- If Python version is too old → provide exact upgrade instructions for their OS
- If an API key is invalid → walk them through getting a new one step by step
- If pip install fails → try: (1) upgrade pip, (2) install build tools, (3) specific fix
- If any command fails → explain what went wrong in one sentence, then provide the fix
- Never say "check the logs" — find the problem and explain it

**Important — Custom meeting recorder path:**
If the user doesn't use Fireflies or Fathom, you need to help them build a custom collector. Here's how:
1. Ask what meeting recorder they use
2. Search the web for that platform's API documentation
3. Assess feasibility honestly: "Yes, they have a good API — I can build a collector" or "Their API is limited/enterprise-only — I'd recommend signing up for Fireflies (free tier available) or Fathom (generous free tier)"
4. If feasible, write a custom `collect_custom.py` that outputs the same format as the Fireflies/Fathom collectors (list of meeting dicts with: meeting_id, source, title, date, start_time, duration_minutes, participants, transcript_text, summary, action_items_raw, external_url)
5. The custom collector just needs to be importable with a `collect(days=7)` function that returns a list of meeting dicts

---

## OVERVIEW

Read this to the user before starting:

We're about to set up **IntelOS** — the intelligence collection layer for your AI Operating System. This gives your AI a perfect memory of every meeting and team conversation.

Here's what you'll have when we're done:

- **Every meeting recording** automatically pulled into a searchable database (supports Fireflies, Fathom, or custom)
- **Every Slack message** collected daily — searchable by channel, person, keyword, date
- **A daily Slack transcript** you can pull up for any date ("what happened on Slack last Tuesday?")
- **Meeting classification** by department/team — if you have different teams, meetings get tagged automatically
- **Instant search** — ask your AI "find that meeting with Jimmy last week" or "has anyone mentioned the rebrand in Slack?"
- **Automatic collection** running on a schedule — set it and forget it

**Setup time:** 20-30 minutes
**Running cost:** Free if using Fireflies/Fathom free tiers. Slack API is free. No AI costs — this is pure collection and storage.
**Prerequisites:** ContextOS and DataOS should be installed first (we need your team registry for classification).

---

## SCOPING

Before installation, we need to figure out your setup. Ask the user these questions:

### Question 1: Meeting Recorder

"What do you use to record your meetings? This is the tool that joins your Zoom/Meet/Teams calls and creates transcripts."

**Options:**
- **A) Fireflies.ai** — We have a ready-made collector for this. Easiest path.
- **B) Fathom** — We have a ready-made collector for this too. Equally easy.
- **C) Something else** — I'll research your platform and either build a custom collector or recommend the best path forward.
- **D) I don't record meetings yet** — No problem! I'd recommend signing up for [Fireflies](https://fireflies.ai) (free tier records unlimited meetings) or [Fathom](https://fathom.ai) (generous free plan, great for Zoom). Set it up, let it record a few meetings, then come back here.

Record their choice: `MEETING_PLATFORM = fireflies | fathom | custom | none`

If they chose C (something else):
1. Ask what platform they use
2. Search the web for "{platform name} API documentation"
3. Assess whether they have a usable API for pulling transcripts
4. If yes → tell them you'll build a custom collector during installation
5. If no → be honest: "Unfortunately {platform} doesn't have a public API for pulling transcripts. I'd recommend signing up for Fireflies or Fathom — both have free tiers and work with Zoom, Google Meet, and Teams."

If they chose D → note that meetings will be skipped for now and move on to Slack.

### Question 2: Slack

"Do you use Slack for team communication?"

- **A) Yes** — Great, we'll set up the Slack collector. You'll need to create a Slack app (I'll walk you through it — takes 5 minutes).
- **B) No** — No worries, we'll skip Slack. You can always add it later.

Record their choice: `SLACK_ENABLED = true | false`

If yes: "How many Slack workspaces do you want to collect from? Most people have one, but some have a separate one for clients."

Record: `SLACK_WORKSPACE_COUNT = 1 | 2 | ...`

### Question 3: Team Classification

"Do you have different departments or teams in your business? For example: sales, engineering, operations, support?"

- **A) Yes, I have departments** — "Great, what are they? List them out and I'll set up classification so your meetings get auto-tagged by department."
- **B) No, it's just me / small team** — "Perfect, we'll keep it simple — all meetings go into one bucket. You can always add departments later."

Record: `DEPARTMENTS = [list] | none`

### Question 4: Collection Frequency

"How often should we collect new meetings and messages?"

- **A) Daily** (recommended — simple, reliable, low API usage)
- **B) Every 4 hours** (closer to real-time — good if you need meetings available faster)
- **C) Every hour** (most responsive but uses more API calls)

Record: `COLLECTION_INTERVAL = daily | 4h | 1h`

**Before proceeding, check for existing crons:**

```bash
# macOS
launchctl list | grep -i "aios\|collect\|cron"
# Linux
crontab -l
```

If they already have a data collection cron running (e.g., from DataOS), note it: "You already have a collection job running. We can add IntelOS to that same schedule instead of creating a new one."

After scoping, summarize: "Here's what we're setting up: {meeting platform} for meetings, {Slack status}, {department status}, collecting {frequency}. Sound good?"

---

## PREREQUISITES

Check each prerequisite. Verify it works before proceeding.

### Python 3.10+
```bash
python3 --version
```
If not installed or too old: provide OS-specific install instructions.

### pip
```bash
python3 -m pip --version
```
If not installed:
```bash
python3 -m ensurepip --upgrade
```

### Existing workspace
Check that the user has a workspace set up (from ContextOS):
```bash
ls CLAUDE.md
```
If CLAUDE.md doesn't exist: "It looks like ContextOS hasn't been set up yet. That needs to come first — it creates the workspace foundation that IntelOS plugs into."

### Staff registry (from DataOS)
Check if the staff_registry table exists:
```bash
python3 -c "
import sqlite3, glob, os
# Look for any existing database in data/
dbs = glob.glob('data/*.db')
if dbs:
    for db in dbs:
        conn = sqlite3.connect(db)
        tables = [r[0] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()]
        print(f'{db}: {tables}')
        conn.close()
else:
    print('No database found — IntelOS will create data/intel.db')
"
```

**If a DataOS database exists** (any `.db` file in `data/` with a `staff_registry` table): IntelOS will use that existing database. Note the DB path.

**If no database exists:** IntelOS will create its own standalone database at `data/intel.db`. The staff registry will be empty — classification will put all meetings in "general" until they add team members.

Record: `DB_PATH = {path to existing DB} | data/intel.db`

[VERIFY] All prerequisites should show version numbers without errors.
Ask: "Everything checks out. Ready to move on?"

---

## API KEYS

Collect API keys based on the scoping decisions. Only ask for keys they need.

### Fireflies API Key [if MEETING_PLATFORM = fireflies]

1. Go to [app.fireflies.ai/integrations](https://app.fireflies.ai/integrations)
2. Scroll down to "Fireflies API" section (or search for "API")
3. Click "API & Webhooks" or similar
4. Copy your API Key (it's a long string of letters and numbers)
5. Paste it here — I'll save it securely in your .env file

[VERIFY]
```bash
python3 -c "
import requests, os
from dotenv import load_dotenv
load_dotenv()
key = os.getenv('FIREFLIES_API_KEY')
if not key: print('ERROR: Key not found in .env'); exit(1)
r = requests.post('https://api.fireflies.ai/graphql',
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
    json={'query': '{ transcripts(limit: 1) { id title } }'},
    timeout=15)
data = r.json()
if 'errors' in data: print(f'ERROR: {data[\"errors\"][0][\"message\"]}')
else: print(f'Fireflies connected — found {len(data.get(\"data\",{}).get(\"transcripts\",[]))} recent transcript(s)')
"
```
Expected: "Fireflies connected — found X recent transcript(s)"
If it shows an error about invalid token: "Your API key doesn't seem to be working. Go back to app.fireflies.ai/integrations and make sure you're copying the full key. Sometimes there's a 'Regenerate' button if the old one expired."

### Fathom API Key [if MEETING_PLATFORM = fathom]

1. Go to [app.fathom.ai](https://app.fathom.ai) and log in
2. Click your profile icon → **Settings**
3. Click **Integrations** in the sidebar
4. Find the **API** section
5. Click **Generate API Key** (or copy your existing one)
6. Paste it here

[VERIFY]
```bash
python3 -c "
import requests, os
from dotenv import load_dotenv
load_dotenv()
key = os.getenv('FATHOM_API_KEY')
if not key: print('ERROR: Key not found in .env'); exit(1)
r = requests.get('https://api.fathom.ai/external/v1/meetings',
    headers={'X-Api-Key': key},
    params={'include_summary': 'true'},
    timeout=15)
if r.status_code == 401: print('ERROR: Invalid API key — check Settings → Integrations → API in Fathom')
elif r.status_code == 200: print(f'Fathom connected — API key verified')
else: print(f'Unexpected response: HTTP {r.status_code}')
"
```
Expected: "Fathom connected — API key verified"

### Slack Bot Token [if SLACK_ENABLED = true]

This takes about 5 minutes. We need to create a Slack app that can read messages.

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Name it something like "AIOS IntelOS" (or whatever you want)
5. Select your workspace from the dropdown
6. Click **Create App**

Now add the permissions it needs:

7. In the left sidebar, click **OAuth & Permissions**
8. Scroll down to **Scopes** → **Bot Token Scopes**
9. Add these scopes (click "Add an OAuth Scope" for each):
   - `channels:history` — Read messages from public channels
   - `channels:read` — See the list of channels
   - `channels:join` — Join public channels to read them
   - `users:read` — Resolve user IDs to names
10. Scroll back up and click **Install to Workspace**
11. Click **Allow** on the permission screen
12. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
13. Paste it here

[VERIFY]
```bash
python3 -c "
import requests, os
from dotenv import load_dotenv
load_dotenv()
token = os.getenv('SLACK_TOKEN_MAIN')
if not token: print('ERROR: Token not found in .env'); exit(1)
r = requests.get('https://slack.com/api/auth.test',
    headers={'Authorization': f'Bearer {token}'}, timeout=15)
data = r.json()
if data.get('ok'): print(f'Slack connected — workspace: {data.get(\"team\", \"unknown\")}')
else: print(f'ERROR: {data.get(\"error\", \"unknown\")} — make sure you copied the Bot User OAuth Token (starts with xoxb-)')
"
```
Expected: "Slack connected — workspace: YourWorkspaceName"

**Important note about Slack channels:** "Your bot can only read channels it's been added to. After we finish setup, go into each Slack channel you want collected and type `/invite @AIOS IntelOS` (or whatever you named your app). Start with your most important channels — you can always add more later."

If they have multiple workspaces, repeat the Slack app creation for each workspace, storing tokens as `SLACK_TOKEN_MAIN`, `SLACK_TOKEN_CLIENTS`, etc.

After all keys are collected: "All keys verified. The setup part is done — now we build."

---

## INSTALL

Follow each step in order. Verify before moving to the next.

### Step 1: Install dependencies

```bash
pip install requests python-dotenv
```

[VERIFY]
```bash
python3 -c "import requests; from dotenv import load_dotenv; print('Dependencies OK')"
```

### Step 2: Create the .env file

Write the .env file with the API keys collected above. Place it in the workspace root (same folder as CLAUDE.md).

Use only the keys that were collected:
```
# IntelOS API Keys
FIREFLIES_API_KEY=...    (only if using Fireflies)
FATHOM_API_KEY=...       (only if using Fathom)
SLACK_TOKEN_MAIN=...     (only if using Slack)
SLACK_TOKEN_CLIENTS=...  (only if multiple workspaces)
```

**If a .env file already exists:** Append these keys to it. Don't overwrite existing keys.

[VERIFY]
```bash
python3 -c "from dotenv import load_dotenv; import os; load_dotenv(); keys = [k for k in os.environ if k.startswith(('FIREFLIES_', 'FATHOM_', 'SLACK_TOKEN_'))]; print(f'Config OK: {len(keys)} IntelOS keys loaded')"
```

### Step 3: Create the scripts folder

Create a `scripts/intel/` folder (or wherever makes sense in their workspace). Copy all the IntelOS scripts there:

**Files to create:**
- `scripts/intel/db.py` — Database setup and query helpers
- `scripts/intel/collect_fireflies.py` — Fireflies collector (if using)
- `scripts/intel/collect_fathom.py` — Fathom collector (if using)
- `scripts/intel/collect_slack.py` — Slack collector (if using)
- `scripts/intel/classify.py` — Meeting classifier
- `scripts/intel/collect_all.py` — Master collection script

Write each file from the contents provided in this module's `scripts/` folder. **Adjust the import paths** if the user's workspace structure is different — the scripts import from each other using relative imports within the same folder.

**Important path adjustment:** The `db.py` file has `WORKSPACE_ROOT = Path(__file__).resolve().parent.parent` — this assumes scripts are two levels deep (e.g., `scripts/intel/db.py` → workspace root). If the user has a different structure, adjust this path so `DB_PATH` points to `{workspace_root}/data/intel.db`.

**If they already have a database** (from DataOS): Modify `db.py` to point `DB_PATH` to their existing database. Add the IntelOS tables (meetings, slack_messages, staff_registry, collection_log) to their existing schema if they don't already exist.

[VERIFY] After creating all files:
```bash
python3 scripts/intel/db.py
```
Expected: "Database initialized at: data/intel.db" (or their existing DB path) with a list of tables.

### Step 4: Populate staff registry (if departments configured)

If the user said they have departments in the SCOPING step, help them populate the staff registry now.

Ask: "Let's add your team. For each person, I need: name, email, role, and department. You can type them out or paste a list."

Then write them to the database:
```python
import sys; sys.path.insert(0, 'scripts/intel')
from db import get_connection, write_staff

conn = get_connection()
staff = [
    {"email": "person@company.com", "name": "Person Name", "role": "Role", "team": "company", "department": "sales"},
    # ... more team members
]
count = write_staff(conn, staff)
print(f"Added {count} team members")
conn.close()
```

If they said "no departments" — skip this step entirely. Meetings will all go to the "general" stream.

### Step 5: Custom meeting collector (if MEETING_PLATFORM = custom)

If the user chose a custom meeting platform:

1. Search the web for their platform's API documentation
2. Assess whether it has endpoints for:
   - Listing/searching recordings (required)
   - Getting transcript text (required)
   - Getting participant info (nice to have)
3. If the API looks good, build `scripts/intel/collect_custom.py` following this pattern:

```python
"""Custom collector for {Platform Name}."""
import os
import json
import requests
from dotenv import load_dotenv
load_dotenv()

def collect(days: int = 7) -> list[dict]:
    """Collect meetings from the last N days.
    Returns list of meeting dicts with these keys:
    - meeting_id (str, unique)
    - source (str, e.g. "otter")
    - title (str)
    - date (str, YYYY-MM-DD)
    - start_time (str, HH:MM:SS, optional)
    - duration_minutes (int, optional)
    - participants (str, JSON array of {name, email})
    - transcript_text (str, the full transcript)
    - summary (str, optional)
    - action_items_raw (str, JSON, optional)
    - external_url (str, optional)
    """
    # YOUR IMPLEMENTATION HERE
    pass
```

4. Update `collect_all.py` to import from `collect_custom` instead of `collect_fireflies`/`collect_fathom`.

If the API is not feasible, be honest and recommend Fireflies or Fathom.

---

## TEST

### Quick test — Database

```bash
python3 scripts/intel/db.py
```
Expected: Shows database path and table list.

### Test meeting collection

```bash
python3 scripts/intel/collect_all.py --meetings-only
```
Expected: "Fireflies: collected X meetings" (or Fathom equivalent) and "X records written to database"

If no meetings are found: "That's normal if you just set up your recorder! It means the connection works but there are no recordings in the last 7 days. Try `--days 30` to look further back, or wait for your next meeting to be recorded."

### Test Slack collection (if enabled)

```bash
python3 scripts/intel/collect_all.py --slack-only
```
Expected: "Collecting Slack workspace: main..." and "X messages written to database"

If zero messages: "Your Slack bot might not be in any channels yet. Go to your most active Slack channel and type `/invite @YourBotName`. Then run this again."

### Full test — Query the data

After collection works, show them what they can do:

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts/intel')
from db import get_connection, get_meeting_stats, search_meetings, search_slack

conn = get_connection()
stats = get_meeting_stats(conn)
print('=== Your IntelOS Database ===')
print(f'  Meetings: {stats[\"total_meetings\"]}')
print(f'  Slack messages: {stats[\"total_slack_messages\"]}')
print(f'  Team members: {stats[\"team_members\"]}')
if stats['latest_meeting_date']:
    print(f'  Latest meeting: {stats[\"latest_meeting_date\"]}')
conn.close()
"
```

Then show a sample search:
```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts/intel')
from db import get_connection, search_meetings

conn = get_connection()
# Search for any meeting — just to demonstrate
results = conn.execute('SELECT title, date, duration_minutes FROM meetings ORDER BY date DESC LIMIT 5').fetchall()
if results:
    print('Recent meetings:')
    for r in results:
        print(f'  {r[1]} — {r[0]} ({r[2] or \"?\"} min)')
else:
    print('No meetings in database yet — they will appear after your next recorded call.')
conn.close()
"
```

If everything works: "It's live! Your AI now has a searchable database of your meetings and Slack messages. Every time the collection runs, new data flows in automatically. Here's what you can ask me now: 'Find that meeting with [name] last week' or 'Search Slack for [topic]'."

---

## SCHEDULING

Set up automatic collection so new meetings and messages flow in without you thinking about it.

### Check for existing crons first

```bash
# macOS
ls ~/Library/LaunchAgents/ | grep -i "aios\|collect"
# Linux
crontab -l 2>/dev/null
```

**If they already have a DataOS collection cron:** Add IntelOS to the existing orchestrator script instead of creating a separate schedule. Add these lines to their existing `collect_all.py` or equivalent:
```python
# IntelOS collection
from scripts.intel.collect_all import run as intel_run
intel_run()
```

**If no existing cron — create one:**

### macOS (launchd)

The plist template is in `config/com.aios.intel-collect.plist`. We need to fill in the paths:

1. Copy the template:
```bash
cp config/com.aios.intel-collect.plist ~/Library/LaunchAgents/com.aios.intel-collect.plist
```

2. Edit the plist to set correct paths — replace the placeholders:
   - `__VENV_PYTHON__` → path to their Python (e.g., `/Users/name/workspace/.venv/bin/python` or just `python3`)
   - `__SCRIPTS_DIR__` → absolute path to their scripts/intel/ folder
   - `__WORKSPACE_ROOT__` → absolute path to their workspace root
   - `__INTERVAL__` → seconds between runs:
     - Daily: `86400`
     - Every 4 hours: `14400`
     - Every hour: `3600`

3. Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.aios.intel-collect.plist
```

4. Verify:
```bash
launchctl list | grep aios.intel
```

### Linux (cron)

```bash
crontab -e
```

Add one of these lines (adjust the path):
```
# Daily at 6am
0 6 * * * cd /path/to/workspace && python3 scripts/intel/collect_all.py >> data/intel-collect.log 2>&1

# Every 4 hours
0 */4 * * * cd /path/to/workspace && python3 scripts/intel/collect_all.py >> data/intel-collect.log 2>&1

# Every hour
0 * * * * cd /path/to/workspace && python3 scripts/intel/collect_all.py >> data/intel-collect.log 2>&1
```

**Important:** If using launchd/cron on a laptop, the machine needs to be awake at the scheduled time. For laptops: go to System Settings → Energy → disable "Put hard disks to sleep" and enable "Prevent automatic sleeping when the display is off."

---

## HOW TO USE IT

Now that IntelOS is running, here's what you can ask your AI:

**Meeting search:**
- "Find that meeting I had with [name] last week"
- "What did we discuss in the team meeting on Tuesday?"
- "Search my meetings for anything about the website redesign"

**Slack search:**
- "Has anyone mentioned [topic] in Slack this week?"
- "What was discussed in #general yesterday?"
- "Give me a summary of all Slack activity from last Friday"

**Quick queries (Claude runs these behind the scenes):**
```sql
-- Find meetings with a specific person
SELECT title, date, summary FROM meetings
WHERE participants LIKE '%jimmy%' ORDER BY date DESC LIMIT 5;

-- Search meeting transcripts
SELECT title, date, substr(transcript_text, 1, 200) FROM meetings
WHERE transcript_text LIKE '%budget%' ORDER BY date DESC;

-- Get all Slack messages from a channel on a date
SELECT user_name, text FROM slack_messages
WHERE channel_name = 'general'
AND DATE(datetime(CAST(ts AS REAL), 'unixepoch')) = '2026-02-25'
ORDER BY ts;

-- Daily Slack transcript (all channels, one day)
SELECT channel_name, user_name, text FROM slack_messages
WHERE DATE(datetime(CAST(ts AS REAL), 'unixepoch')) = '2026-02-25'
ORDER BY ts;

-- Meeting stats
SELECT stream, COUNT(*) as count FROM meetings
WHERE stream IS NOT NULL GROUP BY stream;
```

**Pro tip:** Add this to your CLAUDE.md so your AI always knows IntelOS is available:
```markdown
## IntelOS — Meeting & Slack Database
- Database: `data/intel.db` (or your DB path)
- Tables: `meetings`, `slack_messages`, `staff_registry`
- Query with: `sqlite3 data/intel.db "SELECT ..."`
- Search meetings: title, transcript_text, summary, participants, date
- Search Slack: text, channel_name, user_name, workspace
- Collection runs automatically on schedule
```

---

## WHAT'S NEXT

Now that IntelOS is running, here are your options:

1. **Daily Brief module** — Takes everything IntelOS collects and synthesizes it into a morning briefing delivered to your phone. The natural next step.
2. **Add more Slack channels** — Go into any Slack channel and `/invite @YourBot` to start collecting it.
3. **Add team members** — If you hire someone new, add them to the staff registry so classification stays accurate:
   ```python
   import sys; sys.path.insert(0, 'scripts/intel')
   from db import get_connection, write_staff
   conn = get_connection()
   write_staff(conn, [{"email": "new@co.com", "name": "New Person", "role": "Engineer", "team": "company", "department": "engineering"}])
   conn.close()
   ```
4. **CommandOS module** — Get a Telegram bot so you can query your IntelOS database from your phone: "What did we discuss in yesterday's standup?"

---

> A plug-and-play module from Liam Ottley's AAA Accelerator — the #1 AI business launch
> & AIOS program. Grab this and 15+ more at [aaaaccelerator.com](https://aaaaccelerator.com)

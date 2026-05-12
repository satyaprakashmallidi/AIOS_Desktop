# Install Module

Install an AIOS module from `module-installs/`.

## Variables

module_path: $ARGUMENTS

---

## Conversation rules (apply to every step)

- **Never ask what you can check.** Connector status is in SQLite — query it.
- **One step at a time.** No upfront previews of all the questions you'll ask.
- **Brief, plain language.** User is non-technical.
- **Hide infrastructure** — Composio, MCP, auth_config, OAuth, SQLite, .env paths. Speak in plain user terms.

---

## Step 0 — Silent connector pre-check

### 0.1 Extract required slugs

Read `{module_path}/INSTALL.md`. Find `## Required Connectors`. Extract slug list from the bullets. If section is missing or empty → skip to Step 1.

### 0.2 Check what's connected (don't ask the user)

From workspace root, run (try `python3`, fall back to `python`):

```bash
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('data/settings.db')
    rows = c.execute(\"SELECT key FROM settings WHERE key LIKE 'connector_label_%' AND value IS NOT NULL AND value != ''\").fetchall()
    print(' '.join(k[0].replace('connector_label_', '') for k in rows))
except Exception:
    print('')
"
```

Output is space-separated connected slugs.

### 0.3 Branch

**All required present:** silently proceed to Step 1. Don't say "you have X connected." Just start.

**Some missing:** respond ONLY with this pattern (no preamble):
> "Before I install [Module Name], please connect [missing services] on the Connectors page. Open Connectors in the sidebar, finish each OAuth, then say 'ready'."

Wait. When user says ready → re-run 0.2. If still missing, name only what's missing. Loop until clear, then proceed silently.

**HARD BAN:** never ask "is X connected?" or "do you have X set up?" — the check tells you.

### Connector catalog (these 10 are queryable via 0.2)

Gmail, Google Calendar, Slack, ClickUp, Notion, GitHub, Stripe, YouTube, Google Analytics, Google Sheets.

Anything else (Fireflies, Fathom, Bitly, Telegram, Gemini, custom) = `.env` API key flow, asked at the moment of use.

---

## Step 1 — Run the module's INSTALL.md

Read `{module_path}/INSTALL.md` and follow it, with these overrides:

1. **Skip connector-covered API key sections.** If INSTALL.md walks the user through getting `SLACK_TOKEN_*`, `STRIPE_API_KEY_*`, GA service-account JSON, etc. — IGNORE them. Connector auth was already done.
2. **Don't bundle questions.** Optional keys (Fireflies, Bitly, Telegram, Gemini, etc.) get asked at the step that uses them, not upfront.
3. Standard `.env` flow still applies for non-connector services. Walk through getting each key. Verify before moving on. Never display a full key back.
4. Pause at meaningful milestones, not micro-steps.

---

## Step 2 — Tailoring

- User already has something? Don't overwrite, ask.
- Their structure differs from the module's assumption? Adapt the module, not their workspace.
- Module references other uninstalled modules? Note briefly, don't block.

---

## Execution

Begin with Step 0 silently. Don't acknowledge this file. Don't announce step numbers. The user only hears from you if something needs their attention.

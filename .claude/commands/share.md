# Share

> Package a system or feature from your workspace for sharing. Deep-dives the system first, then produces a self-contained, beginner-friendly package with a Claude-guided installer that anyone can use.

## Variables

target: $ARGUMENTS (describe the feature/system to share, e.g., "the daily brief system", "the data pipeline", "the client onboarding flow")

---

## Stage 1: RESEARCH — Fully Understand the System

**Goal:** Map every piece of the system before writing a word.

**Actions:**

1. Parse the target description from the arguments
2. Search the codebase exhaustively for everything related:
   - Scripts and code — the actual implementation
   - Docs — any technical documentation
   - Commands (`.claude/commands/`) — slash commands involved
   - Skills (`.claude/skills/`) — skill definitions
   - Config (`.env`, `.env.example`) — required API keys and services
   - Database schemas — tables involved
   - Cron / scheduling — automation schedules
   - Dependencies (`requirements.txt`, `package.json`, imports in code)
3. Read every relevant file — understand inputs, processing, outputs, external dependencies, what's business-specific vs reusable
4. Build a **system component map** — every file, every external service, every API key, every scheduled job

**Present:**

```
System: {name}
Components:
  [x] {file/module 1} — {what it does}
  [x] {file/module 2} — {what it does}
  [x] {file/module 3} — {what it does}
  ...
External services: {list with whether each needs an API key}
API keys required: {count and list}
Database tables: {list or "none"}
Automation: {cron/launchd/manual/none}
Complexity: Simple (1-3 files) / Medium (4-10 files) / Complex (10+ files)
```

**STOP and wait for confirmation.** "Here's what I found. Anything I'm missing?"

---

## Stage 2: SCOPE — Define What Ships

**Goal:** Determine what to include and who it's for. Keep this efficient — 2-3 questions max.

**Actions:**

1. Present the component list from RESEARCH as a checklist. Mark recommended components with `[x]` and optional ones with `[ ]`:

   ```
   This system has these components:
   [x] {Core component} — {description}
   [x] {Required component} — {description}
   [ ] {Optional: advanced feature} — {description}
   [ ] {Optional: scheduling} — {description}

   What are we including? Everything checked, or want to add/remove?
   ```

2. Ask the **destination question**:

   ```
   Where is this going?
   A) Team (internal) — for team members or collaborators
   B) Community — for sharing in a group, forum, or community channel
   C) Clients — for clients or partners
   D) Public — for open sharing (blog, YouTube, social media)
   ```

3. Only if there are meaningful optional features, ask:
   ```
   Optional features: [{list}]. Include as add-ons, or skip?
   ```

**Record decisions:** Destination, components included, optional features.

**STOP and wait for answers before proceeding.**

---

## Stage 3: FRAME — Define the Value Proposition

**Goal:** Figure out why someone would want this and how to position it.

**Actions:**

1. Define the **problem** this system solves (plain language, from the recipient's perspective)
2. Define the **practical benefit** — what does the recipient get? How does it change their workflow?
3. Identify the **wow factor** — what's impressive about this system
4. Identify **considerations** — cost, complexity, prerequisites, maintenance

**Present:**

- "Here's how I'd position this: [problem → solution → benefit]. Does that capture it, or want to adjust?"

**STOP and wait for input before writing.**

---

## Stage 4: WRITE — Build the Package

**Goal:** Write the complete shareable package as a beginner-friendly setup guide with a Claude-guided installer.

Output to `shares/{name}/` with the following folder structure:

```
shares/{name}/
├── INSTALL.md              # THE KEY FILE — instructions FOR Claude to execute
├── README.md               # Human overview — what this does, what you need
├── scripts/
│   ├── requirements.txt    # Python dependencies
│   ├── .env.example        # Environment variable template with comments
│   └── *.py                # Module scripts (self-contained)
├── templates/              # Optional: context/config templates the user customizes
│   └── *.md
└── config/                 # Optional: scheduling configs (launchd plist, systemd service, cron)
    └── *.plist / *.service
```

**INSTALL.md must include these sections:**

1. **FOR CLAUDE** behavior section — tells Claude how to guide the user:
   - Assume non-technical unless told otherwise
   - Explain each step in plain English BEFORE doing it
   - Celebrate small wins ("API key verified — nice, that's the hardest part done!")
   - If something fails, explain simply and suggest the fix — never dump raw error logs
   - Never skip verification steps
   - Pace the install — pause after major milestones

2. **OVERVIEW** — 2-3 paragraphs in plain English: what this does, why it's useful, what they'll have when done, setup time estimate, running cost

3. **SCOPING** — RECOMMENDED (smart defaults, fastest path) vs CUSTOM (walk through every option). Ask the user which path.

4. **PREREQUISITES** — Check each one with verification commands. Provide install instructions if missing.

5. **API KEYS** — Step-by-step per key with exact URLs, exact click paths, verification commands. Collect one at a time.

6. **INSTALL** — Atomic numbered steps. After every 2-3 steps, add a `[VERIFY]` block. Group into phases for complex modules:
   - Phase 1: Foundation (folder, env, deps)
   - Phase 2: Core (main scripts)
   - Phase 3: Extras (scheduling, integrations)

7. **TEST** — Quick test + full test with expected output described in plain English.

8. **WHAT'S NEXT** — Natural next steps, customization suggestions, related systems.

**README.md should be short and scannable:**

- What this does (3 bullets)
- What you need (accounts, tools)
- How to install ("Give this folder to Claude Code, say 'read INSTALL.md and help me set this up'")
- Running cost
- File listing

### Code Extraction Rules

When extracting code from your workspace:

1. **Self-contained** — Every file works without importing workspace-specific modules. Inline utility functions.
2. **No proprietary data** — Strip business metrics, revenue figures, client names, internal strategy, sensitive IP.
3. **No hardcoded paths** — Use relative paths or `Path(__file__).resolve().parent`.
4. **Simplified** — Remove features not part of the system being shared.
5. **Working** — The code must run if someone follows the setup instructions.
6. **Commented** — Brief comments where logic isn't obvious. Plain English.
7. **Standalone testable** — Every script has `if __name__ == "__main__":` with a basic test.
8. **Helpful errors** — Error messages suggest fixes, not just report failures.

---

## Stage 5: VALIDATE — Walkthrough Check

**Goal:** Catch every issue that would confuse a first-time user.

**Actions:**

1. **Mental walkthrough** — Walk through the entire package as someone receiving it:
   - Would someone who just installed Claude Code be able to follow this?
   - Is every API key step specific enough? (Not "get your Stripe key" → "go to stripe.com/developers, click API Keys, copy the Secret key that starts with sk*live*")
   - Are there any steps that assume knowledge they might not have?
   - Are there missing prerequisites? (Python version, pip, npm, OS-specific tools)

2. **Dependency check** — Every import in scripts maps to a line in requirements.txt

3. **Path check** — No hardcoded absolute paths, no workspace-specific imports

4. **Completeness check** — Every file referenced in the setup instructions actually exists in the package

5. **Fix issues** — Do not just note problems. Fix them before presenting.

**Present validation results:**

- "I walked through this as a new user. Found and fixed {N} issues: {brief list}. The package is ready."

**STOP and present the completed package for review.**

---

## Stage 6: DELIVER — Save and Present

**Goal:** Finalize, save, and present the package.

**Actions:**

1. **Save the package** to `shares/{name}/`

2. **Create ZIP:**

   ```bash
   cd shares && zip -r {name}.zip {name}/
   ```

3. **Present summary:**

   ```
   Package: {name}
   Files: {count}
   External services: {list}
   API keys needed: {count}
   Setup time: {estimate}
   Running cost: {estimate}
   Caveats: {any limitations}
   Location: shares/{name}/
   ```

4. **Ask:** "Want to adjust anything, or is this ready to share?"

---

## Critical Rules

- **Research first, write second** — Never start writing until you've read and understood ALL the relevant code. Half-understood systems produce broken packages.
- **Scope before you write** — Never start writing until the destination is confirmed. The scoping conversation prevents wasted work.
- **Self-contained is non-negotiable** — The package must work on its own. No "also grab this from the other repo." Everything included.
- **Strip sensitive data** — Business metrics, revenue, client info, internal strategy — none goes in the package. Only system architecture and code.
- **INSTALL.md is the product** — The INSTALL.md matters more than the code. A perfect script with a confusing installer fails. A simple script with a clear installer succeeds.
- **Validate as a beginner** — Always complete Stage 5. If any step would confuse a first-time Claude Code user, fix it before delivering.
- **Honest about cost and complexity** — Don't undersell the setup. If it needs 5 API keys and a server, say so upfront.
- **Claude Code friendly** — Setup steps are atomic and testable. Claude can execute them step by step.

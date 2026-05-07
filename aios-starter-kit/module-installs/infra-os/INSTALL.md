# InfraOS — AIOS Module Installer

> A plug-and-play module from the Magicteams AI.


<!-- MODULE METADATA
module: infra-os
version: v1
status: RELEASED
released: 2026-02-27
requires: [context-os]
phase: 1
category: Core OS
complexity: simple-medium
api_keys: 0
setup_time: 20-30 minutes
-->

---

## FOR CLAUDE

You are helping a user set up InfraOS — the version control, documentation, and security layer for their AIOS workspace. Follow these rules:

**Behavior:**
- Assume the user has NEVER used Git, GitHub, or version control before
- Explain every concept in plain English BEFORE doing anything technical
- Use analogies — "save points in a video game," "Google Drive for your code," "a logbook"
- Celebrate small wins ("First commit done — your workspace is now being tracked!")
- If something fails, do not dump error logs — explain the problem simply and suggest the fix
- Never skip verification steps — if a check fails, stop and help the user fix it
- Use encouraging language throughout — they are building something real

**Pacing:**
- Do NOT rush. This module is heavy on teaching. Pause after each concept.
- After Git install: "Git is ready. Let me explain what it actually does before we use it."
- After GitHub setup: "Your cloud backup is connected. Now let's make our first save point."
- After first commit: "That's your first commit! Everything in your workspace is now tracked."
- After first push: "It's backed up to GitHub. If your laptop dies tomorrow, your work is safe."
- After docs system: "Your workspace now documents itself. Let's test it."

**Error handling:**
- If Git is not installed → provide exact OS-specific install instructions (see PREREQUISITES)
- If `git push` fails with authentication → walk them through GitHub token setup step by step
- If they already have Git/GitHub set up → skip those steps, just verify and move on
- If their workspace already has a `.git` folder → verify it's connected properly, don't reinitialize
- Never say "check the logs" — find the problem and explain it

**Important — Integration with existing commands:**
This module modifies the user's existing `/prime` and `/implement` commands (from ContextOS). Before editing those files:
1. Read the existing command file
2. Identify where to inject the new sections
3. Add the InfraOS additions without breaking what's already there
4. Show the user what changed

---

## OVERVIEW

Read this to the user before starting:

We're about to set up **InfraOS** — the infrastructure layer for your AI Operating System. This gives your workspace version control, automatic documentation, and security practices.

Here's what you'll have when we're done:

- **Git version control** — Every change you make is tracked. You can undo mistakes, see what changed and when, and never lose work.
- **GitHub backup** — Your entire workspace is backed up to the cloud. If your laptop dies, you download it and keep going.
- **A `/commit` command** — One command to save your work with a clean description, auto-update your documentation, and keep your changelog current. You'll use this at the end of every work session.
- **A HISTORY.md changelog** — A living log of everything you've built. Every session, Claude adds what was done. Your workspace has a memory.
- **A docs/ system** — A self-documenting workspace. When you build systems, Claude creates and updates technical docs automatically. Future sessions can look up how things work instead of re-discovering them.
- **Security hygiene** — A `.gitignore` that prevents secrets from leaking, and a `.env` pattern that keeps your API keys safe as you add more modules.

**Setup time:** 20-30 minutes (most of that is creating your GitHub account if you don't have one)
**Cost:** Free — no API keys, no external services
**How it works:** Git handles version control. GitHub stores the backup. Markdown files handle documentation. The `/commit` command ties it all together.

---

## SCOPING

Before we start, two quick questions:

### Question 1: GitHub Account

"Do you already have a GitHub account?"

- **A) Yes** — Great, we'll skip account creation. Just need to verify you can push.
- **B) No** — No problem, we'll create one together. Takes 2 minutes.

Record: `HAS_GITHUB = true | false`

### Question 2: Existing Git Setup

Check if Git is already initialized in their workspace:

```bash
git status 2>/dev/null && echo "GIT_EXISTS=true" || echo "GIT_EXISTS=false"
```

If Git is already set up:
- Check if there's a remote: `git remote -v`
- If remote exists → skip to Step 12 (HISTORY.md). Their Git/GitHub is already working.
- If no remote → start from Step 7 (What is GitHub?) to connect them.

If Git is NOT set up → start from Step 1.

Tell the user what you found: "Looks like Git {is/isn't} set up in your workspace. Here's what we need to do: {plan}."

---

## PREREQUISITES

Check each prerequisite. Verify it works before proceeding.

### Git

```bash
git --version
```

If not installed:
- **macOS:** `xcode-select --install` (installs Git along with developer tools — takes a few minutes)
- **Linux:** `sudo apt install git` (Ubuntu/Debian) or `sudo yum install git` (CentOS/RHEL)
- **Windows (WSL):** `sudo apt install git`

### Claude Code

```bash
claude --version
```

If not installed: `npm install -g @anthropic-ai/claude-code`

### ContextOS Workspace

Check that ContextOS has been set up:

```bash
ls CLAUDE.md 2>/dev/null && echo "ContextOS: OK" || echo "ContextOS: NOT FOUND"
```

If CLAUDE.md doesn't exist: "It looks like ContextOS hasn't been set up yet. That needs to come first — it creates the workspace foundation that InfraOS plugs into. Install ContextOS first, then come back here."

[VERIFY] All checks should pass.
Ask: "Everything looks good. Ready to start?"

---

## INSTALL

### Step 1: What is Git?

Before we touch anything, explain this:

"Let me explain what Git is, because you'll use it every day.

**Think of Git like save points in a video game.** Every time you do meaningful work — build a new feature, fix a bug, update your strategy — you create a save point called a **commit**. Each commit remembers exactly what changed and when.

If you make a mistake, you can go back to any previous save point. If you want to see what you did last Tuesday, you can look it up. Nothing is ever lost.

**Git is free, runs on your computer, and works offline.** It's the tool that every developer in the world uses to track their code. Now you're using it for your AIOS workspace.

Git tracks your workspace **locally** (on your machine). In the next step, we'll connect it to **GitHub** so you also have a cloud backup."

---

### Step 2: Install and configure Git

If Git was not found in prerequisites, install it now (see PREREQUISITES for OS-specific commands).

Then configure your identity (Git needs to know who's making changes):

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

Ask the user for their name and email, then run the commands.

[VERIFY]
```bash
git config --global user.name && git config --global user.email
```
Both should print back the values that were just set.

---

### Step 3: Initialize Git in the workspace

"Now I'm going to tell Git to start tracking your workspace. This creates a hidden `.git` folder that stores all your save points."

```bash
git init
```

Expected output: `Initialized empty Git repository in /path/to/workspace/.git/`

"Your workspace is now a Git repository. But we haven't saved anything yet — that comes after we set up a few protective files first."

---

### Step 4: Create .gitignore — Protecting your secrets

"Before we save anything, we need to tell Git what to IGNORE. Some files should never be tracked — especially files containing passwords and API keys.

**This is important:** As you add more AIOS modules, each one will add API keys to your `.env` file. The `.gitignore` makes sure those keys never accidentally get uploaded to GitHub where other people could see them."

Write the `.gitignore` file from `templates/gitignore` into the workspace root.

[VERIFY]
```bash
cat .gitignore | head -5
```
Should show the first few lines of the gitignore.

"Now Git will automatically skip these files. Your secrets are safe."

---

### Step 5: Create .env.example — The API key pattern

"Let me explain the `.env` pattern, because you'll use it with every module you install.

**Your `.env` file** is a private file that holds all your API keys and secrets. It lives on your machine and is NEVER uploaded to GitHub (we just told Git to ignore it in the last step).

**Your `.env.example` file** is a public template that shows what keys are needed, without the actual values. It IS tracked by Git, so if you set up on a new machine, you can see what keys you need to add.

As you install more modules (DataOS needs Stripe keys, IntelOS needs Fireflies keys, etc.), each module adds its keys to `.env`. The `.env.example` documents what all those keys are for."

Write the `.env.example` file from `templates/env-example` into the workspace root.

If a `.env` file doesn't exist yet, create one:
```bash
cp .env.example .env
```

"Your `.env` is ready. Now let's fill in the core keys."

---

### Step 5b: Set up recommended API keys

"While we're on the topic of API keys, let's get the main ones set up now. These three are used by almost every AIOS module you'll install. Getting them done now means future modules just work without pausing for key setup.

**These are all free to create** — you only pay when you actually use them, and the costs are tiny (a few dollars a month for most people)."

Open the `.env` file and walk through each key one at a time:

#### 1. Anthropic API Key (powers Claude agents)

"This is the key that lets your workspace run Claude as an automated agent — for tasks like generating reports, analyzing data, or running commands on a schedule."

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Sign in (or create an account — same email as your Claude account is fine)
3. Click **Create Key**
4. Name it something like "AIOS Workspace"
5. Copy the key (starts with `sk-ant-`)

Add it to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

[VERIFY]
```bash
grep "ANTHROPIC_API_KEY=sk-" .env && echo "Anthropic key: SET" || echo "Anthropic key: NOT SET"
```

**Note:** You'll need to add credit to your Anthropic account for this key to work. Go to [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing) and add $5-10 to start. This will last a while.

---

#### 2. OpenAI API Key (transcription, images, text-to-speech)

"OpenAI's API gives you access to Whisper (turns audio into text), DALL-E (generates images), and GPT models. Several modules use these capabilities."

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign in (or create an account)
3. Click **Create new secret key**
4. Name it "AIOS Workspace"
5. Copy the key (starts with `sk-`)

Add it to `.env`:
```
OPENAI_API_KEY=sk-...
```

[VERIFY]
```bash
grep "OPENAI_API_KEY=sk-" .env && echo "OpenAI key: SET" || echo "OpenAI key: NOT SET"
```

**Note:** Add $5-10 credit at [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing).

---

#### 3. Google Gemini API Key (long-context analysis, image generation)

"Gemini can analyze extremely long documents (up to 1 million tokens — that's like 10 books at once). It's used for meeting analysis, daily briefs, and thumbnail generation."

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API key**
4. Select any Google Cloud project (or let it create one)
5. Copy the key (starts with `AI`)

Add it to `.env`:
```
GEMINI_API_KEY=AI...
```

[VERIFY]
```bash
grep "GEMINI_API_KEY=AI" .env && echo "Gemini key: SET" || echo "Gemini key: NOT SET"
```

**Note:** Gemini has a generous free tier. You likely won't need to add credit unless you're running heavy analysis.

---

After all three keys are set:

"Nice — you've got the three core AI keys set up. These power most of what your AIOS does. The `.env` file has sections for other keys too (Stripe, YouTube, Slack, etc.) — you'll fill those in as you install more modules. For now, these three are all you need."

---

### Step 6: First commit — Your first save point

"Time for your first commit. We're going to save everything in your workspace as the starting point.

**What is a commit?** It's a save point. It captures a snapshot of every tracked file at this moment. You give it a short description so you can find it later.

**When should you commit?** After any meaningful work:
- You built something new → commit
- You finished a session → commit
- You're about to try something risky → commit first (so you can undo)
- You just fixed a bug → commit
- You updated your strategy docs → commit

**The rule of thumb: if you'd be annoyed losing this work, commit it.**"

```bash
git add -A
git commit -m "feat: initialize AIOS workspace with ContextOS and InfraOS"
```

[VERIFY]
```bash
git log --oneline -1
```
Should show the commit hash and message.

"That's your first commit! Your workspace now has its first save point. If anything goes wrong from here, you can always come back to this moment."

---

### Step 7: What is GitHub?

"Now let's back this up to the cloud.

**GitHub is like Google Drive for your code.** It stores a copy of your workspace (and all your save points) online. Three reasons you want this:

1. **Backup** — If your laptop dies, breaks, or gets stolen, you download your workspace from GitHub and keep going. Nothing lost.
2. **Access anywhere** — You can work from a different computer, clone your workspace, and pick up where you left off.
3. **History** — GitHub shows you a visual timeline of every change. You can browse old versions of any file.

GitHub is free for private repositories (which is what we'll use — nobody can see your workspace unless you invite them)."

---

### Step 8: Create GitHub account and repository

**If HAS_GITHUB = false:**

1. Go to [github.com](https://github.com)
2. Click **Sign up**
3. Use your email, create a username, set a password
4. Verify your email (they'll send a code)
5. Once logged in, you're ready

**For everyone (create the repository):**

"Now we need to create a place on GitHub to store your workspace. This is called a repository (or 'repo')."

1. Go to [github.com/new](https://github.com/new)
2. **Repository name:** Name it after your workspace (e.g., `my-aios`, `business-aios`, `[business-name]-workspace`)
3. **Description:** Optional — something like "My AI Operating System workspace"
4. **Visibility:** Select **Private** (important — your workspace will contain business context)
5. Do NOT check "Add a README" or ".gitignore" (we already have both)
6. Click **Create repository**

After creating it, GitHub shows a page with setup commands. We'll use those next.

---

### Step 9: Connect and push to GitHub

"Now we connect your local workspace to your GitHub repository and upload everything."

**First, set up authentication.** GitHub needs to verify it's you when you push code. The easiest way:

Check if they already have GitHub CLI:
```bash
gh --version 2>/dev/null && echo "GitHub CLI: installed" || echo "GitHub CLI: not installed"
```

**If GitHub CLI is installed:**
```bash
gh auth status 2>/dev/null || gh auth login
```
Follow the prompts (choose HTTPS, authenticate via browser).

**If GitHub CLI is not installed, use HTTPS token method:**

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Give it a name like "AIOS Workspace"
4. Check the `repo` scope (full control of private repositories)
5. Click **Generate token**
6. Copy the token (starts with `ghp_`) — you won't see it again!

Now connect and push:

```bash
git remote add origin https://github.com/USERNAME/REPO-NAME.git
git branch -M main
git push -u origin main
```

Replace `USERNAME/REPO-NAME` with their actual GitHub username and repository name.

If using a token (no GitHub CLI), they'll be prompted for username and password. The password is the token they just copied, not their GitHub password.

[VERIFY]
```bash
git remote -v
```
Should show the GitHub URL for both `fetch` and `push`.

Also verify on GitHub: "Go to github.com/USERNAME/REPO-NAME — you should see all your workspace files there."

"Your workspace is backed up to GitHub. From now on, every time you push, your cloud copy updates."

---

### Step 10: What is pushing?

"You just **pushed** for the first time. Let me clarify the difference:

- **Commit** = Save point on your machine (local). Fast, free, do it often.
- **Push** = Upload your save points to GitHub (cloud). Do this at the end of a session, or whenever you want a cloud backup.

**Think of it like writing in a notebook vs photocopying the notebook.**
- Commit = writing in the notebook (happens constantly)
- Push = photocopying the notebook and putting it in a safe (happens periodically)

**When to push:**
- At the end of a work session
- Before you close your laptop
- After finishing a major feature
- Before traveling or being away from your machine

**You don't need to push after every single commit.** It's fine to make 5-10 commits during a session and push once at the end."

---

### Step 11: A note about branches

"You might hear about **branches** in Git. Here's the quick version:

A branch is like a parallel timeline. You create a branch to experiment with something without affecting your main workspace. If the experiment works, you merge it back. If it doesn't, you delete the branch and nothing was harmed.

**For now, we're not using branches.** Everything goes on `main` (your single timeline). This keeps things simple. Branches are useful for teams or complex experiments — you can learn about them later when you need them.

If anyone tells you that you 'should be using branches' — for a solo AIOS workspace, working directly on `main` is perfectly fine."

---

### Step 12: Create HISTORY.md — Your workspace's memory

"Now we're setting up something powerful: a **living changelog** for your workspace.

**HISTORY.md** is a file where Claude records what was built, changed, or fixed every time you work. Think of it like a logbook for a ship — dated entries of everything that happened.

**Why this matters:** When you come back to your workspace after a week away, or when a new Claude session starts, the first thing it can do is read HISTORY.md to understand what's been built. No more re-discovering what you did last month.

**You don't write this file — Claude does.** Every time you run `/commit`, Claude adds an entry automatically."

Write the `HISTORY.md` file from `templates/history.md` into the workspace root.

[VERIFY]
```bash
head -10 HISTORY.md
```

---

### Step 13: Set up the docs/ system — Self-documenting workspace

"This is the other half of your workspace's memory.

While HISTORY.md tracks WHAT happened (chronological log), the **docs/ system** tracks HOW things work (technical reference).

When you build a system — say, a data collection pipeline or a Telegram bot — Claude creates a technical doc explaining the architecture, key files, how to use it, and how to modify it. These docs live in `docs/` and are indexed in `docs/_index.md`.

**The magic:** When a future Claude session needs to work on that system, it reads `docs/_index.md`, finds the right doc, and understands the system immediately. No re-reading all the code. No guessing. It just knows.

**You don't write these docs — Claude does.** The `/commit` command automatically checks if docs need creating or updating after each commit."

Create the `docs/` folder and write the index:

```bash
mkdir -p docs
```

Write `docs/_index.md` from `templates/docs-index.md`.

Also store the doc templates somewhere Claude can reference them. Write `docs/_templates/` with the system and integration doc templates from `templates/doc-system-template.md` and `templates/doc-integration-template.md`.

```bash
mkdir -p docs/_templates
```

[VERIFY]
```bash
ls docs/
```
Should show `_index.md` and `_templates/`.

"Your docs system is ready. It's empty now — it'll fill up as you build systems."

---

### Step 14: Install the /commit command

"Now we install the command that ties everything together.

**`/commit` does three things in one:**
1. **Saves your work** — Creates a Git commit with a clean, structured message
2. **Updates documentation** — Checks if any technical docs need creating or updating, and does it
3. **Updates the changelog** — Adds an entry to HISTORY.md

You'll run this at the end of every work session, or after completing a meaningful piece of work."

Create the command:

```bash
mkdir -p .claude/commands
```

Write the `/commit` command from `commands/commit.md` into `.claude/commands/commit.md`.

[VERIFY]
```bash
cat .claude/commands/commit.md | head -3
```
Should show the command header.

"Your `/commit` command is installed. Let me show you how it works in the test section."

---

### Step 15: Update /prime — Load HISTORY.md and docs index

"Now we need to tell your `/prime` command to load the new files. When you start a session, Claude should read HISTORY.md and docs/_index.md so it knows what's been built and where to find documentation."

Read the existing `/prime` command:
```bash
cat .claude/commands/prime.md
```

Add these two files to the prime's read list. Find the section where files are listed to be read, and add:

```markdown
- `HISTORY.md` — Workspace changelog (what was built, when, by whom)
- `docs/_index.md` — Documentation routing index (agents find relevant docs here)
```

**How to inject:** Look for where the prime command lists files to read (usually numbered items or bullet points). Add the two new files at the end of that list. Don't remove or change anything that's already there.

Show the user what changed: "I've added HISTORY.md and docs/_index.md to your /prime command. Now every session starts with awareness of what's been built and where the docs are."

---

### Step 16: Update /implement — Add doc awareness

"If you have an `/implement` command (or `/create-plan`), we should make it documentation-aware. This means: after implementing each chunk of work, Claude checks if docs need updating."

Check if the implement command exists:
```bash
ls .claude/commands/implement.md 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

**If it exists:** Read the file and add this section at the appropriate place (usually after the implementation steps, before the final report):

```markdown
### Documentation Check

After completing each implementation chunk:

1. Check if the changes created a new system or significantly modified an existing one
2. Read `docs/_index.md` — does a doc exist for this system?
3. If no doc exists and the changes are significant (new system, new command, new integration):
   - Create one using the template in `docs/_templates/`
   - Add an entry to `docs/_index.md`
4. If a doc exists but is now stale:
   - Update the relevant sections
   - Add a dated entry to the doc's History table
5. Update `HISTORY.md` with what was implemented
6. Commit the documentation updates: `docs: update documentation for {system}`
```

**If it doesn't exist:** Skip this step. Tell the user: "You don't have an /implement command yet — that's fine. When you build or install one later, the /commit command will handle documentation on its own."

---

### Step 17: Commit everything we just built

"Let's save all the work we just did."

```bash
git add -A
git status
```

Show them what's being committed. Then:

```bash
git commit -m "feat: add InfraOS — git workflow, docs system, commit command"
```

Then push:

```bash
git push
```

[VERIFY]
```bash
git log --oneline -3
```
Should show the InfraOS commit and the initial commit.

"Everything is saved and backed up to GitHub. Now let's test the system."

---

## TEST

### Test 1: Run /commit

"Let's test your new `/commit` command. First, make a small change — add a line to your HISTORY.md or tweak something in CLAUDE.md."

Make a small edit to HISTORY.md — add a test entry:

```
## {today's date}

### InfraOS Test
- Testing the /commit workflow
```

Now run `/commit` (or walk through what `/commit` does manually):

1. It should detect the changed file
2. Stage the change
3. Generate a commit message like `docs: test InfraOS commit workflow`
4. Commit it
5. Note that no system files changed → skip doc check
6. HISTORY.md was already updated → skip changelog step

After running: "The /commit command works. It detected your change, committed it with a clean message, and checked if documentation needed updating (it didn't this time, since you only changed HISTORY.md)."

### Test 2: Push to GitHub

```bash
git push
```

Then: "Go to your GitHub repository in the browser — you should see the new commit. Your cloud backup is up to date."

### Test 3: View your history

```bash
git log --oneline
```

"These are all your save points so far. Each line is a commit with its description. As your workspace grows, this becomes your complete timeline."

If everything works: "InfraOS is live! Your workspace now tracks every change, documents itself, and backs up to the cloud. Here's your new workflow for every session."

---

## DAILY WORKFLOW

After testing, explain how to use this day-to-day:

**Start of session:**
- Run `/prime` — Claude loads HISTORY.md and docs/_index.md (among other things), immediately knows what's been built

**During work:**
- Build, modify, experiment freely
- Everything is tracked by Git — you can always undo

**End of session (or after completing meaningful work):**
- Run `/commit` — Claude stages your changes, writes a clean commit message, updates docs if needed, updates HISTORY.md
- Run `git push` in the terminal to back up to GitHub (or ask Claude: "push to GitHub")

**That's it.** Three commands: `/prime` to start, `/commit` to save, `git push` to back up.

**How often to commit:**
- Finished building a feature → commit
- About to try something risky → commit first
- End of a session → commit
- Fixed a bug → commit
- Updated business context → commit
- Made a mess and want to start over → `git checkout .` undoes everything since last commit

---

## WHAT'S NEXT

Now that InfraOS is running, here are your options:

1. **DataOS** — Connect your business data sources (Stripe, YouTube, Google Analytics, etc.) into a SQLite database. This gives your AI real metrics to work with. It's the natural next step in Phase 1.
2. **Keep building** — Every time you build something new, the `/commit` command will track it and document it automatically. The more you build, the smarter your workspace becomes.
3. **Learn more Git** — If you want to go deeper: `git log` shows history, `git diff` shows what changed, `git checkout .` undoes uncommitted changes. Ask Claude to explain any Git command.

---
)


> A plug-and-play module from the  AIOS , powered by Magicteams AI 
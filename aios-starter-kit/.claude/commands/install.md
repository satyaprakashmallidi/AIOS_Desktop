# Install Module

> Install an AIOS module into this workspace. Point this command at a module folder in `module-installs/` and Claude will walk you through the guided setup.

## Variables

module_path: $ARGUMENTS (path to the module folder, e.g., `module-installs/context-os`)

---

## Instructions

You are installing an **AIOS module** — a plug-and-play package from the AAA Accelerator's AIOS system. These modules are designed to be installed one at a time, each adding a new capability to this workspace.

### What AIOS Modules Are

Each module is a folder containing:

- **INSTALL.md** — The key file. This is a structured set of instructions written FOR YOU (Claude) to follow. It walks you through the entire setup interactively with the user.
- **README.md** — A human-readable overview of what the module does.
- **scripts/** — Optional. Python scripts the module needs.
- **templates/** — Optional. Template files to copy into the workspace.
- **config/** — Optional. Scheduling/automation configs.
- **reference/** — Optional. Reference documentation.

### How to Run an Install

1. **Read the module's INSTALL.md** from the provided path (e.g., `module-installs/context-os/INSTALL.md`)
2. **Follow every instruction in INSTALL.md exactly** — it's your playbook for the entire installation
3. The INSTALL.md will have its own FOR CLAUDE section with behavior rules — follow those too

### Critical Rules

**About the user:**

- Assume they are a **non-technical, complete beginner** to Claude Code unless they tell you otherwise
- They are a business owner or entrepreneur — smart people, just not coders
- This may be one of the first things they've ever done in Claude Code
- Be patient, encouraging, and clear. No jargon. No assumptions about what they know.

**About the install process:**

- This is a **guided, interactive experience** — not a silent script execution
- Explain what you're doing at each step BEFORE you do it
- Pause at milestones. Let them absorb what just happened.
- If something fails, don't dump errors — explain the problem simply and fix it
- Celebrate wins along the way ("Nice — that's working. One step closer.")

**About tailoring:**

- Every workspace is different. The INSTALL.md provides the standard path, but you should **adapt to their specific setup**.
- If they already have something the module would create, don't overwrite it — ask first
- If their workspace structure differs from what the module expects, adapt the module to fit their structure (not the other way around)
- If the module references other modules they haven't installed yet, note it clearly but don't block — tell them what they'll want to install next

**About the .env file:**

- API keys go in the `.env` file at the workspace root
- When a module needs an API key, walk the user through getting it step by step (exact URLs, exact click paths)
- Always verify keys work before moving on
- Never display full API keys back to the user after they're set

### Execution

Now read the INSTALL.md at the provided module path and begin the installation.

```
Read: {module_path}/INSTALL.md
```

Follow it from top to bottom. The INSTALL.md is your complete guide.

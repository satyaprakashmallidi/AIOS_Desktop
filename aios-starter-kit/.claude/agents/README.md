# Claude Code Subagents

These are native [Claude Code subagents](https://code.claude.com/docs/en/subagents.md) — invocable from any chat with `@code-reviewer`, `@brief-writer`, `@researcher`, or auto-delegated by Claude when the task matches a subagent's `description`.

Each subagent runs in **its own context window** with a focused system prompt and a constrained tool set. Use them when you want sharp, predictable behavior for a recurring kind of task.

## Bundled (v0.2.39+)

- **code-reviewer** — finds real bugs in diffs, not stylistic feedback
- **brief-writer** — tight 30-second-read daily/weekly briefs  
- **researcher** — multi-source structured research with citations

## Add your own

Drop a Markdown file here with YAML frontmatter:

```markdown
---
name: my-agent
description: When this agent should be invoked (Claude auto-routes based on this).
tools: Read, Bash, WebSearch
model: haiku
---

System prompt body here.
```

Restart the workspace (Cmd+R) and the new subagent is available.

## Relationship to AIOS's CEO/specialist tree

AIOS's own agent system (CEO + 9 specialists in the Agents canvas) is **separate** from these Claude Code subagents — it uses the AIOS Tasks system to run scheduled missions. These subagents are for inline chat-time delegation. Both coexist; pick whichever fits the task.

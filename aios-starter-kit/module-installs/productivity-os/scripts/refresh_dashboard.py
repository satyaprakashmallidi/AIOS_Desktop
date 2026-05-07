#!/usr/bin/env python3
"""Refresh the GTD dashboard from source files.

Recomputes project counts, action counts, waiting-for counts, and
rebuilds the dashboard summary sections from the source GTD files.

Run after any GTD file changes to keep the dashboard current.

Usage:
    python3 scripts/refresh_dashboard.py
"""

import re
from datetime import datetime, timedelta
from pathlib import Path


def find_workspace_root() -> Path:
    """Find the workspace root by looking for the gtd/ folder."""
    # Start from the script's location and walk up
    current = Path(__file__).resolve().parent
    for _ in range(5):
        if (current / "gtd").is_dir():
            return current
        current = current.parent
    # Fallback: assume scripts/ is one level below workspace root
    return Path(__file__).resolve().parent.parent


def count_active_projects(projects_text: str) -> int:
    """Count ### headers in projects.md that aren't completed or archived."""
    count = 0
    in_archived = False
    for line in projects_text.splitlines():
        if line.strip().lower().startswith("## archived"):
            in_archived = True
        if line.startswith("### ") and not in_archived:
            count += 1
    return count


def count_unchecked(text: str) -> int:
    """Count unchecked items (- [ ] lines)."""
    return len(re.findall(r"^- \[ \]", text, re.MULTILINE))


def count_waiting_for_active(wf_text: str) -> int:
    """Count unchecked items in the Active section of waiting-for.md."""
    # Find the Active section
    active_match = re.search(r"## Active\s*\n(.*?)(?=\n## |\Z)", wf_text, re.DOTALL)
    if not active_match:
        return 0
    return count_unchecked(active_match.group(1))


def build_project_summary(projects_text: str) -> str:
    """Build the Active Projects by Area section from projects.md."""
    lines = projects_text.splitlines()
    summary_lines = []
    current_area = None
    in_archived = False

    for line in lines:
        # Detect area headers (## level)
        if line.startswith("## "):
            area_name = line[3:].strip()
            if area_name.lower() == "archived":
                in_archived = True
                continue
            in_archived = False
            current_area = area_name
            summary_lines.append(f"\n### {current_area}")
            continue

        # Skip archived section
        if in_archived:
            continue

        # Detect project headers (### level)
        if line.startswith("### ") and current_area:
            project_name = line[4:].strip()

            # Read ahead to find status
            idx = lines.index(line)
            status_hint = ""
            for check_line in lines[idx + 1 : idx + 6]:
                if check_line.strip().startswith("- **Status:**"):
                    status_text = check_line.split("**Status:**")[1].strip()
                    status_hint = status_text[:80]
                    break

            is_complete = "complete" in status_hint.lower()
            checkbox = "[x]" if is_complete else "[ ]"
            hint = f" -> {status_hint}" if status_hint else ""
            summary_lines.append(f"- {checkbox} {project_name}{hint}")

    # If no projects found in any area, add a placeholder
    if not any(line.startswith("- ") for line in summary_lines):
        summary_lines.append("\n_(No active projects yet)_")

    return "\n".join(summary_lines)


def build_waiting_for_summary(wf_text: str) -> str:
    """Build the Waiting For summary with age calculation."""
    active_match = re.search(r"## Active\s*\n(.*?)(?=\n## |\Z)", wf_text, re.DOTALL)
    if not active_match:
        return "_(Nothing delegated yet)_"

    active_section = active_match.group(1)
    items = re.findall(r"^- \[ \] (.+)$", active_section, re.MULTILINE)

    if not items:
        return "_(Nothing delegated yet)_"

    today = datetime.now().date()
    summary_lines = []

    for item in items:
        # Try to extract person name (bold)
        person_match = re.search(r"\*\*(.+?)\*\*", item)
        person = person_match.group(1) if person_match else "Someone"

        # Try to extract date
        date_match = re.search(r"Requested:\s*(\d{4}-\d{2}-\d{2})", item)
        age_str = ""
        warning = ""
        if date_match:
            req_date = datetime.strptime(date_match.group(1), "%Y-%m-%d").date()
            age_days = (today - req_date).days
            age_str = f" ({age_days}d)"
            if age_days > 5:
                warning = " !!!"

        # Truncate description
        desc = item[:60] + "..." if len(item) > 60 else item
        summary_lines.append(f"- [ ] {desc}{age_str}{warning}")

    return "\n".join(summary_lines)


def prune_recently_completed(dashboard_text: str, max_age_days: int = 14) -> str:
    """Remove Recently Completed entries older than max_age_days."""
    today = datetime.now().date()
    cutoff = today - timedelta(days=max_age_days)

    lines = dashboard_text.splitlines()
    result = []
    in_completed = False

    for line in lines:
        if "## Recently Completed" in line:
            in_completed = True
            result.append(line)
            continue

        if in_completed and line.startswith("## "):
            in_completed = False

        if in_completed and line.startswith("- [x]"):
            # Try to find a date in the line
            date_match = re.search(r"\((\d{4}-\d{2}-\d{2})\)", line)
            if date_match:
                entry_date = datetime.strptime(date_match.group(1), "%Y-%m-%d").date()
                if entry_date < cutoff:
                    continue  # Skip old entries

        result.append(line)

    return "\n".join(result)


def refresh_dashboard(workspace_dir: Path) -> str:
    """Refresh dashboard.md from source GTD files."""
    gtd_dir = workspace_dir / "gtd"

    # Read source files
    projects_text = (gtd_dir / "projects.md").read_text(encoding="utf-8")
    actions_text = (gtd_dir / "next-actions.md").read_text(encoding="utf-8")
    wf_text = (gtd_dir / "waiting-for.md").read_text(encoding="utf-8")
    dashboard_text = (gtd_dir / "dashboard.md").read_text(encoding="utf-8")

    # Compute counts
    project_count = count_active_projects(projects_text)
    action_count = count_unchecked(actions_text)
    wf_count = count_waiting_for_active(wf_text)

    # Update header counts
    dashboard_text = re.sub(
        r"\*\*Projects:\*\* \d+ active",
        f"**Projects:** {project_count} active",
        dashboard_text,
    )
    dashboard_text = re.sub(
        r"\*\*Next Actions:\*\* \d+ defined",
        f"**Next Actions:** {action_count} defined",
        dashboard_text,
    )
    dashboard_text = re.sub(
        r"\*\*Waiting For:\*\* \d+ items",
        f"**Waiting For:** {wf_count} items",
        dashboard_text,
    )

    # Rebuild Active Projects by Area section
    project_summary = build_project_summary(projects_text)
    dashboard_text = re.sub(
        r"(## Active Projects by Area\s*\n).*?(?=\n---)",
        f"\\1{project_summary}\n",
        dashboard_text,
        flags=re.DOTALL,
    )

    # Rebuild Waiting For summary
    wf_summary = build_waiting_for_summary(wf_text)
    dashboard_text = re.sub(
        r"(## Waiting For \(Active\)\s*\n).*?(?=\n---|\Z)",
        f"\\1\n{wf_summary}\n",
        dashboard_text,
        flags=re.DOTALL,
    )

    # Prune old Recently Completed entries
    dashboard_text = prune_recently_completed(dashboard_text)

    # Write back
    (gtd_dir / "dashboard.md").write_text(dashboard_text, encoding="utf-8")

    return f"Dashboard refreshed: {project_count} projects, {action_count} actions, {wf_count} waiting-for"


if __name__ == "__main__":
    workspace = find_workspace_root()
    result = refresh_dashboard(workspace)
    print(result)

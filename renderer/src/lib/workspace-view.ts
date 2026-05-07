import type {
  ClaudeStatus,
  ConnectionStatus,
  ContextSection,
  ContextSummary,
  ModuleInfo,
  RecentActivityEntry,
  WorkspaceInfo
} from "../types";

export function buildContextSections(context: ContextSummary, recent: RecentActivityEntry[]): ContextSection[] {
  const modifiedByPath = new Map(recent.map((entry) => [entry.path, entry.modifiedAt]));
  const findPreview = (path: string) => context.files.find((file) => file.path === path)?.preview ?? "";
  return [
    { id: "personal", title: "Personal", path: "context/personal-info.md", preview: findPreview("context/personal-info.md"), modifiedAt: modifiedByPath.get("context/personal-info.md") },
    { id: "business", title: "Business", path: "context/business-info.md", preview: findPreview("context/business-info.md"), modifiedAt: modifiedByPath.get("context/business-info.md") },
    { id: "strategy", title: "Strategy", path: "context/strategy.md", preview: findPreview("context/strategy.md"), modifiedAt: modifiedByPath.get("context/strategy.md") },
    { id: "current-data", title: "Current Data", path: "context/current-data.md", preview: findPreview("context/current-data.md"), modifiedAt: modifiedByPath.get("context/current-data.md") }
  ];
}

export function buildConnections(
  claude: ClaudeStatus | null,
  modules: ModuleInfo[],
  context: ContextSummary,
  workspace: WorkspaceInfo | null
): ConnectionStatus[] {
  return [
    {
      id: "claude",
      label: "Claude CLI",
      status: claude?.found ? "connected" : "missing",
      detail: claude?.version ?? "Not connected"
    },
    {
      id: "context",
      label: "Core context",
      status: context.files.filter((file) => file.exists).length >= 4 ? "connected" : "warning",
      detail: `${context.files.filter((file) => file.exists).length}/${context.files.length} core files present`
    },
    {
      id: "imports",
      label: "Context imports",
      status: context.imports.length > 0 ? "connected" : "warning",
      detail: context.imports.length ? `${context.imports.length} files available to Claude` : "No live imports yet"
    },
    {
      id: "modules",
      label: "Installed modules",
      status: modules.some((module) => module.installed) ? "connected" : "warning",
      detail: `${modules.filter((module) => module.installed).length}/${modules.length} active`
    },
    {
      id: "workspace",
      label: "Runtime workspace",
      status: workspace?.hasClaudeMd ? "connected" : "warning",
      detail: workspace?.workspaceRoot ?? "Workspace unavailable"
    }
  ];
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

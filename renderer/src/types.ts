export type AiosCommand =
  | "get_workspace_info"
  | "get_onboarding_state"
  | "save_onboarding_answer"
  | "complete_onboarding"
  | "reset_onboarding"
  | "read_file"
  | "write_file"
  | "append_file"
  | "move_file"
  | "list_modules"
  | "install_module"
  | "get_context_summary"
  | "list_workspace_files"
  | "list_workspace_section"
  | "list_directory"
  | "get_recent_workspace_activity"
  | "read_markdown_preview"
  | "list_outputs"
  | "list_plans"
  | "list_shares"
  | "get_sessions"
  | "create_thread"
  | "rename_thread"
  | "delete_thread"
  | "save_session"
  | "run_prime"
  | "run_task"
  | "get_setting"
  | "set_setting"
  | "find_claude"
  | "set_claude_path"
  | "test_claude_connection"
  | "reveal_in_file_manager"
  | "transcribe_audio"
  | "restore_context_template"
  | "write_binary_file"
  | "list_imports"
  | "delete_import"
  | "list_auto_tasks"
  | "create_auto_task"
  | "update_auto_task"
  | "delete_auto_task"
  | "toggle_auto_task"
  | "list_recent_auto_runs"
  | "list_due_auto_tasks"
  | "begin_auto_task_run"
  | "finish_auto_task_run"
  | "advance_auto_task"
  | "delete_workspace_file"
  | "run_auto_task_now"
  | "get_today_brief_status"
  | "generate_daily_brief"
  | "list_daily_briefs"
  | "mark_brief_seen"
  | "list_import_folder"
  | "create_import_folder"
  | "delete_import_folder"
  | "update_claude_mcp"
  | "rotate_device_user_id";

export interface DailyBrief {
  id: number;
  briefDate: string;
  generatedAt: string;
  headline: string | null;
  content: string;
}

export interface DailyBriefStatus {
  shouldShow: boolean;
  todayDate: string;
  firstInstallDate: string | null;
  lastBriefSeenDate: string | null;
  existingBrief: DailyBrief | null;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface AiosApi {
  invoke<T = unknown>(cmd: AiosCommand, args?: Record<string, unknown>): Promise<ApiResponse<T>>;
  onHostEvent: (callback: (event: HostEvent) => void) => () => void;
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  openOauthWindow: (url: string) => Promise<{ ok: boolean; completed?: boolean; error?: string }>;
  checkForUpdates: () => Promise<{ ok: boolean; reason?: string; error?: string; currentVersion?: string; latestVersion?: string; hasUpdate?: boolean }>;
  installUpdate: () => Promise<{ ok: boolean; reason?: string; error?: string }>;
  onUpdateState: (callback: (event: { state: string; version?: string; percent?: number; message?: string }) => void) => () => void;
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    onMaximizedChanged: (callback: (maximized: boolean) => void) => void;
    onShortcutPreferences: (callback: () => void) => void;
  };
}

export interface HostEvent<T = unknown> {
  id: string;
  event: string;
  data: T;
}

export interface ClaudeToolUseEvent {
  id: string;
  name: string;
  summary: string;
}

export interface ClaudeToolResultEvent {
  toolUseId: string;
  isError: boolean;
}

export interface ClaudeStreamEvent {
  streamId: string;
  delta?: string;
  response?: string;
  sessionId?: string;
  durationMs?: number;
  costUsd?: number;
  done?: boolean;
  toolUse?: ClaudeToolUseEvent;
  toolResult?: ClaudeToolResultEvent;
}

declare global {
  interface Window {
    aios: AiosApi;
  }
}

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  source: string;
  installPath: string;
  phase: number;
  available?: boolean;
  sourceExists: boolean;
  installed: boolean;
  installedAt: string | null;
  enabled: boolean;
  readiness: string;
  capability?: string;
  requires?: string[];
  artifacts?: string[];
  connections?: string[];
  builtIn?: boolean;
  builtInRoute?: string | null;
  builtInButtonLabel?: string | null;
}

export interface WorkspaceInfo {
  workspaceRoot: string;
  hasClaudeMd: boolean;
  platform: string;
  settingsDb: string;
  modules: ModuleInfo[];
  deviceUserId: string;
}

export interface ClaudeStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  checked: string[];
  error?: string;
  runtimeOk?: boolean;
  runtimeError?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt?: string;
  claudeSessionId?: string | null;
}

export interface WorkspaceEntry {
  path: string;
  kind: "context" | "import" | "output" | "plan" | "share" | "reference" | "script" | "module" | "file";
  name: string;
  extension: string;
  modifiedAt: string;
  size: number;
  preview: string;
  isDir: boolean;
}

export interface ContextFileSummary {
  path: string;
  exists: boolean;
  preview: string;
}

export interface AutoTaskRun {
  id: number;
  taskId: number;
  startedAt: string;
  finishedAt: string | null;
  status: "pending" | "success" | "failed";
  outputPath: string | null;
  costUsd: number | null;
  error: string | null;
  taskName?: string;
}

export interface AutoTask {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  scheduleLabel: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
  recentRuns: AutoTaskRun[];
}

export interface ImportedContextSummary {
  path: string;
  name: string;
  preview: string;
  updatedAt: string;
}

export interface ContextSummary {
  files: ContextFileSummary[];
  imports: ImportedContextSummary[];
}

export interface ContextSection {
  id: "personal" | "business" | "strategy" | "current-data";
  title: string;
  path: string;
  preview: string;
  modifiedAt?: string | null;
}

export interface OutputEntry extends WorkspaceEntry {}
export interface PlanEntry extends WorkspaceEntry {}
export interface RecentActivityEntry extends WorkspaceEntry {}

export interface FilePreview {
  path: string;
  content: string;
  preview: string;
  modifiedAt: string | null;
  kind: WorkspaceEntry["kind"];
}

export interface ConnectionStatus {
  id: string;
  label: string;
  status: "connected" | "warning" | "missing";
  detail: string;
}

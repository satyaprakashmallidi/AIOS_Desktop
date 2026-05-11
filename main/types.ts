export type AiosCommand =
  | "get_workspace_info"
  | "get_onboarding_state"
  | "save_onboarding_answer"
  | "complete_onboarding"
  | "reset_onboarding"
  | "reset_workspace"
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
  | "transcribe_audio"
  | "get_setting"
  | "set_setting"
  | "find_claude"
  | "set_claude_path"
  | "test_claude_connection"
  | "reveal_in_file_manager"
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
  | "rotate_device_user_id"
  | "list_connector_status";

export interface HostRequest {
  id: string;
  cmd: AiosCommand;
  args?: Record<string, unknown>;
}

export interface HostResponse<T = unknown> {
  id: string;
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface HostEvent<T = unknown> {
  id: string;
  event: string;
  data: T;
}

export interface ClaudeDetection {
  found: boolean;
  path: string | null;
  version: string | null;
  checked: string[];
  error?: string;
}

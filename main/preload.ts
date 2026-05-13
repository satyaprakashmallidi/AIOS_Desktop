import { contextBridge, ipcRenderer } from "electron";
import type { AiosCommand } from "./types";

const allowedCommands = new Set<AiosCommand>([
  "get_workspace_info",
  "get_onboarding_state",
  "save_onboarding_answer",
  "complete_onboarding",
  "reset_onboarding",
  "reset_workspace",
  "read_file",
  "write_file",
  "append_file",
  "move_file",
  "list_modules",
  "install_module",
  "get_context_summary",
  "list_workspace_files",
  "list_workspace_section",
  "list_directory",
  "get_recent_workspace_activity",
  "read_markdown_preview",
  "list_outputs",
  "list_plans",
  "list_shares",
  "get_sessions",
  "create_thread",
  "rename_thread",
  "delete_thread",
  "save_session",
  "run_prime",
  "run_task",
  "transcribe_audio",
  "get_setting",
  "set_setting",
  "find_claude",
  "set_claude_path",
  "test_claude_connection",
  "reveal_in_file_manager",
  "restore_context_template",
  "write_binary_file",
  "list_imports",
  "delete_import",
  "list_auto_tasks",
  "create_auto_task",
  "update_auto_task",
  "delete_auto_task",
  "toggle_auto_task",
  "list_recent_auto_runs",
  "list_due_auto_tasks",
  "begin_auto_task_run",
  "finish_auto_task_run",
  "advance_auto_task",
  "delete_workspace_file",
  "run_auto_task_now",
  "get_today_brief_status",
  "generate_daily_brief",
  "list_daily_briefs",
  "mark_brief_seen",
  "list_import_folder",
  "create_import_folder",
  "delete_import_folder",
  "update_claude_mcp",
  "rotate_device_user_id",
  "list_connector_status",
  "list_agents",
  "get_agent",
  "update_agent_prompt",
  "reset_agent_prompt",
  "delete_agent",
  "list_tasks",
  "get_task",
  "create_task",
  "task_action",
  "cancel_task",
  "whatsapp_status",
  "whatsapp_start",
  "whatsapp_stop"
]);

contextBridge.exposeInMainWorld("aios", {
  invoke: (cmd: AiosCommand, args: Record<string, unknown> = {}) => {
    if (!allowedCommands.has(cmd)) {
      return Promise.reject(new Error(`Command is not allowed: ${cmd}`));
    }
    return ipcRenderer.invoke("aios:invoke", cmd, args);
  },
  onHostEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("aios:host-event", listener);
    return () => ipcRenderer.removeListener("aios:host-event", listener);
  },
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("aios:open-external", url),
  openOauthWindow: (url: string): Promise<{ ok: boolean; completed?: boolean; error?: string }> =>
    ipcRenderer.invoke("aios:open-oauth-window", url),
  getVersion: (): Promise<string> => ipcRenderer.invoke("aios:get-version"),
  checkForUpdates: (): Promise<{ ok: boolean; reason?: string; error?: string; currentVersion?: string; latestVersion?: string; hasUpdate?: boolean; manualDownloadUrl?: string }> =>
    ipcRenderer.invoke("aios:check-for-updates"),
  installUpdate: (): Promise<{ ok: boolean; reason?: string; error?: string }> =>
    ipcRenderer.invoke("aios:install-update"),
  onUpdateState: (callback: (event: { state: string; version?: string; percent?: number; message?: string; manualDownloadUrl?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { state: string; version?: string; percent?: number; message?: string; manualDownloadUrl?: string }) => callback(payload);
    ipcRenderer.on("aios:update-state", listener);
    return () => ipcRenderer.removeListener("aios:update-state", listener);
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    onMaximizedChanged: (callback: (maximized: boolean) => void) => {
      ipcRenderer.on("window:maximized-changed", (_event, maximized) => callback(maximized));
    },
    onShortcutPreferences: (callback: () => void) => {
      ipcRenderer.on("shortcut:preferences", () => callback());
    }
  }
});

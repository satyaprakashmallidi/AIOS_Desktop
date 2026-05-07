import type { AiosCommand, ApiResponse } from "../types";

export async function invoke<T = unknown>(cmd: AiosCommand, args: Record<string, unknown> = {}): Promise<T> {
  if (!window.aios) return mockInvoke<T>(cmd, args);
  const response: ApiResponse<T> = await window.aios.invoke<T>(cmd, args);
  if (!response.ok) {
    throw new Error(response.error?.message || `Command failed: ${cmd}`);
  }
  return response.data as T;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let mockSessions: Array<{
  id: string;
  title: string;
  messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}> | null = null;

async function mockInvoke<T>(cmd: AiosCommand, args: Record<string, unknown>): Promise<T> {
  const now = new Date().toISOString();
  const emptyEntries = { entries: [] };
  if (!mockSessions) {
    mockSessions = [
      {
        id: newId("thread"),
        title: "New chat",
        messages: [],
        createdAt: now,
        updatedAt: now
      }
    ];
  }
  if (cmd === "create_thread") {
    const created = {
      id: newId("thread"),
      title: (args.title as string) || "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    mockSessions = [created, ...mockSessions];
    return created as T;
  }
  if (cmd === "save_session" && args.session) {
    const saved = args.session as (typeof mockSessions)[number];
    mockSessions = mockSessions.map((session) => (session.id === saved.id ? saved : session));
    return null as T;
  }
  const data: Partial<Record<AiosCommand, unknown>> = {
    get_workspace_info: {
      workspaceRoot: "browser-preview",
      hasClaudeMd: true,
      platform: "browser",
      settingsDb: "",
      modules: []
    },
    get_onboarding_state: {
      completedAt: now,
      currentStep: 0,
      answers: []
    },
    list_modules: [],
    get_context_summary: {
      files: [
        { name: "vision.md", path: "context/vision.md", exists: true, size: 1, updatedAt: now },
        { name: "profile.md", path: "context/profile.md", exists: true, size: 1, updatedAt: now },
        { name: "systems.md", path: "context/systems.md", exists: true, size: 1, updatedAt: now },
        { name: "plans.md", path: "context/plans.md", exists: true, size: 1, updatedAt: now },
        { name: "memory.md", path: "context/memory.md", exists: true, size: 1, updatedAt: now }
      ],
      imports: []
    },
    get_recent_workspace_activity: emptyEntries,
    list_outputs: emptyEntries,
    list_plans: emptyEntries,
    list_shares: emptyEntries,
    get_sessions: mockSessions,
    find_claude: { found: true, path: "browser-preview", version: "preview", checked: [], runtimeOk: true },
    test_claude_connection: { ok: true, version: "preview" },
    save_session: null,
    run_prime: {
      response: "Browser preview prime complete. AIOS has workspace context loaded and is ready for a real Claude run in the desktop app.",
      sessionId: "browser-preview",
      durationMs: 850,
      costUsd: 0
    },
    run_task: {
      response: `Browser preview response for: ${args.prompt ?? ""}`,
      sessionId: "browser-preview",
      durationMs: 700,
      costUsd: 0
    }
  };
  return data[cmd] as T;
}

import React, { startTransition, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Boxes,
  ClipboardList,
  Clock,
  FileText,
  FolderOpen,
  Inbox,
  MessageSquare,
  Minus,
  Plug,
  Plus,
  Settings,
  Sparkles,
  Square,
  Sun,
  X
} from "lucide-react";
import { invoke } from "./lib/api";
import { buildConnections, buildContextSections } from "./lib/workspace-view";
import { NavItem, StatusBadge } from "./components/ui";
import { BrandMark } from "./components/BrandMark";
import { CommandScreen } from "./screens/CommandScreen";
import { AutoTasksScreen } from "./screens/AutoTasksScreen";
import { ContextScreen } from "./screens/ContextScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ImportsScreen } from "./screens/ImportsScreen";
import { ModulesScreen } from "./screens/ModulesScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { OutputsScreen } from "./screens/OutputsScreen";
import { PlansScreen } from "./screens/PlansScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { BriefsScreen } from "./screens/BriefsScreen";
import { ConnectorsScreen } from "./screens/ConnectorsScreen";
import { DailyBriefModal } from "./screens/DailyBriefModal";
import type {
  ChatSession,
  ClaudeStatus,
  ConnectionStatus,
  ContextSummary,
  DailyBriefStatus,
  ModuleInfo,
  RecentActivityEntry,
  WorkspaceEntry,
  WorkspaceInfo
} from "./types";
import type { OnboardingState, Screen } from "./ui";
import { relay, RELAY_AVAILABLE } from "./lib/aios-relay";
import "./styles.css";

function App() {
  const [screen, setScreen] = useState<Screen>("command");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [context, setContext] = useState<ContextSummary>({ files: [], imports: [] });
  const [recent, setRecent] = useState<RecentActivityEntry[]>([]);
  const [outputs, setOutputs] = useState<WorkspaceEntry[]>([]);
  const [plans, setPlans] = useState<WorkspaceEntry[]>([]);
  const [shares, setShares] = useState<WorkspaceEntry[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefStatus, setBriefStatus] = useState<DailyBriefStatus | null>(null);
  const [briefDismissed, setBriefDismissed] = useState(false);

  async function refreshWorkspace() {
    const [
      workspaceInfo,
      onboardingState,
      moduleList,
      contextSummary,
      recentActivity,
      outputSummary,
      planSummary,
      shareSummary,
      sessionList
    ] = await Promise.all([
      invoke<WorkspaceInfo>("get_workspace_info"),
      invoke<OnboardingState>("get_onboarding_state"),
      invoke<ModuleInfo[]>("list_modules"),
      invoke<ContextSummary>("get_context_summary"),
      invoke<{ entries: RecentActivityEntry[] }>("get_recent_workspace_activity", { limit: 12 }),
      invoke<{ entries: WorkspaceEntry[] }>("list_outputs"),
      invoke<{ entries: WorkspaceEntry[] }>("list_plans"),
      invoke<{ entries: WorkspaceEntry[] }>("list_shares"),
      invoke<ChatSession[]>("get_sessions")
    ]);

    let nextSessions = sessionList;
    if (!nextSessions.length) {
      const mainThread = await invoke<ChatSession>("create_thread", { title: "Main" });
      nextSessions = [mainThread];
    }

    startTransition(() => {
      setWorkspace(workspaceInfo);
      setOnboarding(onboardingState);
      setModules(moduleList);
      setContext(contextSummary);
      setRecent(recentActivity.entries);
      setOutputs(outputSummary.entries);
      setPlans(planSummary.entries);
      setShares(shareSummary.entries);
      setSessions(nextSessions);
      setActiveSessionId((current) => current ?? nextSessions[0]?.id ?? null);
    });
  }

  async function openInNewChat(prompt: string) {
    try {
      const created = await invoke<ChatSession>("create_thread", { title: "New chat" });
      setSessions((current) => [created, ...current]);
      setActiveSessionId(created.id);
      setScreen("command");
      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent("aios:set-prompt", { detail: prompt }));
      }, 60);
    } catch {
      setScreen("command");
      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent("aios:set-prompt", { detail: prompt }));
      }, 60);
    }
  }

  async function detectClaude() {
    const detected = await invoke<ClaudeStatus>("find_claude");
    if (!detected.found || !detected.path) {
      const next = {
        ...detected,
        runtimeOk: false,
        runtimeError: detected.error ?? "Claude executable was not found."
      };
      setClaude(next);
      return next;
    }
    try {
      const runtime = await invoke<{ ok: boolean; version: string | null; error?: string }>("test_claude_connection", { path: detected.path });
      const next = {
        ...detected,
        runtimeOk: runtime.ok,
        runtimeError: runtime.ok ? undefined : runtime.error ?? "Claude runtime check failed."
      };
      setClaude(next);
      return next;
    } catch (error) {
      const next = {
        ...detected,
        runtimeOk: false,
        runtimeError: error instanceof Error ? error.message : String(error)
      };
      setClaude(next);
      return next;
    }
  }

  useEffect(() => {
    // Show a Retry escape hatch after 10s if startup IPC is still hanging,
    // but DO NOT auto-clear loading — entering the app with empty React state
    // makes it look like data vanished even though SQLite is intact.
    const slowTimer = window.setTimeout(() => setLoadingSlow(true), 10000);
    Promise.all([refreshWorkspace(), detectClaude()])
      .then(async () => {
        try {
          const todayDate = new Date().toISOString().slice(0, 10);
          const status = await invoke<DailyBriefStatus>("get_today_brief_status", { localDate: todayDate });
          if (status?.shouldShow) setBriefStatus(status);
        } catch {
          /* swallow — daily brief is best-effort */
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        window.clearTimeout(slowTimer);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!loading && onboarding && !onboarding.completedAt) {
      setScreen("onboarding");
    } else if (!loading && onboarding?.completedAt && screen === "onboarding") {
      setScreen("command");
    }
  }, [loading, onboarding?.completedAt, screen]);

  // Once we have a deviceUserId, register with the connectors relay (idempotent).
  useEffect(() => {
    if (!RELAY_AVAILABLE) return;
    const id = workspace?.deviceUserId;
    if (!id) return;
    relay
      .register(id, workspace?.platform ?? "unknown", "0.1.0")
      .catch(() => undefined); // silent — relay availability is best-effort
  }, [workspace?.deviceUserId, workspace?.platform]);

  useEffect(() => {
    window.aios?.window?.onMaximizedChanged?.((next) => setMaximized(next));
  }, []);

  // Toggle body.window-hidden so all CSS animations pause when the window is
  // not visible (saves compositor work while the user is in another app).
  useEffect(() => {
    const sync = () => {
      document.body.classList.toggle("window-hidden", document.visibilityState !== "visible");
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshWorkspace().catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!window.aios?.onHostEvent) return () => undefined;
    return window.aios.onHostEvent((event) => {
      if (event.event === "auto_task_complete") {
        refreshWorkspace().catch(() => undefined);
      }
    });
  }, []);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const contextSections = useMemo(() => buildContextSections(context, recent), [context, recent]);
  const connections = useMemo<ConnectionStatus[]>(
    () => buildConnections(claude, modules, context, workspace),
    [claude, modules, context, workspace]
  );
  const activeModules = modules.filter((module) => module.installed).length;
  const workspaceReady = Boolean(workspace?.hasClaudeMd);
  const setupRequired = Boolean(onboarding && !onboarding.completedAt);
  const recentSessions = useMemo(
    () => sessions.filter((session) => session.messages.some((m) => m.content?.trim())).slice(0, 12),
    [sessions]
  );

  function displayTitle(session: ChatSession): string {
    const raw = (session.title || "").trim();
    const generic = !raw || raw.toLowerCase() === "new chat" || raw.toLowerCase() === "new thread" || raw.toLowerCase() === "main";
    if (!generic) return raw;
    const firstUser = session.messages.find((m) => m.role === "user" && m.content?.trim());
    if (firstUser) {
      const text = firstUser.content.trim().replace(/\s+/g, " ");
      return text.length > 48 ? `${text.slice(0, 47)}…` : text;
    }
    return raw || "New chat";
  }
  const currentTitle = {
    command: "Command",
    context: "Context",
    imports: "Imports",
    outputs: "Outputs",
    plans: "Plans",
    "auto-tasks": "Auto Tasks",
    modules: "Modules",
    connectors: "Connectors",
    briefs: "Daily briefs",
    history: "History",
    settings: "Settings",
    onboarding: "Welcome"
  }[screen];

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-card">
          <BrandMark size={48} variant="filled" />
          <div className="app-loading-copy">
            <strong>Loading <em>AIOS</em></strong>
            <p>{loadingSlow ? "This is taking longer than usual." : "Connecting workspace, Claude runtime, and threads."}</p>
          </div>
          <div className="app-loading-bar" aria-label="Loading">
            <span />
          </div>
          {loadingSlow ? (
            <button type="button" className="btn-pill-ghost" onClick={() => window.location.reload()}>
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${setupRequired ? "setup-required" : ""}`} data-screen={screen}>
      {!setupRequired ? (
      <aside className="app-sidebar aios-sb-v2">
        <div className="sidebar-brand">
          <BrandMark size={32} variant="filled" />
          <div className="brand-copy">
            <strong>AIOS</strong>
            <span>{workspaceReady ? "Local workspace" : "Setup required"}</span>
          </div>
        </div>

        <button
          className="sidebar-quick-action"
          type="button"
          onClick={async () => {
            try {
              const created = await invoke<ChatSession>("create_thread", { title: "New chat" });
              // Refetch the authoritative session list immediately so we don't
              // race with the 60s refreshWorkspace polling — otherwise an
              // in-flight refresh can overwrite the prepended thread and the
              // active id falls back to the previous session.
              const fresh = await invoke<ChatSession[]>("get_sessions");
              const merged = fresh.some((s) => s.id === created.id) ? fresh : [created, ...fresh];
              setSessions(merged);
              setActiveSessionId(created.id);
              setScreen("command");
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              setError(`Could not create new chat: ${message}`);
            }
          }}
        >
          <Plus />
          <span>New chat</span>
        </button>

        <nav className="sidebar-nav" aria-label="Primary">
          <NavItem icon={<MessageSquare />} label="Chat" active={screen === "command"} onClick={() => setScreen("command")} />
          <NavItem icon={<FileText />} label="Context" active={screen === "context"} onClick={() => setScreen("context")} />
          <NavItem icon={<Inbox />} label="Imports" active={screen === "imports"} onClick={() => setScreen("imports")} />
          <NavItem icon={<Boxes />} label="Modules" active={screen === "modules"} onClick={() => setScreen("modules")} />
          <NavItem icon={<Plug />} label="Connectors" active={screen === "connectors"} onClick={() => setScreen("connectors")} />
          <NavItem icon={<ClipboardList />} label="Plans" active={screen === "plans"} onClick={() => setScreen("plans")} />
          <NavItem icon={<FolderOpen />} label="Outputs" active={screen === "outputs"} onClick={() => setScreen("outputs")} />
          <NavItem icon={<Sun />} label="Brief" active={screen === "briefs"} onClick={() => setScreen("briefs")} />
        </nav>

        <section className="sidebar-group aios-recent-group">
          <button
            type="button"
            className="aios-recent-head"
            onClick={() => setScreen("history")}
            title="View all chats"
          >
            <Clock />
            <span>History</span>
          </button>
          <div className="aios-recent-list">
            {recentSessions.length === 0 ? (
              <p className="aios-recent-empty">No chats yet</p>
            ) : (
              recentSessions.map((session) => {
                const label = displayTitle(session);
                return (
                  <button
                    key={session.id}
                    className={`aios-recent-item ${activeSessionId === session.id ? "active" : ""}`}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setScreen("command");
                    }}
                    title={label}
                  >
                    {label}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <div className="aios-sidebar-footer">
          <button className="aios-sidebar-settings" type="button" onClick={() => setScreen("settings")} title="Settings">
            <Settings />
            <span>Settings</span>
          </button>
        </div>
      </aside>
      ) : null}

      <main className="app-main">
        <header className="topbar">
          <div className="windows-titlebar-left">
            <nav className="windows-menu-bar" aria-label="Application menu">
              <span>{currentTitle}</span>
            </nav>
          </div>

          <div className="topbar-status">

            {screen !== "command" && !setupRequired ? <StatusBadge tone={activeModules ? "neutral" : "warning"} label={`${activeModules} modules`} /> : null}
            {workspace?.platform !== "darwin" ? (
              <div className="window-controls" aria-label="Window controls">
                <button className="window-control" type="button" aria-label="Minimize window" onClick={() => window.aios?.window?.minimize()}>
                  <Minus />
                </button>
                <button className="window-control" type="button" aria-label={maximized ? "Restore window" : "Maximize window"} onClick={() => window.aios?.window?.maximize()}>
                  <Square />
                </button>
                <button className="window-control close" type="button" aria-label="Close window" onClick={() => window.aios?.window?.close()}>
                  <X />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {error ? <div className="banner banner-danger">{error}</div> : null}

        {screen === "command" && !setupRequired ? (
          <div className="screen-enter">
          <CommandScreen
            claude={claude}
            onboarding={onboarding}
            context={context}
            modules={modules}
            outputs={outputs}
            plans={plans}
            recent={recent}
            connections={connections}
            activeSession={activeSession}
            onDetectClaude={detectClaude}
            onSessionsChange={setSessions}
            onRefreshWorkspace={refreshWorkspace}
            onNavigate={setScreen}
          />
          </div>
        ) : null}

        {setupRequired ? (
          <div className="screen-enter">
          <OnboardingScreen
            state={onboarding}
            claude={claude}
            onRefreshWorkspace={refreshWorkspace}
            onClaudeChanged={detectClaude}
            onNavigate={(next) => setScreen(next)}
          />
          </div>
        ) : null}

        {screen === "context" && !setupRequired ? (
          <div className="screen-enter">
          <ContextScreen
            sections={contextSections}
            imports={context.imports}
            onRefresh={refreshWorkspace}
            onAskClaude={openInNewChat}
          />
          </div>
        ) : null}

        {screen === "outputs" && !setupRequired ? (
          <div className="screen-enter">
          <OutputsScreen
            outputs={outputs}
            shares={shares}
            onAskClaude={openInNewChat}
            onRefresh={refreshWorkspace}
          />
          </div>
        ) : null}

        {screen === "plans" && !setupRequired ? (
          <div className="screen-enter">
          <PlansScreen
            entries={plans}
            onAskClaude={openInNewChat}
            onRefresh={refreshWorkspace}
          />
          </div>
        ) : null}

        {screen === "auto-tasks" && !setupRequired ? (
          <div className="screen-enter">
          <AutoTasksScreen />
          </div>
        ) : null}

        {screen === "history" && !setupRequired ? (
          <div className="screen-enter">
          <HistoryScreen
            sessions={sessions}
            activeSessionId={activeSessionId}
            onOpenSession={(id) => {
              setActiveSessionId(id);
              setScreen("command");
            }}
            onSessionsChange={(updater) => {
              setSessions((current) => {
                const next = updater(current);
                if (activeSessionId && !next.find((s) => s.id === activeSessionId)) {
                  setActiveSessionId(next[0]?.id ?? null);
                }
                return next;
              });
            }}
          />
          </div>
        ) : null}

        {screen === "imports" && !setupRequired ? (
          <div className="screen-enter">
          <ImportsScreen
            onAskClaude={openInNewChat}
          />
          </div>
        ) : null}

        {screen === "modules" && !setupRequired ? (
          <div className="screen-enter">
          <ModulesScreen
            modules={modules}
            connections={connections}
            onChanged={refreshWorkspace}
            onAskClaude={openInNewChat}
            onNavigate={(target) => setScreen(target as Screen)}
          />
          </div>
        ) : null}
        {screen === "briefs" && !setupRequired ? (
          <div className="screen-enter">
            <BriefsScreen />
          </div>
        ) : null}
        {screen === "connectors" && !setupRequired ? (
          <div className="screen-enter">
            <ConnectorsScreen deviceUserId={workspace?.deviceUserId ?? ""} claude={claude} />
          </div>
        ) : null}
        {screen === "settings" && !setupRequired ? (
          <div className="screen-enter">
          <SettingsScreen
            claude={claude}
            workspace={workspace}
            onClaudeChanged={detectClaude}
            connections={connections}
            onOnboardingReset={async () => {
              await refreshWorkspace();
              setScreen("command");
            }}
          />
          </div>
        ) : null}
      </main>
      {briefStatus && !briefDismissed ? (
        <DailyBriefModal
          status={briefStatus}
          claude={claude}
          onAcknowledge={() => setBriefDismissed(true)}
          onOpenBriefsPage={() => {
            setBriefDismissed(true);
            setScreen("briefs");
          }}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

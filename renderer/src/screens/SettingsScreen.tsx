import React, { useEffect, useState } from "react";
import {
  Box,
  Check,
  ClipboardCopy,
  Cpu,
  ExternalLink,
  Info,
  Palette,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Terminal,
  Trash2
} from "lucide-react";
import { invoke } from "../lib/api";
import { PanelHeader, StatusBadge, ConfirmModal } from "../components/ui";
import type { ClaudeStatus, ConnectionStatus, WorkspaceInfo } from "../types";

type TabId = "general" | "claude" | "appearance" | "about";

export function SettingsScreen({
  claude,
  workspace,
  onClaudeChanged,
  connections,
  onOnboardingReset
}: {
  claude: ClaudeStatus | null;
  workspace: WorkspaceInfo | null;
  onClaudeChanged: () => Promise<ClaudeStatus>;
  connections: ConnectionStatus[];
  onOnboardingReset?: () => Promise<void> | void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("general");

  return (
    <section className="settings-screen">
      <div className="settings-shell">
        <aside className="settings-tabs" aria-label="Settings categories">
          <SettingsTab id="general" label="General" icon={<SlidersHorizontal size={15} />} active={activeTab} onSelect={setActiveTab} />
          <SettingsTab id="claude" label="Claude CLI" icon={<Terminal size={15} />} active={activeTab} onSelect={setActiveTab} />
          <SettingsTab id="appearance" label="Appearance" icon={<Palette size={15} />} active={activeTab} onSelect={setActiveTab} />
          <SettingsTab id="about" label="About" icon={<Info size={15} />} active={activeTab} onSelect={setActiveTab} />
        </aside>

        <div className="settings-content">
          {activeTab === "general" ? <GeneralPanel workspace={workspace} onOnboardingReset={onOnboardingReset} /> : null}
          {activeTab === "claude" ? <ClaudePanel claude={claude} workspace={workspace} onClaudeChanged={onClaudeChanged} connections={connections} /> : null}
          {activeTab === "appearance" ? <AppearancePanel /> : null}
          {activeTab === "about" ? <AboutPanel /> : null}
        </div>
      </div>
    </section>
  );
}

function SettingsTab({
  id,
  label,
  icon,
  active,
  onSelect
}: {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  active: TabId;
  onSelect: (next: TabId) => void;
}) {
  return (
    <button
      type="button"
      className={`settings-tab ${active === id ? "active" : ""}`}
      onClick={() => onSelect(id)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SettingsSection({
  eyebrow,
  title,
  detail,
  children,
  bare
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  children: React.ReactNode;
  bare?: boolean;
}) {
  return (
    <section className="settings-section">
      <PanelHeader eyebrow={eyebrow} title={title} detail={detail} />
      <div className={bare ? "settings-bare" : "settings-rows"}>{children}</div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  control
}: {
  title: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="settings-card-row">
      <div>
        <div className="settings-row-title">{title}</div>
        {description ? <div className="settings-row-desc">{description}</div> : null}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyable-code">
      <code>{value}</code>
      <button
        type="button"
        className="copyable-code-btn"
        title="Copy to clipboard"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          } catch { /* ignore */ }
        }}
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
      </button>
    </div>
  );
}

function GeneralPanel({
  workspace,
  onOnboardingReset
}: {
  workspace: WorkspaceInfo | null;
  onOnboardingReset?: () => Promise<void> | void;
}) {
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [updateState, setUpdateState] = useState<string>("idle");
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; percent?: number; message?: string; manualDownloadUrl?: string }>({});
  const [checking, setChecking] = useState(false);
  const [chatModel, setChatModel] = useState<string>("default");
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  // Read the running app version once. Drives the "App version X.Y.Z" line
  // so users always see what they're on, not just a generic "App version" label.
  useEffect(() => {
    window.aios?.getVersion?.()
      .then((v) => setCurrentVersion(v))
      .catch(() => setCurrentVersion(""));
  }, []);

  // Mirror of CHAT_MODELS in CommandScreen.tsx — keep these in sync.
  // The per-chat pill in the composer and this Settings tile read/write
  // the same chat_model setting, so picking here updates the pill and
  // vice versa.
  const chatModelOptions = [
    { value: "default", label: "Default",    description: "Use your Claude CLI default (currently Sonnet)." },
    { value: "haiku",   label: "Haiku 4.5",  description: "Fastest — best for simple questions and quick edits." },
    { value: "sonnet",  label: "Sonnet 4.6", description: "Balanced — the everyday workhorse." },
    { value: "opus",    label: "Opus 4.7",   description: "Smartest — slower, use for complex reasoning." }
  ];

  useEffect(() => {
    invoke<{ key: string; value: string | null }>("get_setting", { key: "chat_model" })
      .then((res) => { if (res?.value) setChatModel(res.value); })
      .catch(() => undefined);
  }, []);

  async function pickChatModel(value: string) {
    setChatModel(value);
    await invoke("set_setting", { key: "chat_model", value }).catch(() => undefined);
  }

  const [posthogKey, setPosthogKey] = useState<string>("");
  const [posthogKeySaved, setPosthogKeySaved] = useState<boolean>(false);
  const [posthogDraft, setPosthogDraft] = useState<string>("");
  useEffect(() => {
    invoke<{ key: string; value: string | null }>("get_setting", { key: "posthog_api_key" })
      .then((res) => {
        if (res?.value) {
          setPosthogKey(res.value);
          setPosthogDraft(res.value);
          setPosthogKeySaved(true);
        }
      })
      .catch(() => undefined);
  }, []);
  async function savePosthogKey() {
    const value = posthogDraft.trim();
    await invoke("set_setting", { key: "posthog_api_key", value }).catch(() => undefined);
    setPosthogKey(value);
    setPosthogKeySaved(true);
  }
  async function clearPosthogKey() {
    await invoke("set_setting", { key: "posthog_api_key", value: "" }).catch(() => undefined);
    setPosthogKey("");
    setPosthogDraft("");
    setPosthogKeySaved(false);
  }

  async function resetOnboarding() {
    setResetting(true);
    try {
      await invoke("reset_onboarding");
      await onOnboardingReset?.();
      setSavedHint("Onboarding restarted");
      window.setTimeout(() => setSavedHint(null), 2000);
    } catch (error) {
      setSavedHint(error instanceof Error ? error.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  const [confirmReset, setConfirmReset] = useState(false);
  function resetWorkspace() {
    setConfirmReset(true);
  }
  async function handleConfirmReset() {
    setConfirmReset(false);
    setWiping(true);
    try {
      await invoke("reset_workspace");
      // Reload so ensureRuntimeWorkspace re-copies a fresh starter kit and the
      // renderer re-reads onboarding/workspace state from scratch.
      window.location.reload();
    } catch (error) {
      setSavedHint(error instanceof Error ? error.message : "Workspace reset failed");
      setWiping(false);
    }
  }

  // Subscribe to update state pushes from main (download progress, etc).
  useEffect(() => {
    const unsubscribe = window.aios?.onUpdateState?.((event) => {
      setUpdateState(event.state);
      setUpdateInfo({
        version: event.version,
        percent: event.percent,
        message: event.message,
        manualDownloadUrl: event.manualDownloadUrl
      });
    });
    return () => unsubscribe?.();
  }, []);

  async function checkForUpdates() {
    setChecking(true);
    setUpdateState("checking");
    setUpdateInfo({});
    try {
      const result = await window.aios.checkForUpdates();
      if (!result.ok) {
        if (result.reason === "not-packaged") {
          setUpdateState("dev-mode");
        } else {
          setUpdateState("error");
          setUpdateInfo({ message: result.error || "Check failed" });
        }
      } else if (!result.hasUpdate) {
        setUpdateState("up-to-date");
        setUpdateInfo({ version: result.currentVersion });
        setLastCheckedAt(Date.now());
      } else if (result.manualDownloadUrl) {
        // Mac path: there's no in-place update, but a newer release exists.
        setUpdateState("manual-available");
        setUpdateInfo({
          version: result.latestVersion,
          manualDownloadUrl: result.manualDownloadUrl
        });
      }
      // else: "available"/"downloading"/"ready" arrives via onUpdateState (Win)
    } finally {
      setChecking(false);
    }
  }

  async function installNow() {
    // Mac (manual-available): open the release page in the system browser
    // since Mac builds aren't code-signed and electron-updater's in-place
    // swap fails ShipIt validation.
    if (updateInfo.manualDownloadUrl) {
      await window.aios.openExternal(updateInfo.manualDownloadUrl);
      return;
    }
    await window.aios.installUpdate();
  }

  function relativeTimeSince(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 5) return "just now";
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function updateLabel(): string {
    switch (updateState) {
      case "idle":
        return lastCheckedAt
          ? `Up to date · checked ${relativeTimeSince(lastCheckedAt)}`
          : "Click to check for a newer release";
      case "checking": return "Checking for updates…";
      case "available": return `Update v${updateInfo.version ?? ""} found — downloading in the background`;
      case "downloading": return `Downloading update… ${updateInfo.percent ?? 0}%`;
      case "ready": return `✓ Update v${updateInfo.version ?? ""} ready — click Restart & install to apply`;
      case "manual-available": return `Update v${updateInfo.version ?? ""} available — click Open release page`;
      case "up-to-date": return `✓ You're on the latest version${updateInfo.version ? ` (${updateInfo.version})` : ""}${lastCheckedAt ? ` — checked ${relativeTimeSince(lastCheckedAt)}` : ""}`;
      case "dev-mode": return "Auto-update only runs in installed builds (you're in dev mode)";
      case "error": return `× Check failed: ${updateInfo.message || "unknown error"}. Try again or check your connection.`;
      default: return "Click to check for a newer release";
    }
  }

  return (
    <>
      <SettingsSection eyebrow="Chat" title="Default model" detail="Pick which Claude model new chats use. Override per chat from the model pill in the composer.">
        <div className="theme-grid">
          {chatModelOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`theme-tile ${chatModel === option.value ? "active" : ""}`}
              onClick={() => pickChatModel(option.value)}
            >
              <div className="theme-tile-head">
                <strong>{option.label}</strong>
              </div>
              <p>{option.description}</p>
              {chatModel === option.value ? <Check size={14} className="theme-check" /> : null}
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection eyebrow="Workspace" title="General" detail="Paths and default behavior for your AIOS workspace.">
        <SettingsRow
          title="Workspace folder"
          description="Where AIOS stores context, plans, outputs, and threads on disk."
          control={<CopyableCode value={workspace?.workspaceRoot ?? "Unavailable"} />}
        />
        <SettingsRow
          title="Settings database"
          description="Local SQLite file holding your preferences, session metadata, and onboarding state."
          control={<CopyableCode value={workspace?.settingsDb ?? "Unavailable"} />}
        />
        <SettingsRow
          title="Reset onboarding"
          description="Re-run the welcome flow now. Existing context files are kept."
          control={
            <button type="button" className="button button-secondary compact" onClick={resetOnboarding} disabled={resetting}>
              <RotateCcw size={14} />
              {resetting ? "Resetting..." : "Reset"}
            </button>
          }
        />
        <SettingsRow
          title="Reset workspace"
          description="Erase ALL context, chats, plans, and outputs. Keeps Claude path and connectors. Use this for a truly fresh start."
          control={
            <button type="button" className="button button-secondary compact" onClick={resetWorkspace} disabled={wiping}>
              <Trash2 size={14} />
              {wiping ? "Erasing..." : "Erase data"}
            </button>
          }
        />
        {/* App version + Check for updates is shown on every desktop
            platform we ship signed installers for. Mac builds have been
            Developer-ID signed + notarized since v0.2.7 and v0.2.17
            enabled real in-place auto-update via electron-updater, so
            the "manual download" fallback (state === "manual-available")
            is only used if the API call errors. */}
        {(workspace?.platform === "win32" || workspace?.platform === "darwin") ? (
          <SettingsRow
            title={currentVersion ? `App version ${currentVersion}` : "App version"}
            description={updateLabel()}
            control={
              updateState === "ready" ? (
                <button type="button" className="button button-primary compact" onClick={installNow}>
                  Restart & install
                </button>
              ) : updateState === "manual-available" ? (
                <button type="button" className="button button-primary compact" onClick={installNow}>
                  <ExternalLink size={14} />
                  Open release page
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-secondary compact"
                  onClick={checkForUpdates}
                  disabled={checking || updateState === "checking" || updateState === "downloading" || updateState === "available"}
                >
                  <RotateCcw size={14} />
                  {checking || updateState === "checking" ? "Checking…" : "Check for updates"}
                </button>
              )
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        eyebrow="Analytics"
        title="Product analytics (PostHog)"
        detail="Optional. Paste a PostHog project key (starts with phc_) to send anonymous usage events: app launches, chat messages, connector adds, module installs. Disabled by default — no data is sent without a key. Reload the app after saving for events to start firing."
      >
        <SettingsRow
          title="PostHog project key"
          description={posthogKeySaved && posthogKey ? `Active — sending events to PostHog Cloud. Key: ${posthogKey.slice(0, 8)}…` : "No key set — analytics are off. Get one from app.posthog.com → Project settings."}
          control={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="password"
                value={posthogDraft}
                onChange={(e) => setPosthogDraft(e.target.value)}
                placeholder="phc_xxxxxxxxxxxxxxxxxxxxxxxx"
                style={{ width: 240, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-mono)" }}
              />
              <button type="button" className="button button-primary compact" onClick={savePosthogKey} disabled={!posthogDraft.trim() || posthogDraft.trim() === posthogKey}>Save</button>
              {posthogKeySaved ? (
                <button type="button" className="button button-secondary compact" onClick={clearPosthogKey}>Clear</button>
              ) : null}
            </div>
          }
        />
      </SettingsSection>

      {savedHint ? <div className="settings-toast">{savedHint}</div> : null}

      <ConfirmModal
        open={confirmReset}
        title="Erase workspace?"
        message="This wipes ALL context, chats, plans, and outputs. Claude path and connectors are kept. This can't be undone."
        confirmLabel="Erase data"
        danger
        onConfirm={handleConfirmReset}
        onCancel={() => setConfirmReset(false)}
      />
    </>
  );
}

function ClaudePanel({
  claude,
  workspace,
  onClaudeChanged,
  connections
}: {
  claude: ClaudeStatus | null;
  workspace: WorkspaceInfo | null;
  onClaudeChanged: () => Promise<ClaudeStatus>;
  connections: ConnectionStatus[];
}) {
  const [manualPath, setManualPath] = useState("");
  const [result, setResult] = useState<string | null>(null);

  return (
    <>
      <SettingsSection eyebrow="Runtime" title="Claude Code CLI" detail="The desktop app drives the real Claude executable on your machine.">
        <SettingsRow
          title="Status"
          description="Live connection state from the last detection or test."
          control={
            <StatusBadge
              tone={claude?.found && claude?.runtimeOk ? "success" : "warning"}
              label={claude?.found && claude?.runtimeOk ? "Connected" : "Needs attention"}
            />
          }
        />
        <SettingsRow
          title="Version"
          description="Detected Claude Code version."
          control={<strong className="settings-mono-value">{claude?.version ?? "Unavailable"}</strong>}
        />
        <SettingsRow
          title="Executable path"
          description="Path the desktop app is using to invoke Claude."
          control={<CopyableCode value={claude?.path ?? "Not configured"} />}
        />
        {claude?.runtimeError ? (
          <div className="settings-callout warning">{claude.runtimeError}</div>
        ) : null}
      </SettingsSection>

      <SettingsSection eyebrow="Actions" title="Detect & test" detail="Re-run detection or verify the connection without restarting the app." bare>
        <div className="button-row">
          <button
            type="button"
            className="button button-primary compact"
            onClick={async () => {
              const detected = await onClaudeChanged();
              setResult(detected.found ? `Detected ${detected.version ?? ""}`.trim() : detected.error ?? "Not found");
            }}
          >
            <RefreshCw size={14} />
            Auto-detect
          </button>
          <button
            type="button"
            className="button button-secondary compact"
            onClick={async () => {
              const response = await invoke<{ ok: boolean; version: string | null; error?: string }>("test_claude_connection");
              setResult(response.ok ? `Connection ok: ${response.version}` : response.error ?? "Connection failed");
            }}
          >
            <Terminal size={14} />
            Test
          </button>
        </div>
        <label className="field">
          Manual executable path
          <input
            value={manualPath}
            onChange={(event) => setManualPath(event.target.value)}
            placeholder={/^Mac/i.test(navigator.platform) ? "/opt/homebrew/bin/claude" : "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd"}
          />
        </label>
        <button
          type="button"
          className="button button-secondary compact"
          disabled={!manualPath.trim()}
          onClick={async () => {
            const response = await invoke<{ stored: boolean; version: string | null; error?: string }>("set_claude_path", { path: manualPath });
            setResult(response.stored ? `Saved: ${response.version}` : response.error ?? "Invalid Claude path");
            await onClaudeChanged();
          }}
        >
          Save manual path
        </button>
        {result ? (
          <div
            className={
              result.startsWith("Detected") || result.startsWith("Saved") || result.startsWith("Connection ok")
                ? "banner banner-success"
                : "banner banner-danger"
            }
          >
            {result}
          </div>
        ) : null}
      </SettingsSection>

      {connections.length ? (
        <SettingsSection eyebrow="Diagnostics" title="Connections" detail="Health of upstream pieces (workspace, modules, context).">
          {connections.map((connection) => (
            <SettingsRow
              key={connection.id}
              title={connection.label}
              description={connection.detail}
              control={
                <StatusBadge
                  tone={connection.status === "connected" ? "success" : connection.status === "warning" ? "warning" : "danger"}
                  label={connection.status}
                />
              }
            />
          ))}
        </SettingsSection>
      ) : null}

      {claude?.checked?.length ? (
        <SettingsSection eyebrow="Search paths" title="Detection candidates" detail={`Up to 8 paths the auto-detector checked.`} bare>
          <div className="detection-list">
            {claude.checked.slice(0, 8).map((item) => (
              <code key={item}>{item}</code>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection eyebrow="Storage" title="Local files" detail="Where this workspace lives on your machine.">
        <SettingsRow
          title="Workspace"
          description="Root directory holding your context, plans, outputs, and shares."
          control={<CopyableCode value={workspace?.workspaceRoot ?? "Unavailable"} />}
        />
        <SettingsRow
          title="Settings DB"
          description="Local SQLite file used by the desktop app."
          control={<CopyableCode value={workspace?.settingsDb ?? "Unavailable"} />}
        />
      </SettingsSection>
    </>
  );
}

function AppearancePanel() {
  const [theme, setTheme] = useState<string>("light");

  useEffect(() => {
    invoke<{ key: string; value: string | null }>("get_setting", { key: "theme" })
      .then((res) => { if (res?.value) setTheme(res.value); })
      .catch(() => undefined);
  }, []);

  async function pick(value: string) {
    setTheme(value);
    await invoke("set_setting", { key: "theme", value }).catch(() => undefined);
  }

  const options: Array<{ value: string; label: string; description: string; soon?: boolean }> = [
    { value: "light", label: "Light", description: "Default light theme tuned for daytime work." },
    { value: "auto", label: "Auto", description: "Match the system theme." },
    { value: "dark", label: "Dark", description: "High-contrast dark theme." }
  ];

  return (
    <SettingsSection eyebrow="Appearance" title="Theme" detail="Pick how AIOS looks. Switch between light, dark, or follow your system preference." bare>
      <div className="theme-grid">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`theme-tile ${theme === option.value ? "active" : ""} ${option.soon ? "muted" : ""}`}
            onClick={() => !option.soon && pick(option.value)}
            disabled={option.soon && option.value !== theme}
          >
            <div className="theme-tile-head">
              <strong>{option.label}</strong>
              {option.soon ? <span className="theme-soon">Coming soon</span> : null}
            </div>
            <p>{option.description}</p>
            {theme === option.value ? <Check size={14} className="theme-check" /> : null}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}

function AboutPanel() {
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    window.aios?.getVersion?.()
      .then((v) => { if (!cancelled) setVersion(v); })
      .catch(() => { if (!cancelled) setVersion("unknown"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <SettingsSection eyebrow="App" title="About AIOS Desktop" detail="The local AI command center for your business.">
      <SettingsRow
        title="Version"
        description="Currently installed AIOS Desktop release."
        control={<strong className="settings-mono-value">{version}</strong>}
      />
      <SettingsRow
        title="Runtime"
        description="Powered by the Claude Code CLI on your machine."
        control={
          <a className="settings-link" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
            <Cpu size={13} />
            Claude Code
            <ExternalLink size={12} />
          </a>
        }
      />
      <SettingsRow
        title="Modules"
        description="Browse the AIOS Operating System modules: Context, Data, Intel, Productivity, Infra, Daily Brief."
        control={
          <span className="settings-mono-value">
            <Box size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            6 modules available
          </span>
        }
      />
    </SettingsSection>
  );
}


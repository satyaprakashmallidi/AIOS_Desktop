# AIOS Desktop — Full Project Breakdown

> A complete reference of every layer, every page, every file, every connection — what it is, why it exists, how it talks to the rest of the system.
>
> Use this as a single source of truth when onboarding, debugging, or planning changes.

---

## Table of Contents

1. [What AIOS Desktop is](#1-what-aios-desktop-is)
2. [The four layers](#2-the-four-layers)
3. [Repository layout](#3-repository-layout)
4. [Electron main process — `main/`](#4-electron-main-process--main)
5. [Python sidecar — `python/`](#5-python-sidecar--python)
6. [Renderer (React + Vite) — `renderer/src/`](#6-renderer-react--vite--renderersrc)
7. [Every screen, page by page](#7-every-screen-page-by-page)
8. [Supabase backend (`supabase/`)](#8-supabase-backend-supabase)
9. [Composio + MCP integration](#9-composio--mcp-integration)
10. [Connectors deep dive](#10-connectors-deep-dive)
11. [Onboarding flow v2](#11-onboarding-flow-v2)
12. [Daily Brief](#12-daily-brief)
13. [Auto-tasks (in-app scheduler)](#13-auto-tasks-in-app-scheduler)
14. [Workspace data layout (end-user disk)](#14-workspace-data-layout-end-user-disk)
15. [SQLite schema](#15-sqlite-schema)
16. [IPC commands — full reference](#16-ipc-commands--full-reference)
17. [Design system & visual direction](#17-design-system--visual-direction)
18. [Build, packaging, releasing](#18-build-packaging-releasing)
19. [Auto-update flow](#19-auto-update-flow)
20. [Cross-platform (Mac vs Windows)](#20-cross-platform-mac-vs-windows)
21. [Performance discipline](#21-performance-discipline)
22. [What changed across the session — release-by-release](#22-what-changed-across-the-session--release-by-release)
23. [Critical bugs we fixed (and why)](#23-critical-bugs-we-fixed-and-why)
24. [Future work / known limitations](#24-future-work--known-limitations)

---

## 1. What AIOS Desktop is

AIOS Desktop is a local-first AI command center that ships to end users on Windows and macOS as a single installer.

**One install = one logical user.** A `device_user_id` UUID is generated client-side on first launch, persisted in local SQLite, and used as the bearer token for the (single) remote service AIOS talks to (a Supabase Edge Function relay). No accounts, no sign-up.

**The workhorse is Claude Code CLI.** AIOS does not ship its own model. It spawns the user's installed `claude` binary as a subprocess for every chat reply — streaming JSON-RPC events back into the UI in real time.

**The user owns their data.** Context files, plans, outputs, chat history, and a SQLite database all live on the user's disk under `%APPDATA%/aios-desktop/ai-sales-os/` (Win) or `~/Library/Application Support/aios-desktop/ai-sales-os/` (Mac). Nothing is uploaded.

**Connectors are out-of-band.** Gmail, Calendar, Slack, ClickUp, Notion, GitHub: each is connected once via an OAuth flow that goes through the Composio tool router (mediated by the Supabase relay). Once connected, Claude Code can read and act on those services from inside any chat — no copy-paste of API keys.

---

## 2. The four layers

```
┌────────────────────────────────────────────────────────────────────────┐
│  RENDERER  (React 19 + Vite)                                            │
│  renderer/src/                                                          │
│  • All UI: chat, connectors, context, modules, plans, etc.             │
│  • State lives in App.tsx; screens are composed children               │
│  • Talks to main via window.aios.invoke(cmd, args)                     │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ contextBridge → ipcRenderer.invoke("aios:invoke")
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  MAIN  (Electron + TypeScript)                                          │
│  main/                                                                  │
│  • Window lifecycle, OAuth window, system browser routing              │
│  • IPC allowlist (preload.ts) → either handles locally OR forwards     │
│    JSON-RPC to the Python sidecar                                      │
│  • Auto-update via electron-updater + GitHub Releases                  │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ JSON-RPC over stdio (newline-delimited JSON)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  PYTHON SIDECAR  (PyInstaller-bundled, no Python required at runtime)  │
│  python/host.py + workspace.py                                          │
│  • dispatch table for ~50 commands → workspace.py functions            │
│  • SQLite layer (data/settings.db)                                     │
│  • Spawns `claude --print --strict-mcp-config ...` for every reply     │
│  • Voice transcription (SpeechRecognition + Google STT)                │
│  • Threaded request handler (concurrent commands don't block each other)│
└────────────────────┬───────────────────────────────────────────────────┘
                     │ subprocess
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  CLAUDE CODE CLI                                                        │
│  • --strict-mcp-config so claude.ai-side connectors are ignored        │
│  • Sees only the per-user Composio MCP tool router                     │
└────────────────────────────────────────────────────────────────────────┘

  Out of band (only for connectors, not chat):
┌────────────────────────────────────────────────────────────────────────┐
│  SUPABASE EDGE FUNCTION RELAY  (supabase/functions/aios-relay)         │
│  • Holds the master Composio API key (desktop never sees it)           │
│  • Routes: /register, /connections, /:service/initiate, /mcp-config,   │
│    DELETE /:connectionId                                                │
│  • Auth: Bearer device_user_id                                          │
│                                                                         │
│  + composio-webhook receiver (HMAC-verified)                            │
│  + Postgres tables: device_users, device_connections                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Repository layout

```
aios-desktop-main/
├── main/                            # Electron main process (TypeScript → dist/main/)
│   ├── main.ts                      # Window, OAuth, autoUpdater, IPC dispatch
│   ├── preload.ts                   # contextBridge with command allowlist
│   ├── types.ts                     # AiosCommand union (mirror of renderer/src/types.ts)
│   ├── python-host.ts               # Spawns + pipes JSON-RPC to bundled or system Python
│   ├── claude-finder.ts             # Cross-platform `claude` executable detection
│   ├── workspace.ts                 # First-launch starter-kit copy → user data dir
│   ├── scheduler.ts                 # Auto-task tick loop (60s, runs due tasks)
│   └── logger.ts                    # JSON-line logs to <workspace>/logs/desktop.log
│
├── python/                          # Python sidecar (PyInstaller-bundled at ship)
│   ├── host.py                      # JSON-RPC dispatch + Claude subprocess + STT
│   ├── workspace.py                 # SQLite + filesystem + onboarding + briefs
│   └── requirements.txt             # SpeechRecognition>=3.10
│
├── renderer/                        # React 19 + Vite SPA (built to dist/renderer/)
│   ├── index.html                   # Loads Geist + Instrument Serif from Google Fonts
│   └── src/
│       ├── App.tsx                  # Top-level state, polling, splash, sidebar nav
│       ├── styles.css               # 6,689 lines — entire design system
│       ├── types.ts                 # AiosCommand mirror, AiosApi, all interfaces
│       ├── ui.ts                    # Screen + OnboardingState type aliases
│       ├── components/
│       │   ├── BrandMark.tsx        # Inline SVG italic A in dark circle
│       │   └── ui.tsx               # NavItem, StatusBadge, Surface, PanelHeader, etc.
│       ├── lib/
│       │   ├── api.ts               # invoke() wrapper around window.aios.invoke
│       │   ├── workspace-view.ts    # buildContextSections, buildConnections, formatRelativeTime
│       │   ├── aios-relay.ts        # Connectors relay client (register/list/initiate/disconnect)
│       │   └── onboarding.ts        # The 8 onboarding question objects
│       └── screens/
│           ├── CommandScreen.tsx    # The chat — voice, attachments, streaming, memoised md
│           ├── ConnectorsScreen.tsx # Connector cards, polling, identifyAccount
│           ├── OnboardingScreen.tsx # v2 welcome flow (Connect → Profile → Ready)
│           ├── ContextScreen.tsx    # Edit/preview the 4 context Markdown files
│           ├── ImportsScreen.tsx    # Folders + loose files (raw material for Claude)
│           ├── ModulesScreen.tsx    # The 6 OS modules (built-in + installable)
│           ├── PlansScreen.tsx      # Implementation plans + /create-plan, /implement
│           ├── OutputsScreen.tsx    # Generated work, categorised + previewable
│           ├── BriefsScreen.tsx     # History of daily briefs
│           ├── DailyBriefModal.tsx  # The morning brief popover
│           ├── AutoTasksScreen.tsx  # In-app scheduler UI
│           ├── HistoryScreen.tsx    # All chats, grouped by Today/This week/etc.
│           ├── SettingsScreen.tsx   # General / Claude / Appearance / About
│           └── WorkspaceFilesScreen.tsx  # Generic "list + preview" view (still wired but unused)
│
├── supabase/
│   ├── functions/
│   │   ├── aios-relay/index.ts          # Connectors relay (the only remote service we own)
│   │   └── composio-webhook/index.ts    # HMAC-verified status updates from Composio
│   └── migrations/
│       └── 0001_init.sql                # device_users + device_connections
│
├── aios-starter-kit/                # Template copied into user's workspace on first launch
│   ├── CLAUDE.md                    # Project-specific Claude instructions
│   ├── context/                     # 4 starter Markdown files (overwritten by onboarding)
│   ├── .claude/                     # Slash commands (/prime, /implement, /create-plan, /install, /share)
│   └── module-installs/             # InfraOS, DataOS, IntelOS, ProductivityOS, ContextOS, daily-brief
│
├── build/
│   ├── aios-host.spec               # PyInstaller spec (universal2 on Mac)
│   ├── icon.png                     # 1024×1024 app icon (electron-builder derives .ico/.icns)
│   └── entitlements.mac.plist       # Mac codesign entitlements (mic, network, JIT)
│
├── .github/workflows/
│   └── release.yml                  # Cross-platform CI: builds + uploads on tag push
│
├── assets/icon.png                  # In-app icon (smaller copy for renderer)
├── package.json                     # Scripts, deps, electron-builder config
├── vite.config.ts                   # Vite root = renderer, output = dist/renderer
├── tsconfig.main.json               # Compiles main/*.ts → dist/main/
├── tsconfig.renderer.json           # Type-checks renderer (Vite handles emit)
├── CLAUDE.md                        # Engineering reference (what onboarded YOU)
└── PROJECT_BREAKDOWN.md             # ← this file
```

---

## 4. Electron main process — `main/`

Compiled with `tsc -p tsconfig.main.json` to `dist/main/*.js`. Entry point: `dist/main/main.js`.

### `main/main.ts` (the orchestrator)

| Responsibility | How |
|---|---|
| Create the window | `BrowserWindow`, 1440×920, sandboxed, contextIsolation on, preload.js attached. On Mac: `titleBarStyle: "hiddenInset"` + traffic-light position. On Windows: chromeless `frame: false` + we render our own min/max/close buttons. |
| Window controls | `ipcMain.on("window:minimize" / "window:maximize" / "window:close")` mapped to `BrowserWindow` calls. |
| Open external URLs | `aios:open-external` IPC → `shell.openExternal` (filtered to http/https only). |
| OAuth window | `aios:open-oauth-window` opens an isolated `BrowserWindow` with a fresh session partition + cleared storage, AND injects `prompt=select_account` into Google OAuth URLs so the system can't silently auto-pick a cached account. (The Connectors page now uses the system browser by default — the OAuth window is kept as a fallback option.) |
| Claude detection | Forwards `find_claude` / `set_claude_path` / `test_claude_connection` to `claude-finder.ts`, persists results into Python sidecar's settings DB. |
| Reveal in OS file manager | `reveal_in_file_manager` → `shell.showItemInFolder` (with workspace-root sandbox check). |
| Auto-update | When `app.isPackaged`, wires `electron-updater`: `checking-for-update`, `update-available`, `download-progress`, `update-downloaded`, `error`. Each event is broadcast to the renderer via `aios:update-state`. |
| Manual update IPC | `aios:check-for-updates` (returns `{currentVersion, latestVersion, hasUpdate}`), `aios:install-update` (calls `quitAndInstall`). |
| Version IPC | `aios:get-version` returns `app.getVersion()` (so About panel shows the real version, not a hardcoded string). |
| Quit safety | `before-quit` event runs scheduler.stop() + host.stop() with a 1.5 s watchdog so a wedged Python sidecar can't keep the app from quitting. |
| Permissions | Mic permission auto-granted via `setPermissionRequestHandler` (so voice input doesn't prompt every session). |

### `main/preload.ts`

The contextBridge surface. Exposes `window.aios.invoke(cmd, args)` to the renderer, but only after checking `cmd` against an allowlist Set. **If you add a new IPC command, you MUST add it to four places:** `main/types.ts`, `main/preload.ts` (allowedCommands), `renderer/src/types.ts`, AND `python/host.py` (dispatch dict). Skipping any one yields silent failures.

Other exposed methods: `onHostEvent`, `openExternal`, `openOauthWindow`, `getVersion`, `checkForUpdates`, `installUpdate`, `onUpdateState`, plus a `window` namespace with minimize/maximize/close/onMaximizedChanged.

### `main/python-host.ts`

The bridge to the Python sidecar.

- **Find binary:** in packaged builds, looks for `process.resourcesPath/aios-host/aios-host(.exe)` (the PyInstaller bundle). In dev, falls back to system Python (`py -3` on Win, `python3` on Mac/Linux). Throws clearly if neither exists.
- **Spawn:** stdio piped, `AIOS_WORKSPACE_ROOT` env var set so the Python knows where the user's workspace lives.
- **JSON-RPC framing:** every request is `{id, cmd, args}\n`; responses are `{id, ok, data|error}\n`; events are `{id, event, data}\n`.
- **Pending map:** every in-flight call has an entry in `pending: Map<id, {resolve, reject, timeout}>`. Default timeout: 700 s (long-running Claude calls).
- **Event fan-out:** `eventHandlers` Set; when a `claude_stream` event lands, every subscriber gets it.

### `main/claude-finder.ts`

Cross-platform `claude` CLI detection.

**Search strategy:**
- Run `where claude` (Win) / `which claude` (Mac) first.
- Then check known install locations (npm-global, nvm, volta, Homebrew, system bin, AppData\Roaming\npm).
- Augments PATH with those locations before validation so the spawn doesn't fail just because the user's current shell hasn't been re-sourced.
- Final check: `execFile(candidate, ["--version"])` with an 8 s timeout. First non-zero-exit path is returned.

### `main/workspace.ts`

Resolves `~/Library/Application Support/aios-desktop/ai-sales-os/` (Mac) or `%APPDATA%/aios-desktop/ai-sales-os/` (Win). On first launch (when `CLAUDE.md` is missing), copies the entire `aios-starter-kit/` template into the workspace using a clean recursive copy that skips `.DS_Store` and `__MACOSX`. Resolves `aios-starter-kit/` relative to `app.getAppPath()` so it works in both dev and packaged builds (`<install>/resources/aios-starter-kit/`).

### `main/scheduler.ts`

A 60-second tick loop that polls Python's `list_due_auto_tasks` and runs anything that's due. Runs are bracketed by `begin_auto_task_run` / `finish_auto_task_run` for status tracking, and the result is written to `outputs/auto-tasks/<slug>-<stamp>.md` via `write_file`. After each run, `advance_auto_task` recomputes the next-run timestamp.

### `main/logger.ts`

Newline-delimited JSON logs to `<workspace>/logs/desktop.log`. Lines look like `{"ts":"...","scope":"main.ipc","message":"command failed","meta":{...}}`. Every error path in main flushes through here.

---

## 5. Python sidecar — `python/`

Two files. Bundled into a single PyInstaller `aios-host(.exe)` binary at ship time so end users don't need Python installed.

### `python/host.py`

The JSON-RPC server.

**Lifecycle:**
1. `main()` opens a database connection (forces schema migration to run early so failures are visible).
2. Reads stdin line-by-line; spawns a daemon thread per request.
3. `_handle_request(line)` parses the JSON, dispatches via `dispatch(cmd, args)`, and writes the response.

**The `_STDOUT_LOCK`:** with concurrent threads writing replies, two interleaved JSON lines would corrupt the framing. Every `print` of a response or event is wrapped in this `threading.Lock` so writes are atomic. **This was the fix for the v0.1.6 "second click stalls forever" bug** — under serial dispatch, a single 25-second Claude task froze every other IPC request behind it.

**Claude subprocess (`run_claude`):**
- Uses `--print --strict-mcp-config --mcp-config '<inline JSON>'` for every call.
- The inline MCP config contains ONLY the Composio entry pulled from `~/.claude/settings.json` — this hides claude.ai's first-party connectors from Claude entirely. Without this, a user whose Anthropic account has Gmail linked to a different address gets cross-wired data when they ask about their inbox.
- Streaming mode (`stream-json` + `--include-partial-messages`) emits `claude_stream` events back to the renderer with deltas, tool uses, and tool results.
- Appends a `_COMPOSIO_SYSTEM_PROMPT` that instructs Claude how to use the meta-tools (`COMPOSIO_SEARCH_TOOLS` + `COMPOSIO_MULTI_EXECUTE_TOOL`) AND what NOT to do (never mention Composio/MCP, never invent OAuth links, never compare the user's Anthropic email with connected service accounts).

**Voice transcription (`transcribe_audio`):**
- Accepts a base64-encoded WAV.
- Uses `speech_recognition` to call Google's free speech endpoint (no API key).
- Falls back to local sphinx if requested.
- Returns `{text, engine}`.

**The dispatch table** (`host.py:dispatch`) maps ~50 string commands to handler lambdas/functions. See `IPC commands — full reference` later in this doc for the complete list.

### `python/workspace.py`

Everything backed by SQLite + the filesystem.

**Workspace root resolution:** uses the `AIOS_WORKSPACE_ROOT` env var that main passes in (set to the user-data path).

**SQLite tables** (created by `ensure_schema`):
- `settings` — generic key/value (claude_path, claude_version, theme, anthropic_api_key, connector_label_<service>, etc.)
- `app_state` — separate key/value for app-level state (device_user_id, first_install_date, last_brief_seen_date)
- `onboarding` — single row, holds current step + answers blob + completed_at
- `modules` — installed modules registry
- `sessions` — chat threads (id, title, messages JSON, updated_at, claude_session_id)
- `auto_tasks` + `auto_task_runs` — the in-app scheduler
- `daily_briefs` — generated morning briefs

**Module registry** (`MODULE_REGISTRY` dict): six modules, each with phase, capability, requires (deps), artifacts (paths it adds), connections, and `installedMarkers` (paths whose existence proves it's installed). Two modules are `alwaysInstalled` + `builtIn`: ContextOS (the Context page IS the install) and Daily Brief (lives on the Brief page).

**Onboarding writers (`write_context_files`):** maps the 8 question IDs into 4 grouped Markdown files (`personal-info.md`, `business-info.md`, `strategy.md`, `current-data.md`) plus a derived `funnel.md`. Each file gets a heading, an `Updated:` timestamp, and one `## label` block per question.

**MCP isolation helpers:**
- `claude_settings_path()` — returns `~/.claude/settings.json` (uses `Path.home()` so Win/Mac both work).
- `update_claude_mcp_config(name, config)` — merges a single MCP server entry into Claude's settings.json (or removes it if config is None). Used by ConnectorsScreen after each successful connect/disconnect.

**Device user ID:**
- `get_or_create_device_user_id()` — UUID4 generated once and persisted in `app_state`. Used as the bearer token for the Supabase relay AND as the Composio entity_id. Never rotated automatically.
- `rotate_device_user_id()` — emergency reset: when a Composio session is bound to a stale OAuth token and Composio offers no refresh API, blowing the user_id forces a fresh entity, fresh session, fresh OAuth flow.

**Daily brief prompt builder (`build_daily_brief_prompt`):** generates the prompt body Claude answers each morning. Tells Claude to read `context/business-info.md`, `context/strategy.md`, `plans/`, `outputs/`, `gtd/`, then respond in a strict format: `## headline`, `**Focus today**` bullets, `**Worth a glance**` bullets, under 200 words, calm tone.

**Mojibake repair (`repair_text_encoding`):** old chat JSON sometimes had double-encoded UTF-8 (cp1252 → utf-8 → cp1252). When loading sessions, this function walks every string and reverses the damage. Includes special-case replacements for the most common em-dash / quote corruptions.

---

## 6. Renderer (React + Vite) — `renderer/src/`

Vite roots the project at `renderer/`, builds to `dist/renderer/`. Entry point: `src/App.tsx`. Single SPA, no router — the active screen is just a `useState<Screen>` enum, and the App component renders the right child.

### `App.tsx` (the orchestrator)

State held at the top level (passed down via props):
- `workspace` (workspaceRoot, hasClaudeMd, platform, settingsDb, modules, deviceUserId)
- `claude` (found, path, version, runtimeOk, runtimeError)
- `onboarding` (currentStep, answers, completedAt)
- `modules`, `context`, `recent`, `outputs`, `plans`, `shares`
- `sessions` (the chat threads), `activeSessionId`
- `briefStatus` + `briefDismissed` (for the morning popover)

**Lifecycle effects:**
1. **Splash → app:** `Promise.all([refreshWorkspace(), detectClaude()])` resolves, then check today's daily-brief status. If startup IPC takes >10s, show a "Retry" button (data is always safe in SQLite — auto-clearing was worse than the hang).
2. **Onboarding routing:** if `onboarding.completedAt` is null, force-route to the Onboarding screen. When complete, route back to Command.
3. **Relay register:** once `deviceUserId` is loaded, idempotently register with the Supabase relay (best-effort, swallow errors).
4. **Background connector identify:** for any service with a `connected` status and no stored `connector_label_<service>`, fire a Claude task to identify the account. Runs ONCE per app session (not per page mount), with at most 2 concurrent identify tasks (memory + network throttling). Idempotent — second app launch sees stored labels and skips entirely.
5. **Visibility-gated polling:** `setInterval(refreshWorkspace, 60000)` with `if (document.visibilityState !== "visible") return;` at the top.
6. **Animation pause:** toggles `body.window-hidden` on visibilitychange. CSS rule pauses every animation when hidden.
7. **Window maximized:** subscribes to `onMaximizedChanged` so we can render the right icon.

**Sidebar nav (`aios-sb-v2`):** AIOS brand mark + "New chat" pill + 8 nav items (Chat, Context, Imports, Modules, Connectors, Plans, Outputs, Brief) + History group with last 12 chats + Settings footer.

### `lib/api.ts`

Thin wrapper around `window.aios.invoke`. Throws on `!response.ok`. Includes a `mockInvoke` fallback for browser-preview testing (no Electron).

### `lib/aios-relay.ts`

Connectors relay client. Hardcoded `DEFAULT_RELAY_URL = "https://cnvimnicyeljkihbjztv.supabase.co/functions/v1/aios-relay"` (the URL itself isn't a secret — auth is per-user device IDs). Can be overridden at build-time with `VITE_AIOS_RELAY_URL`.

Methods: `register`, `listConnections`, `initiate`, `disconnect`, `getMcpConfig`. Every call sends `Authorization: Bearer <deviceUserId>`.

### `lib/workspace-view.ts`

Pure helpers:
- `buildContextSections` — groups context files into 4 sections for the Context page.
- `buildConnections` — synthesises a `ConnectionStatus[]` from claude/modules/context/workspace state for the Settings → Diagnostics panel and the Modules connections strip.
- `formatRelativeTime` — Intl-formatted "Mar 14, 2:30 PM" timestamps used throughout.

### `components/BrandMark.tsx`

The AIOS logo: an italic Instrument Serif "A" inside an ink-filled circle, with optional sage live-dot at lower-right. Used in the sidebar, the splash screen, and the chat empty state. SVG inline so it scales perfectly + theme variables work.

### `components/ui.tsx`

Shared primitives: `WindowControls`, `NavItem`, `StatusBadge`, `Surface`, `PanelHeader`, `MetricCard`, `EmptyState`, `FileRow`, `ToastContainer`. Most screens import `PanelHeader`, `StatusBadge`, `EmptyState`.

### `lib/onboarding.ts`

The 8 onboarding questions, grouped into 4 layers:
- **Identity** — role, six_month_goal
- **Business Model** — offer, revenue_model
- **Priorities** — north_star_metric, hidden_blocker
- **Data** — payments, extra_context

### `types.ts`

Mirrors `main/types.ts` for `AiosCommand`. Adds rich domain interfaces: `WorkspaceInfo`, `ClaudeStatus`, `ChatSession`, `ChatMessage`, `ModuleInfo`, `ConnectionStatus`, `WorkspaceEntry`, `DailyBrief`, `AutoTask`, `AutoTaskRun`, `ContextSummary`, `ContextSection`, `ClaudeStreamEvent`, etc. Also declares `window.aios: AiosApi` globally.

### `ui.ts`

Just two type aliases: `Screen` (union of all screen names) and `OnboardingState`.

---

## 7. Every screen, page by page

### 7.1 Command (chat) — `screens/CommandScreen.tsx`

The headline feature. ChatGPT-style chat interface backed by Claude Code CLI.

**Empty state:** centered orb (italic A) + "What should we _work on_?" + 4 starter prompt chips (`/prime`, "Review my AIOS context", "Find the best next action", "Create a plan").

**Composer:**
- Textarea (Enter sends, Shift+Enter newline).
- "Sources" button: file picker → uploads to `imports/chat-<stamp>-<safename>` via `write_binary_file`, attached to the next message as a markdown block listing paths.
- Mic button: toggles voice input. Uses `getUserMedia` + Web Audio + `ScriptProcessorNode` to capture raw PCM. Every 3.5 s mid-recording, a partial WAV is sent to `transcribe_audio` for live captions. On stop, a final accurate pass is run on the full recording.
- Send button → `sendPrompt(text)`.

**Sending a prompt:**
1. Optimistically appends a user message + an empty assistant placeholder to the active session.
2. Generates a `streamId` (so the host event handler knows which messages to update).
3. Calls `run_task` (or `run_prime` if the prompt is `/prime`) with `{prompt, claudePath, streamId, sessionId}`. The session ID lets Claude resume the prior context.
4. Listens for `aios:host-event` → `claude_stream` events. Each delta is appended to the assistant message in place. Tool uses surface as activity strips ("Reading a file", "Searching the web", etc., translated from raw tool names by `friendlyActivityLabel`).
5. Final response replaces the message content; runtime metadata (sessionId, durationMs, costUsd) is stored.
6. The session is persisted via `save_session`.

**Markdown rendering:** `MessageMarkdown` is `React.memo`-wrapped around `ReactMarkdown` with `remark-gfm`. The components map and plugins array are module-level constants — passing fresh object references would defeat memoization on every render. Code blocks use a `CodeBlock` component (also memoized) with a copy button.

**History clamp:** by default only the last 6 messages render. A "Show N earlier messages" button reveals the rest. Long assistant messages older than the last two are visually clamped via a `message-clamped` class.

### 7.2 Connectors — `screens/ConnectorsScreen.tsx`

Six service cards (Gmail, Calendar, Slack, ClickUp, Notion, GitHub). Each card shows status pill + connect/disconnect button + identified account label.

**Connect flow:**
1. Click "Connect Gmail" → `relay.initiate(deviceUserId, "gmail")` → returns `{redirectUrl, connectionId}`.
2. Open the URL in the system browser (`window.aios.openExternal`).
3. Start polling `relay.listConnections` every 1.5 s for 90 s.
4. When the row flips to `connected`, push the MCP config to Claude's `settings.json` via `update_claude_mcp` AND fire an identify task (a Claude prompt that uses Gmail tools to fetch one email's "From:" header and extract the account email).
5. Store the identified label in SQLite as `connector_label_<service>`.

**Stalled state:** if 90 s passes without a `connected` status, the card shows "No response — try again" with Cancel + Retry buttons.

**Cancel guard:** before deleting a "stalled" connection, refetch live status. If it actually went through (poll timed out but OAuth completed late), bail out instead of nuking the working connection.

**Disconnect:** optimistically clears the card immediately, then `relay.disconnect`, then refresh. If no connections remain, also remove the `composio` entry from Claude's `settings.json` so the next chat doesn't try to talk to a dead tool router.

**MCP sync (`syncMcpToClaude`):** every time we observe any connected service, refetch the MCP URL from `relay.getMcpConfig` and push it to Claude. Composio's `composio.create(userId)` may return a fresh session URL tied to the latest tokens; if we don't re-fetch, Claude can end up pointed at a stale session bound to an old/wrong OAuth account.

### 7.3 Onboarding v2 — `screens/OnboardingScreen.tsx`

Three stages, full editorial design (Sana × ChatGPT direction).

**Stage 1: Connect.** Asks the user to verify Claude Code is installed.
- Auto-detect button → `find_claude` → reports "Detected Claude Code 2.x".
- Manual path input + Save.
- Test button → `test_claude_connection`.
- Skip for now (proceeds without Claude — useful for trying the UI).
- Continue (only enabled when Claude is connected).

**Stage 2: Profile.** Eight questions across four layers. Single textarea per question. Layer pills at the top show progress (`2/2`) and unlock progressively. Back/Skip/Next buttons. Enter submits.

When all 8 are answered, `complete_onboarding` is called with the merged answers. Python writes the four context files to disk.

**Stage 3: Ready.** Summary card with three checked rows (Claude connection, Profile context, Workspace files). "Start using AIOS" button completes onboarding and routes to Command.

### 7.4 Context — `screens/ContextScreen.tsx`

Edit/preview the four core Markdown files Claude reads on every `/prime`. Tab strip at the top picks a file. Each file has Preview/Edit toggle, Save button, "Restore template" button (re-copies from `aios-starter-kit/context/<name>.md`), "Ask Claude" button (asks Claude to suggest a cleaner version).

### 7.5 Imports — `screens/ImportsScreen.tsx`

Folders + loose files. Drag-and-drop or file picker. Text files (md/csv/json/etc.) go through `write_file`; binaries through `write_binary_file` (base64 round-trip). Folder modal shows files inside, supports per-file delete, "Ask Claude about this folder" CTA.

Stored at `context/import/` in the workspace.

### 7.6 Modules — `screens/ModulesScreen.tsx`

Lists all 6 OS modules. Each row shows phase number, name, description, status pill (Built in / Installed / Ready / Locked / Source missing), required deps, and an Install/Reinstall/Open button.

Built-in modules (ContextOS, Daily Brief) have an "Open" button that navigates to the corresponding page.

Installable modules have an "Install" button that asks Claude `/install <path>`. The slash command is defined in `aios-starter-kit/.claude/commands/install.md`.

Recommended next: the lowest-phase uninstalled module whose deps are met is highlighted at the top.

Bottom panel: workspace readiness diagnostics (Claude CLI / Core context / Imports / Modules / Workspace health).

### 7.7 Plans — `screens/PlansScreen.tsx`

Implementation plans created via `/create-plan` and run via `/implement` (slash commands defined in `aios-starter-kit/.claude/commands/`). UI is a textarea ("Describe a plan") + grid of plan cards. Each card has Implement button + Reveal-in-finder + Delete. Click a card to open a full-screen modal preview with all-Markdown rendering.

### 7.8 Outputs — `screens/OutputsScreen.tsx`

Everything Claude or modules produce. Filter pills: All / Auto Tasks / Data / Intel / Shares / Other. Recent auto-task runs strip at top (chips with status colors). Card grid below. Modal preview for Markdown-ish files. Daily briefs are filtered out (they live on Brief page).

### 7.9 Daily briefs — `screens/BriefsScreen.tsx`

History of all morning briefs, grouped This week / Last week / Earlier. Date chip on each card (Mar 14). Click → modal with full Markdown.

### 7.10 Daily Brief Modal — `screens/DailyBriefModal.tsx`

The morning popover. Shown at most once per day (after first install date). Generates the brief on first open via `generate_daily_brief`, or shows the saved one if already run today. "I've read it · start my day" acknowledges (sets `last_brief_seen_date`). "View past briefs" navigates to the Briefs screen.

### 7.11 Auto Tasks — `screens/AutoTasksScreen.tsx`

In-app scheduler. Form to create a task (name, prompt, schedule preset). List of tasks with toggle, run-now, delete, and a recent-runs accordion (status pill, time, cost, link to output). Refreshes every 60 s.

### 7.12 History — `screens/HistoryScreen.tsx`

All chats. Search box (filters by title or any message content). Grouped Today / Yesterday / Previous 7 days / Previous 30 days / Older. Each row shows title (or first user message if generic title), preview (last message), time, message count, and a "memory" pill if there's a `claudeSessionId` (Claude can resume).

Per-row delete button.

### 7.13 Settings — `screens/SettingsScreen.tsx`

Four tabs:
- **General** — Workspace folder + DB path (copyable code), Reset onboarding button, Check for updates button (with live progress states from `onUpdateState`).
- **Claude CLI** — Status badge, version, executable path, runtimeError; Auto-detect / Test / manual path; connection diagnostics; up to 8 detection candidate paths.
- **Appearance** — Light (active) / Auto / Dark (both Coming soon). Persisted to `theme` setting.
- **About** — Live app version (via `getVersion()` IPC, NOT hardcoded), runtime info, link to claude.com/claude-code, modules count.

### 7.14 WorkspaceFilesScreen.tsx

A generic two-column "list + preview" layout. Wired but no longer routed to (Outputs / Plans / Context replaced it with custom layouts). Kept for potential reuse.

---

## 8. Supabase backend (`supabase/`)

### `aios-relay/index.ts` — the relay (Edge Function, Deno)

The only remote service AIOS owns. Runs at `https://cnvimnicyeljkihbjztv.supabase.co/functions/v1/aios-relay`.

**Why it exists:** the master Composio API key can't ship in a desktop app — anyone could pull it from the binary. The relay holds it server-side; the desktop authenticates with its `device_user_id` UUID (which is also the Composio entity_id, scoping all operations).

**Routes:**

| Method | Path | Handler | What it does |
|---|---|---|---|
| POST | `/register` | `handleRegister` | Idempotent. Inserts a `device_users` row (or updates `last_seen_at`). Returns `{entityId, alreadyRegistered}`. |
| GET | `/connections` | `handleListConnections` | Returns mirror of `device_connections`. For any `pending` rows, fetches the Composio connected_account by ID and flips status to `connected` if Composio reports it active. Per-row probes run in `Promise.allSettled` — sequential awaits made the endpoint block on the slowest call. |
| POST | `/connections/:service/initiate` | `handleInitiate` | Reads `COMPOSIO_AUTH_<SERVICE>` env var → calls `POST /api/v3/connected_accounts` with `{auth_config:{id}, connection:{user_id}}` → upserts a `device_connections` row with status `pending` → returns `{redirectUrl, connectionId}`. |
| DELETE | `/connections/:connectionId` | `handleDisconnect` | Best-effort calls Composio DELETE; ALWAYS removes the local DB row. (If Composio 5xxs we still want our DB to reflect the disconnect — otherwise the card is stuck "Connected" with no escape.) |
| GET | `/mcp-config` | `handleMcpConfig` | Imports `npm:@composio/core` dynamically, calls `composio.create(deviceUserId)`, returns `{mcp, session, label}`. The `mcp` block is what gets dropped into Claude's `settings.json`. |

**Auth:** every call requires `Authorization: Bearer <UUID>`. The bearer is matched against `device_users.device_user_id` to scope queries.

### `composio-webhook/index.ts` — webhook receiver

HMAC-verified (uses `COMPOSIO_WEBHOOK_SECRET`). Subscribes to two Composio v3 events:
- `composio.connected_account.expired` → marks our row as `expired`.
- `composio.trigger.disabled` → marks as `error`.

OAuth completion is NOT a webhook event in Composio v3 — the desktop polls `/connections` to detect that.

### `migrations/0001_init.sql`

Two tables:

```sql
device_users (
  id uuid pk default gen_random_uuid(),
  device_user_id uuid unique not null,
  composio_entity_id text unique not null,
  os text, app_version text,
  created_at timestamptz, last_seen_at timestamptz
);

device_connections (
  id uuid pk default gen_random_uuid(),
  device_user_id uuid fk → device_users(device_user_id) on delete cascade,
  service text not null,
  composio_connection_id text unique not null,
  status text default 'pending',  -- 'pending' | 'connected' | 'expired' | 'error'
  account_label text,
  connected_at timestamptz, last_used_at timestamptz,
  metadata jsonb,
  unique (device_user_id, service)
);
```

RLS is enabled with no policies — only the Edge Functions (using the service role key) read/write. The desktop never talks to Postgres directly.

---

## 9. Composio + MCP integration

### What Composio provides

A "tool router" — a single MCP endpoint that, behind the scenes, is connected to dozens of services (Gmail, Slack, ClickUp, etc.). The router exposes two meta-tools:
- `COMPOSIO_SEARCH_TOOLS(query)` — finds the right tool slug
- `COMPOSIO_MULTI_EXECUTE_TOOL(slug, params)` — actually calls it

Each user gets their own per-user tool router URL (with embedded auth) when we call `composio.create(userId)`.

### The auth_config quirk

Composio toolkits expose two kinds of auth configs:
- **Tool-router-enabled** (`is_enabled_for_tool_router: true`) — visible to the MCP tool router; Claude can use these connections.
- **Custom / dashboard-created** (`is_enabled_for_tool_router: false`) — invisible to MCP; connections made through these effectively don't exist for Claude.

We hit this hard for Gmail. The user-created auth config in the dashboard was the wrong kind, so every connection appeared to bind to a different (tradephani@gmail.com) Gmail account because Composio's tool router could only see its OWN auto-default config (which had a stale connection).

### Adding a new connector — the recipe

For every new service:

1. `POST /api/v3/auth_configs` with `{toolkit:{slug:<svc>}, auth_config:{type:"use_composio_managed_auth", name:"<svc>-default"}}`.
2. `PATCH /api/v3/auth_configs/<ac_id>` with `{type:"default", is_enabled_for_tool_router:true}`.
3. `npx supabase secrets set COMPOSIO_AUTH_<SERVICE_UPPER>=ac_xxx`.
4. `npx supabase functions deploy aios-relay --no-verify-jwt`.
5. Add the entry to `CONNECTOR_CATALOG` in `ConnectorsScreen.tsx`.
6. Add a service-specific identify prompt under `prompts` in `identifyAccount()` AND in `App.tsx::identifyPromptFor` (for the App-level background identifier).

Service slug → env var mapping: `service.toUpperCase().replace(/-/g, "_")` → `COMPOSIO_AUTH_<X>`. So `google-calendar` → `COMPOSIO_AUTH_GOOGLE_CALENDAR`.

### Currently wired connectors

| Service | Auth config | Slug | Used by |
|---|---|---|---|
| Gmail | `ac_y-OIEuSxFKkE` | `gmail` | — |
| Google Calendar | `ac_cpWhovJpJ3kR` | `google-calendar` | — |
| Slack | `ac_jFwxYiIjQlUQ` | `slack` | IntelOS |
| ClickUp | `ac_Aje5GIG8qKi6` | `clickup` | — |
| Notion | `ac_EwoOuiTf19rs` | `notion` | — |
| GitHub | `ac_JEd7dBt0V4CU` | `github` | InfraOS |
| Stripe | `ac_lreLxEiFkTlp` | `stripe` | DataOS |
| YouTube | `ac_DRbRugQFigNA` | `youtube` | DataOS |
| Google Analytics | `ac_WOs6TpNhcvC-` | `google-analytics` | DataOS |
| Google Sheets | `ac_289PHe7QdUXw` | `google-sheets` | DataOS |

All 10 have `is_enabled_for_tool_router: true` + corresponding `COMPOSIO_AUTH_<SLUG>` secrets in Supabase. Same code path for all — no per-service handlers.

### MCP isolation in `python/host.py`

`_mcp_isolation_flags()` reads `~/.claude/settings.json`, extracts the `composio` MCP server entry, and passes it inline as `--strict-mcp-config --mcp-config '<JSON>'` on every `claude --print` invocation. This means:
- claude.ai-side connectors authorized via the user's Anthropic account are completely hidden.
- Only the per-user Composio tool router is visible.
- Without this, a user whose Anthropic account has Gmail linked to a different address gets cross-wired data.

### The Composio system prompt

`_COMPOSIO_SYSTEM_PROMPT` is appended to every Claude call via `--append-system-prompt`. It instructs Claude:
- Use the meta-tools to discover and execute tool calls.
- **Never** mention Composio, MCP, tool routers, slugs, or infrastructure.
- **Never** describe what tool was used to get the data.
- **Never** invent OAuth URLs / quick-connect links / `lk_` codes (we hit a bug where Claude offered these in chat and re-bound the wrong account when users clicked them).
- **Never** mention the user's Anthropic login email or compare it with connected service accounts (Claude Code surfaces `oauthAccount.emailAddress` from `~/.claude.json`; left unchecked it'd say "you're connected as X but your Claude account is Y").
- **Never** preface answers with "Using Gmail tools…" or "I'll fetch…".

---

## 10. Connectors deep dive

(See section 7.2 for the screen layer and section 8 for the relay layer.)

### Identify-account prompts

For each service, we need to know which email the OAuth was authorized as. Composio's REST API redacts every identifying field, so we ask Claude — which has the Gmail/Calendar/etc. MCP tools loaded — to fetch one piece of data and extract the email.

Per-service prompt structure (see `App.tsx::identifyPromptFor` and `ConnectorsScreen.tsx::identifyAccount`):
- **Gmail:** fetch one `in:sent` email, read `From:` header. Fallback: `newer_than:30d` → `Delivered-To:`. **Don't use `To:`** (forwarded mail can be addressed to other emails).
- **Google Calendar:** list calendars, find primary, return its `id`.
- **Slack:** fetch authenticated user profile.
- **ClickUp:** fetch authenticated user.
- **Notion:** fetch user/bot, look for `owner.email` or workspace name.
- **GitHub:** `GITHUB_GET_THE_AUTHENTICATED_USER` → email or `@login`.

Result is parsed with two regexes (email, then handle), stored as `connector_label_<service>` in SQLite, and shown as the card subtitle.

### Two identify entry points

1. **Connectors page (`identifyAccount`)** — fires immediately when a connection lands, OR on first visit if a connection exists without a stored label.
2. **App-level background identify (`App.tsx`)** — runs ONCE per app session for any connected service without a stored label. Throttled to 2 concurrent, idempotent across launches. Means the Connectors page already has labels even if the user hasn't visited it yet.

### Why the system browser (not embedded)

The original implementation used an embedded Electron BrowserWindow with cleared cookies, on the theory that it would prevent cached Google sessions from leaking. That was defensive scaffolding for the `tradephani` bug — which turned out to be the auth-config issue, not the browser. The embedded option was removed; one Connect button = one consistent flow (system browser via `shell.openExternal`).

The OAuth window code path is still in `main.ts::aios:open-oauth-window` (not currently called), with `prompt=select_account` injected into Google OAuth URLs — kept as a kill-switch in case we ever need it again.

### Hard-reset for a stuck device

If a user is in a bad state:
1. `curl -X DELETE` every connection in Composio.
2. `delete from public.device_connections` and `device_users` in Supabase.
3. Rotate `device_user_id` in local SQLite (`update app_state set value = ? where key = 'device_user_id'`).
4. Clear `~/.claude/settings.json` `mcpServers.composio`.

For workspace data only (context, chats, plans, outputs — keeps Claude path + connectors): use the **Settings → Reset workspace** button. To wipe everything from outside the app:
- Mac: `rm -rf ~/Library/Application\ Support/aios-desktop/`
- Windows (PowerShell): `Remove-Item -Recurse -Force "$env:APPDATA\aios-desktop"`
5. User reconnects via Connectors page.

The renderer-side `rotate_device_user_id` IPC handles step 3 and step 4 in one shot.

---

## 11. Onboarding flow v2

(See section 7.3.)

**Editorial design language:**
- Geist Sans body, Instrument Serif italic accents (`em` tags inside H1s).
- Sage green (#3d5a4a) for active state, paper (#fafaf7) background.
- Eyebrows + thin hairline rules instead of heavy borders.
- Pill buttons (`btn-pill`, `btn-pill-ghost`).
- All under `.onboarding-v2-*` selector prefix in `styles.css`.

**Single-column layout** — no sidebar, no chrome. The setup-required state hides the main app sidebar entirely.

**Reset:** Settings → "Reset onboarding" calls `reset_onboarding` IPC which clears `completed_at` in the `onboarding` table. The renderer re-reads workspace state and `setupRequired` flips back on, no app restart needed.

---

## 12. Daily Brief

(See sections 7.9, 7.10.)

**Lifecycle:**
1. On app load, `get_today_brief_status` is called with `localDate` (YYYY-MM-DD).
2. If `shouldShow` is true (not first install, not already seen today), the popover modal opens.
3. The modal calls `generate_daily_brief` if no brief exists for today. Python builds the prompt (read context, plans, outputs, gtd folder) and runs Claude with a 180 s timeout.
4. The result is saved to SQLite (`daily_briefs` table) AND written to disk (`outputs/daily-brief/<date>.md`).
5. "I've read it" → `mark_brief_seen` sets `last_brief_seen_date`.

**Why first-day skip:** `record_first_install_if_missing` stores the install date; on day 1 we skip the brief because there's nothing to brief on.

---

## 13. Auto-tasks (in-app scheduler)

(See section 7.11.)

A 60-second tick loop in `main/scheduler.ts` polls Python's `list_due_auto_tasks` and runs anything where `next_run <= now`. Schedule presets:
- Every 15 min / hour / 6h
- Daily 7am / 9am
- Weekly Mon 9am

Run flow:
1. `begin_auto_task_run` creates a row with status `pending`.
2. `run_task` invokes Claude (700 s timeout).
3. On success: write the response to `outputs/auto-tasks/<slug>-<stamp>.md` via `write_file`, finish run with status `success`, cost USD.
4. On failure: finish with status `failed`, error message.
5. `advance_auto_task` recomputes `next_run`.

**Caveat:** runs only while AIOS Desktop is open. For overnight runs the user needs OS-level Task Scheduler. Made explicit in the page header.

---

## 14. Workspace data layout (end-user disk)

```
%APPDATA%/aios-desktop/ai-sales-os/   (Win)
~/Library/Application Support/aios-desktop/ai-sales-os/   (Mac)

├── CLAUDE.md                   # Project-specific Claude instructions (loaded every session)
├── data/
│   └── settings.db             # SQLite — sessions, app_state, onboarding, modules, auto_tasks, daily_briefs
├── context/
│   ├── personal-info.md
│   ├── business-info.md
│   ├── strategy.md
│   ├── current-data.md
│   ├── funnel.md               # Auto-derived from the above
│   └── import/                 # User-imported raw material (folders + loose files)
├── outputs/
│   ├── auto-tasks/             # <slug>-<timestamp>.md per auto-task run
│   ├── daily-brief/            # <date>.md per daily brief
│   ├── data/                   # DataOS module output
│   └── intel/                  # IntelOS module output
├── plans/                      # /create-plan and /implement consume these
├── shares/                     # Shareable bundles
├── reference/                  # Static reference material
├── scripts/                    # Module-installed scripts
├── module-installs/            # Source folders for installable modules (copied from starter-kit)
└── logs/
    └── desktop.log             # JSON-line logs from main process
```

The starter kit at `aios-starter-kit/` in the repo is copied into the workspace on first launch.

---

## 15. SQLite schema

Defined in `python/workspace.py::ensure_schema`. Database lives at `<workspace>/data/settings.db`.

| Table | Columns | Purpose |
|---|---|---|
| `settings` | `key TEXT PK, value TEXT, updated_at TEXT` | Generic key/value (claude_path, theme, connector_label_<svc>, etc.) |
| `app_state` | `key TEXT PK, value TEXT NOT NULL, updated_at TEXT` | App-level state (device_user_id, first_install_date, last_brief_seen_date) |
| `onboarding` | `id INT PK CHECK(id=1), current_step INT, answers TEXT, completed_at TEXT` | Single-row state machine. |
| `modules` | `id TEXT PK, name TEXT, version TEXT, installed_at TEXT, enabled INT, config TEXT` | Module registry. |
| `sessions` | `id TEXT PK, title TEXT, messages TEXT, updated_at TEXT, claude_session_id TEXT` | Chat threads. `messages` is a JSON blob. `claude_session_id` enables resume. |
| `auto_tasks` | `id INT PK AUTOINCREMENT, name TEXT, prompt TEXT, schedule TEXT, enabled INT, last_run TEXT, next_run TEXT, created_at TEXT` | Scheduler. |
| `auto_task_runs` | `id INT PK AUTOINCREMENT, task_id INT FK, started_at TEXT, finished_at TEXT, status TEXT, output_path TEXT, cost_usd REAL, error TEXT` | Per-run history. |
| `daily_briefs` | `id INT PK AUTOINCREMENT, brief_date TEXT UNIQUE, generated_at TEXT, headline TEXT, content TEXT` | One brief per local date. |

A lightweight migration runs on every startup to ALTER `sessions` ADD `claude_session_id` if it's missing.

---

## 16. IPC commands — full reference

Every command in the `AiosCommand` union, what it does, where it's handled.

### Workspace + onboarding
| Command | Args | Returns | Handler |
|---|---|---|---|
| `get_workspace_info` | — | `{workspaceRoot, hasClaudeMd, platform, settingsDb, modules, deviceUserId}` | python/workspace.py |
| `get_onboarding_state` | — | `{currentStep, answers, completedAt}` | python |
| `save_onboarding_answer` | `{questionId, value, step}` | onboarding state | python |
| `complete_onboarding` | `{answers}` | `{completedAt, context}` | python |
| `reset_onboarding` | — | onboarding state | python |

### Files
| Command | Args | Handler |
|---|---|---|
| `read_file` | `{path}` → `{path, content}` | python |
| `write_file` | `{path, content}` → `{path, bytes}` | python |
| `append_file` | `{path, content}` → `{path, bytes}` | python |
| `move_file` | `{fromPath, toPath}` | python |
| `write_binary_file` | `{path, data: base64}` → `{path, bytes}` | python |
| `delete_workspace_file` | `{path}` → `{deleted, path}` | python |
| `list_workspace_files` | `{limit}` → `{entries}` | python |
| `list_workspace_section` | `{section}` → `{path, entries}` | python |
| `list_directory` | `{path, recursive, limit}` → `{path, entries}` | python |
| `get_recent_workspace_activity` | `{limit}` → `{entries}` | python |
| `read_markdown_preview` | `{path}` → `{path, content, preview, modifiedAt, kind}` | python |
| `restore_context_template` | `{name}` → `{path, content, bytes}` | python |
| `reveal_in_file_manager` | `{path}` → `{ok, path}` | **main** (uses `shell.showItemInFolder`) |

### Imports
| Command | Args | Handler |
|---|---|---|
| `list_imports` | — → `{folders, entries}` | python |
| `delete_import` | `{name}` → `{deleted, name}` | python |
| `list_import_folder` | `{name}` → `{folder, entries}` | python |
| `create_import_folder` | `{name}` → `{name, path}` | python |
| `delete_import_folder` | `{name}` → `{deleted, name}` | python |

### Modules
| Command | Args | Handler |
|---|---|---|
| `list_modules` | — → `ModuleInfo[]` | python |
| `install_module` | `{moduleId}` → `{module, installed}` | python |

### Sessions / chat
| Command | Args | Handler |
|---|---|---|
| `get_sessions` | — → `ChatSession[]` | python |
| `create_thread` | `{title?}` → `ChatSession` | python |
| `rename_thread` | `{id, title}` → `{id, title}` | python |
| `delete_thread` | `{id}` → `{deleted, id}` | python |
| `save_session` | `{session}` → `{id, updatedAt}` | python |

### Claude runtime
| Command | Args | Handler |
|---|---|---|
| `find_claude` | — → `ClaudeStatus` (and persists path) | **main** |
| `set_claude_path` | `{path?, browse?}` → `{stored, path?, version?, error?}` | **main** |
| `test_claude_connection` | `{path?}` → `{ok, path?, version?, error?}` | **main** |
| `run_prime` | `{claudePath?, streamId?}` | python |
| `run_task` | `{prompt, claudePath?, streamId?, sessionId?}` | python |
| `transcribe_audio` | `{audio: base64, engine?, language?}` → `{text, engine}` | python |

### Auto-tasks
| Command | Args | Handler |
|---|---|---|
| `list_auto_tasks` | — → `{tasks}` | python |
| `create_auto_task` | `{name, prompt, schedule}` → `AutoTask` | python |
| `update_auto_task` | `{id, name?, prompt?, schedule?}` → `AutoTask` | python |
| `delete_auto_task` | `{id}` → `{deleted, id}` | python |
| `toggle_auto_task` | `{id, enabled}` → `AutoTask` | python |
| `list_recent_auto_runs` | `{limit}` → `{runs}` | python |
| `list_due_auto_tasks` | — → `{tasks}` (used by scheduler tick) | python |
| `begin_auto_task_run` | `{taskId}` → `{id, taskId, startedAt, status}` | python |
| `finish_auto_task_run` | `{runId, status, outputPath?, costUsd?, error?}` | python |
| `advance_auto_task` | `{taskId}` → `{id}` | python |
| `run_auto_task_now` | `{taskId}` → `{ok, taskId}` | **main** (kicks scheduler immediately) |

### Daily briefs
| Command | Args | Handler |
|---|---|---|
| `get_today_brief_status` | `{localDate}` → `DailyBriefStatus` | python |
| `generate_daily_brief` | `{localDate, claudePath?, streamId?}` → `{brief, regenerated}` | python |
| `list_daily_briefs` | `{limit}` → `{briefs}` | python |
| `mark_brief_seen` | `{localDate}` → `{ok, lastBriefSeenDate}` | python |

### Connectors
| Command | Args | Handler |
|---|---|---|
| `update_claude_mcp` | `{name, config}` → `{path, name, removed, serverCount}` | python (writes ~/.claude/settings.json) |
| `rotate_device_user_id` | — → `{deviceUserId}` | python |

### Settings
| Command | Args | Handler |
|---|---|---|
| `get_setting` | `{key}` → `{key, value}` | python |
| `set_setting` | `{key, value}` → `{key, value}` | python |

### Misc
| Command | Args | Handler |
|---|---|---|
| `get_context_summary` | — → `{files, imports}` | python |
| `list_outputs` | — → `{path, entries}` | python |
| `list_plans` | — → `{path, entries}` | python |
| `list_shares` | — → `{path, entries}` | python |

**Non-Aios IPC channels** (not on the AiosCommand union):
- `aios:open-external` — open URL in system browser
- `aios:open-oauth-window` — open isolated OAuth window (legacy, not currently used)
- `aios:get-version` — return `app.getVersion()`
- `aios:check-for-updates` — manual update check
- `aios:install-update` — quit & install
- `aios:host-event` — fan-out from Python (claude_stream, auto_task_complete, etc.)
- `aios:update-state` — autoUpdater status broadcast
- `window:minimize` / `window:maximize` / `window:close`
- `window:maximized-changed` (broadcast on maximize/unmaximize)
- `shortcut:preferences` (Cmd+,)

---

## 17. Design system & visual direction

**Direction:** ChatGPT × Sana AI — clean conversational AI-app feel + Sana's editorial polish. Serif italic accents, sage green, Geist Sans body, no Inter, no full-magazine vibe.

### Tokens (`styles.css` `:root`)

```
--paper:        #fafaf7   /* warmer than ChatGPT's stark white, cooler than Sana's cream */
--surface:      #ffffff
--surface-soft: #f4f4ef
--surface-deep: #ececea

--ink:        #0d0d0d
--ink-soft:   #3d3d3d
--gray-700/500/400/300/200/100   /* a real soft-gray scale */

--sage:       #3d5a4a            /* the ONE accent color, used sparingly */
--sage-soft:  rgba(61, 90, 74, 0.08)
--sage-line:  rgba(61, 90, 74, 0.18)

--route-imports/briefs/outputs/plans/modules   /* per-route punctuation only */

--success/warning/danger/info  + soft variants

--radius-sm/md/lg/xl + --radius-pill
--shadow-sm/md/lg/xl

--font-display: "Instrument Serif", serif    /* italic in H1s */
--font-body:    "Geist", -apple-system, ...
--font-mono:    "Geist Mono", ...
```

### Signature classes

| Class | Used for |
|---|---|
| `.eyebrow`, `.eyebrow-rule` | Small uppercase tracking-wide labels above section heads |
| `.btn-pill`, `.btn-pill-ghost` | The primary editorial CTAs (used heavily in onboarding) |
| `.card`, `.hairline` | Light card surface + thin divider line |
| `.aios-chat-*` | Chat composer + message system |
| `.connector-card`, `.connector-card-*` | Connector cards |
| `.onboarding-v2-*` | Entire onboarding flow (single-column editorial) |
| `.layer-badge`, `.layer-dot` | Used on every page hero (Connectors / Imports / Plans / Outputs) |

### Conventions

- Italic Instrument Serif accent in every H1 — wrap a key word in `<em>`.
- Sage as the only accent color, used for active state + dots + thin focus rings.
- Square corners are explicitly avoided (token swaps + square borders read as lazy — feedback memory).
- Shadows are subtle (`--shadow-sm/md`); elevation is mostly via background tone, not drop shadow.

### Responsive behavior

- Min window 1040×720; design assumes 1280+ for full layout.
- The sidebar collapses (currently always visible above 1040; no mobile layout — desktop-only).

### Animation discipline

Every CSS animation respects `body.window-hidden` (paused when window not visible) and `prefers-reduced-motion: reduce` (disabled).

---

## 18. Build, packaging, releasing

### `package.json` scripts

```
dev              concurrently → vite dev server + electron in dev mode (VITE_DEV_SERVER_URL set)
build            tsc main + tsc renderer + vite build
build:python     pyinstaller --noconfirm --clean build/aios-host.spec  (writes to dist/aios-host/)
pack             build → build:python → electron-builder --dir   (unpacked, no installer)
dist             build → build:python → electron-builder         (installers, no upload)
dist:win         ... electron-builder --win
dist:mac         ... electron-builder --mac
release          ... electron-builder --publish always           (uploads to GH Release)
test             vitest run
test:python      node scripts/run-python-tests.js
check            build + test + test:python
```

### `electron-builder` config (under `build:` in package.json)

| Field | Value | Why |
|---|---|---|
| `appId` | `com.aios.desktop` | macOS bundle identifier. |
| `productName` | `AIOS Desktop` | Shown in installer + system. |
| `directories.output` | `release` | All installers go here. |
| `files` | `dist/main/**/*`, `dist/renderer/**/*`, `package.json`, `assets/icon.png`, plus exclusions | **Critical:** the explicit `dist/main` + `dist/renderer` matters — using `dist/**/*` would also drop the PyInstaller bundle into app.asar (bloating it from ~5MB to ~90MB and causing the "5-min load" perf bug). |
| `extraResources` | `dist/aios-host` → `aios-host`, `aios-starter-kit` → `aios-starter-kit` | Sidecar binary + starter kit copied to `<install>/resources/`. |
| `asarUnpack` | `**/node_modules/keytar/**` | keytar uses native bindings; can't run from inside asar. |
| `mac.target` | `dmg` + `zip`, both `arm64` and `x64` | DMG for end users; ZIP is what electron-updater wants for delta updates. |
| `mac.icon` | `build/icon.png` (1024×1024) | electron-builder derives `.icns`. |
| `mac.entitlements` | `build/entitlements.mac.plist` | Mic + network + JIT (for unsigned builds). |
| `mac.extendInfo.NSMicrophoneUsageDescription` | "AIOS uses your microphone for voice input…" | Required Info.plist key, otherwise mic is silently denied. |
| `win.target` | `nsis` + `x64` | Installer with directory choice, desktop + start menu shortcut. |
| `nsis.oneClick` | `false` | Per-user install with directory selection. |
| `publish.provider` | `github` | Auto-update via GitHub Releases. |
| `publish.owner/repo` | `satyaprakashmallidi/AIOS_Desktop` | Where releases live. |

### PyInstaller (`build/aios-host.spec`)

- Single-binary bundle of `host.py` + `workspace.py`.
- `collect_all('speech_recognition')` to pull in the FLAC encoder + data files PyInstaller's static analyzer misses.
- `target_arch='universal2'` on Mac so the same sidecar runs natively on Apple Silicon AND Intel.
- Excludes tkinter/numpy/pandas/PIL/etc. to keep the binary lean.
- UPX off — confuses antivirus and Gatekeeper.
- Output: `dist/aios-host/aios-host(.exe)` + supporting libs.

### Cutting a release (CI path)

```
1. Bump version in package.json (e.g. 0.1.6 → 0.1.7), commit
2. git tag v0.1.7
3. git push origin v0.1.7
```

The `.github/workflows/release.yml` workflow runs Windows + Mac in parallel:
1. `actions/checkout@v4`
2. Setup Node 20, Python 3.11
3. `pip install pyinstaller && pip install -r python/requirements.txt`
4. `npm ci`
5. `npm run build:python`
6. `npm run release -- --win` (or `--mac`) → builds + uploads to a draft GitHub Release
7. Uploads `latest.yml` / `latest-mac.yml` (the auto-update manifests)

When green: GitHub → Releases → find the draft → Publish. From that moment forward, every running AIOS Desktop install will auto-download the new version.

### Output artifacts

| Platform | Format | Filename |
|---|---|---|
| Windows | NSIS installer | `AIOS Desktop Setup <version>.exe` |
| macOS | DMG (arm64 + x64) | `AIOS Desktop-<version>-arm64.dmg`, `-x64.dmg` |
| macOS | ZIP (auto-update) | `AIOS Desktop-<version>-arm64-mac.zip`, `-x64-mac.zip` |

### Code signing (deferred)

Currently unsigned. Mac users right-click → Open the first time. Windows users dismiss SmartScreen. Fine for early testers, not for public launch.

When ready:
- **Mac (Apple Developer ID, $99/year):** export `.p12`, base64-encode → `CSC_LINK` secret; password → `CSC_KEY_PASSWORD`; remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from CI; flip `hardenedRuntime: true` in package.json. Notarization: add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets.
- **Windows (Authenticode, $200-700/year):** export `.pfx`, base64-encode → `CSC_LINK`, password → `CSC_KEY_PASSWORD` (same env vars; electron-builder handles both platforms).

---

## 19. Auto-update flow

`electron-updater` checks `https://github.com/satyaprakashmallidi/AIOS_Desktop/releases/latest/download/latest.yml` (or `latest-mac.yml`). If the version there is newer than the running app, downloads the diff (block-map differential) in the background. On next quit, applies and restarts.

**In-app surface:**
- Settings → General → "App version" row shows live state from `onUpdateState` events.
- States: `idle` → `checking` → `up-to-date` | `available` → `downloading` (with %) → `ready` (with "Restart & install" button).
- Manual trigger: "Check for updates" button calls `aios:check-for-updates` IPC.
- "Restart & install" calls `aios:install-update` → `autoUpdater.quitAndInstall()`.

**Dev guard:** `if (!app.isPackaged) return { ok: false, reason: "not-packaged" }` — autoUpdater no-ops in development.

---

## 20. Cross-platform (Mac vs Windows)

| Concern | Mac | Windows |
|---|---|---|
| Workspace path | `~/Library/Application Support/aios-desktop/ai-sales-os/` | `%APPDATA%/aios-desktop/ai-sales-os/` |
| Window chrome | `titleBarStyle: "hiddenInset"`, traffic lights at (14, 14), no custom controls | `frame: false`, custom Min/Max/Close buttons rendered by renderer |
| Quit on last window close | NO (Mac convention — app stays in dock) | YES |
| Claude path placeholder | `/opt/homebrew/bin/claude` | `C:\Users\you\AppData\Roaming\npm\claude.cmd` |
| Claude search candidates | `/opt/homebrew/bin/claude`, `~/.npm-global/bin/claude`, `~/.nvm/.../bin/claude`, `~/.volta/bin/claude`, plus `which claude` | `where claude`, `%APPDATA%\npm\claude.cmd`, `%LOCALAPPDATA%\Programs\nodejs\...` |
| Python sidecar PATH augmentation | `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin` | `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\nodejs`, `C:\Program Files\nodejs` |
| Mic permission | Requires `NSMicrophoneUsageDescription` in Info.plist + `setPermissionRequestHandler` granting media | `setPermissionRequestHandler` granting media |
| OAuth | `shell.openExternal` → default browser (Safari/Chrome) | `shell.openExternal` → default browser (Edge/Chrome) |
| Code signing | Apple Developer ID + notarization | Authenticode |
| Bundled sidecar location | `<App>/Contents/Resources/aios-host/aios-host` | `<install>/resources/aios-host/aios-host.exe` |

---

## 21. Performance discipline

These were tightened in the recent cleanup pass; preserve the spirit when adding new screens:

- **All polling intervals are visibility-gated.** `if (document.visibilityState !== "visible") return;` at the top of every `setInterval`. Cadences: workspace 60 s, connectors heartbeat 120 s, auto-tasks 60 s.
- **`body.window-hidden` class** toggled on `visibilitychange`. CSS rule pauses every animation.
- **Memoized chat rendering.** `MessageMarkdown` and `CodeBlock` are both `React.memo`. The `components` and `remarkPlugins` props are module-level constants — passing fresh object references would defeat memoization.
- **Voice transcription** ticks at 3.5 s (not 2 s) and skips when window hidden.
- **Concurrent Python sidecar.** Every IPC request runs in its own daemon thread with stdout writes guarded by a single lock. A single 25-second Claude task no longer freezes every other IPC behind it.
- **App.asar is lean.** PyInstaller bundle is excluded from the asar file via the explicit `dist/main/**/*` + `dist/renderer/**/*` files config (NOT `dist/**/*`). Reduced asar from ~90MB to ~5MB and fixed the "5-minute load" bug.
- **Background connector identify is throttled.** App-level effect runs at most 2 concurrent identify tasks, runs ONCE per app session, hydrates from stored labels first.

---

## 22. What changed across the session — release-by-release

| Commit | Version | Change |
|---|---|---|
| `37008ca` | 0.1.0 init | Initial commit: Electron + React + Python sidecar wired up. |
| `741c2a4` | | Generated 1024×1024 icon (Mac requires ≥512). |
| `0a14595` | | Fixed electron-builder paths: icon.png direct, sidecar at dist/aios-host. |
| `f8dcbe4` | 0.1.1 | Bundle SpeechRecognition for voice; hardcode relay URL fallback. |
| `1193401` | | Mac: NSMicrophoneUsageDescription added; icon.png included in bundle. |
| `52e1d3b` | | Added .zip mac target so electron-updater can do delta updates. |
| `6d83237` | | PyInstaller: `target_arch=universal2` so x64 + arm64 Macs run the same sidecar. |
| `1ebbb22` | | Removed unused `electron-is-dev` dep + dev-path fallback in starter-kit lookup. |
| `0b3498c` | 0.1.2 | Clean release — v0.1.1 draft had orphan asset conflicts. |
| `8d4451d` | | Added "Check for updates" UI in Settings + visible update progress states. |
| `8ec80f6` | | Settings/About: shows actual app version via `aios:get-version` IPC, not hardcoded. |
| `14fc5e6` | 0.1.5 | Shrank asar (excluded PyInstaller bundle) + app-level background connector identify. |
| `dce5dba` | 0.1.6 | Concurrent Python sidecar (threading + STDOUT lock) + throttled (2x) background identify. |

---

## 23. Critical bugs we fixed (and why)

### "Wrong Gmail account" cross-contamination
**Symptom:** every Gmail connection appeared to bind to `tradephani@gmail.com` regardless of which account the user authorized.
**Root cause:** Composio's user-created auth config in the dashboard had `is_enabled_for_tool_router: false`. The MCP tool router could only see Composio's auto-default config, which had a stale connection.
**Fix:** for every service, after creating the auth_config, PATCH it with `{type:"default", is_enabled_for_tool_router:true}`. Documented as a hard rule.

### claude.ai-side connector cross-contamination
**Symptom:** even with Composio fixed, Claude would sometimes reach into the user's Anthropic-account-linked Gmail (set up via claude.ai connectors) instead of the Composio one.
**Fix:** every `claude --print` invocation now passes `--strict-mcp-config --mcp-config '<inline JSON>'` with only the Composio entry. claude.ai's first-party connectors are completely hidden.

### Claude offering OAuth quick-connect URLs in chat
**Symptom:** when asked about Gmail, Claude would sometimes say "click here to connect Gmail: lk_xxx…" — and clicking it bound the wrong account.
**Fix:** explicit rule in `_COMPOSIO_SYSTEM_PROMPT`: never invent OAuth URLs / quick-connect links / `lk_` codes. Refer users to the Connectors page.

### "New chat" button intermittent failure
**Symptom:** clicking "New chat" occasionally created a thread that immediately disappeared.
**Root cause:** race between `create_thread` (returns the new session) and the 60s `refreshWorkspace` polling (overwrites state with the authoritative session list, which sometimes hadn't included the new thread yet).
**Fix:** after `create_thread`, immediately re-call `get_sessions` and merge — if the new session isn't there, prepend it explicitly.

### Splash hanging forever
**Symptom:** in a bad startup state, the splash screen would never resolve.
**Fix:** added a 10-second "Retry" button instead of an auto-clear watchdog (auto-clearing dropped users into an empty React state, making them think their data was lost). Data is always safe in SQLite.

### Mac icon error
**Symptom:** electron-builder failed with "icon.png must be at least 512×512".
**Fix:** generated 1024×1024 PNG with sharp, placed at `build/icon.png`. Removed the .ico/.icns specific config — let electron-builder derive both formats automatically.

### Voice transcription broken in production
**Symptom:** worked in dev, failed in packaged builds.
**Root cause:** SpeechRecognition's bundled FLAC encoder + data files weren't picked up by PyInstaller's static analyzer.
**Fix:** `python/requirements.txt` adds `SpeechRecognition>=3.10`; `build/aios-host.spec` uses `collect_all('speech_recognition')` to pull in the binary + datas + hidden imports.

### About section showed hardcoded "0.1.0"
**Symptom:** even after auto-update to v0.1.6, the About panel said "0.1.0".
**Fix:** added `aios:get-version` IPC that returns `app.getVersion()`. AboutPanel calls it in `useEffect`.

### App was "5 minutes to load modules"
**Symptom:** in packaged builds, navigating between screens took ages.
**Root cause:** app.asar was 90MB because `files: ["dist/**/*"]` accidentally included the PyInstaller bundle inside the asar (in addition to the extraResources copy outside).
**Fix:** explicit `files: ["dist/main/**/*", "dist/renderer/**/*", ...]`. asar dropped to ~5MB.

### "Second click stalls infinitely"
**Symptom:** first chat reply was instant; every subsequent IPC request hung indefinitely.
**Root cause:** Python sidecar processed `sys.stdin` line-by-line in a `for` loop. A single `run_task` (which spawns Claude CLI for 10-25s) blocked every other IPC behind it.
**Fix:** rewrote `main()` to spawn a daemon `threading.Thread(target=_handle_request, args=(line,))` for each request. Added `_STDOUT_LOCK` so concurrent threads don't interleave their JSON-RPC responses.

### Composio MCP-delete loop (4 always-failing attempts)
**Symptom:** every `getMcpConfig` call wasted ~1.5 s trying 4 different Composio session-delete endpoints, all of which 404'd.
**Fix:** reduced to one best-effort try. We rotate the device_user_id client-side instead when we need a truly fresh session.

### Sequential per-row Composio fetches in `handleListConnections`
**Symptom:** the `/connections` endpoint blocked on the slowest Composio response.
**Fix:** `Promise.allSettled` for the per-row probes.

---

## 24. Future work / known limitations

| Area | Status |
|---|---|
| **Bundling Python interpreter for plug-and-play** | Done via PyInstaller. Users no longer need Python installed. |
| **Claude Code CLI bundling** | Not done — npm-installed CLIs are complicated to ship. Onboarding handles detection gracefully (auto-detect → manual path). |
| **Code signing (Mac + Win)** | Deferred until public launch. Unsigned builds work for early testers. |
| **Auto-task overnight runs** | Currently only run while AIOS Desktop is open. Future: wire up OS Task Scheduler integration. |
| **Single-source-of-truth `AiosCommand`** | Currently duplicated between `main/types.ts` and `renderer/src/types.ts`. High blast radius to fix; in-sync today. |
| **Linux build** | electron-builder supports it but not currently in CI. |
| **Dark theme + Auto theme** | Settings UI exists with "Coming soon" pills; not implemented. |
| **Onboarding O(n²) layer-jump unlock check** | 4 × 8 = 32 ops on a click. Imperceptible. Won't fix. |
| **Python `run_claude_stream` line-reading timeout** | Never observed in real use; risk of breaking long legitimate streams outweighs the hypothetical gain. Won't fix. |

---

## Appendix: where to look first when…

| Symptom | Files to look at |
|---|---|
| Connectors not authorizing right account | `python/host.py::_mcp_isolation_flags`, `_COMPOSIO_SYSTEM_PROMPT`, `supabase/functions/aios-relay/index.ts::handleInitiate` |
| Chat reply hangs forever | `python/host.py::_handle_request`, `_STDOUT_LOCK`, scheduler.ts |
| Auto-updater not triggering | `main/main.ts::autoUpdater`, `package.json::build.publish`, `.github/workflows/release.yml`, GitHub Releases is published (not just draft) |
| New screen styling looks off | `renderer/src/styles.css` (search for `.layer-badge`, `.btn-pill`, `.card`) — copy structure from an existing screen |
| New IPC command "Command is not allowed" | Forgot to add to `main/preload.ts::allowedCommands` or `main/types.ts::AiosCommand` |
| New IPC command "Unknown command" | Forgot to add to `python/host.py::dispatch` |
| Mac build fails on icon | `build/icon.png` must be ≥512×512; electron-builder derives `.icns` automatically |
| Voice transcription broken in packaged build | `build/aios-host.spec::collect_all('speech_recognition')`; `python/requirements.txt` |
| Window controls missing on Mac | They're hidden when `workspace.platform === "darwin"`; system traffic-lights take over |
| App.asar bloated | `package.json::build.files` — must be explicit `dist/main/**/*` + `dist/renderer/**/*`, NOT `dist/**/*` |

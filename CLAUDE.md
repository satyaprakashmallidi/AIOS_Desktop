# AIOS Desktop — Engineering Reference

This file is the canonical onboarding doc for anyone (human or Claude) picking up AIOS Desktop. Read top-to-bottom; everything load-bearing is here.

---

## What this is

AIOS Desktop is an Electron app that ships to end users on Windows and macOS. Each install behaves as one logical user, auto-provisioned silently on first launch. Users connect their own services (Gmail, Calendar, Slack, ClickUp, Notion) once via a Connectors page, and from then on Claude Code can act on their behalf inside any chat.

**Three layers:**
1. **Renderer** — React 19 + Vite (`renderer/src/`). The UI.
2. **Main process** — Electron + TypeScript (`main/`). Window lifecycle, OAuth windows, IPC.
3. **Python sidecar** — JSON-RPC over stdio (`python/host.py` + `python/workspace.py`). Owns SQLite, spawns Claude Code CLI, scheduler.

**Plus a remote relay:** Supabase Edge Function (`supabase/functions/aios-relay/`). Holds the master Composio API key. The desktop app never sees that key.

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│ Electron Main (main/main.ts, main/preload.ts)                        │
│  • Window lifecycle  • OAuth BrowserWindow w/ isolated session       │
│  • IPC allowlist     • Hard-stop python sidecar on quit              │
└──────────┬───────────────────────────────────────────────────────────┘
           │ contextBridge IPC ("aios:invoke", cmd, args)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer (renderer/src/App.tsx + screens/*)                          │
│  • React state for workspace, sessions, modules, connections         │
│  • 60s visibility-gated refresh polls for live state                 │
│  • Spawns OAuth windows via main, polls relay for completion         │
└──────────┬───────────────────────────────────────────────────────────┘
           │ JSON-RPC over stdio
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Python sidecar (python/host.py)                                      │
│  • dispatch registry → workspace.py functions                         │
│  • spawns `claude --print --strict-mcp-config ...` for run_task      │
│  • SQLite at %APPDATA%/aios-desktop/ai-sales-os/data/settings.db     │
└──────────┬───────────────────────────────────────────────────────────┘
           │ stdio
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Claude Code CLI (subprocess)                                         │
│  • --strict-mcp-config to ignore claude.ai-side connectors           │
│  • Composio MCP only — system prompt never reveals "Composio" exists │
└──────────────────────────────────────────────────────────────────────┘

           Connectors flow (out of band):
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer → Supabase aios-relay → Composio v3 API                     │
│         /register /connections /initiate /mcp-config /disconnect     │
│         (auth via Bearer device_user_id UUID)                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Cross-stack command sync

When adding a new IPC command, update **all four** places:

1. `main/types.ts` — `AiosCommand` union
2. `main/preload.ts` — allowlist Set
3. `renderer/src/types.ts` — `AiosCommand` union (mirror of main)
4. `python/host.py` dispatch dict (around line 687)

Skipping any one yields silent failures (`Command is not allowed: foo` from preload, or `Unknown command` from Python). Renderer changes hot-reload via Vite. Main + preload changes require `npx tsc -p tsconfig.main.json` then full restart.

---

## Connectors — the load-bearing piece

The Connectors page (`renderer/src/screens/ConnectorsScreen.tsx`) is the only place users grant access to their services. It's wired through:

| Step | Where | Notes |
|------|-------|-------|
| 1. User clicks Connect | `connect()` in ConnectorsScreen | Always opens system browser via `window.aios.openExternal` (the in-app embedded window option was removed) |
| 2. Renderer calls relay | `relay.initiate(deviceUserId, service)` | Returns `{ redirectUrl, connectionId }` |
| 3. User authorizes | Browser tab on Composio domain | Composio redirects through `backend.composio.dev/api/v1/auth-apps/add` |
| 4. Renderer polls | `relay.listConnections` every 1.5s for 90s | Gates a row's status from `pending` → `connected` |
| 5. MCP sync | `syncMcpToClaude()` in ConnectorsScreen | Writes `~/.claude/settings.json` `mcpServers.composio` with the per-user tool router URL |
| 6. Identify | Spawns Claude with a service-specific prompt | Result is the connected email/handle, persisted in SQLite as `connector_label_<service>` |

### Critical Composio quirk: `is_enabled_for_tool_router`

Composio toolkits expose two kinds of auth configs:
- **Tool-router-enabled** (`is_enabled_for_tool_router: true`) — visible to the MCP tool router; Claude can use these connections
- **Custom / dashboard-created** (`is_enabled_for_tool_router: false`) — invisible to MCP; connections made through these effectively don't exist for Claude

We hit this hard for Gmail. The user-created auth config in the dashboard was the wrong kind, so every connection appeared to bind tradephani's data because Composio's tool router could only see its OWN auto-default config (which had a stale connection).

**For every new service**, do exactly this in this order:
1. `POST /api/v3/auth_configs` with `{ "toolkit": { "slug": <slug> }, "auth_config": { "type": "use_composio_managed_auth", "name": "<service>-default" } }`
2. `PATCH /api/v3/auth_configs/<ac_id>` with `{ "type": "default", "is_enabled_for_tool_router": true }`
3. `npx supabase secrets set COMPOSIO_AUTH_<SERVICE_UPPER>=ac_xxx`
4. `npx supabase functions deploy aios-relay --no-verify-jwt`
5. Flip `comingSoon: true` to remove in `CONNECTOR_CATALOG` in ConnectorsScreen
6. Add a service-specific identify prompt under `prompts` in `identifyAccount()`

Service slug → env var: `service.toUpperCase().replace(/-/g, "_")` → `COMPOSIO_AUTH_<X>`. So `google-calendar` → `COMPOSIO_AUTH_GOOGLE_CALENDAR`.

### Currently wired connectors

| Service | Auth config | Slug | Status |
|---------|-------------|------|--------|
| Gmail | `ac_y-OIEuSxFKkE` | `gmail` | Live |
| Google Calendar | `ac_cpWhovJpJ3kR` | `google-calendar` | Live |
| Slack | `ac_jFwxYiIjQlUQ` | `slack` | Live |
| ClickUp | `ac_Aje5GIG8qKi6` | `clickup` | Live |
| Notion | `ac_EwoOuiTf19rs` | `notion` | Live |
| GitHub | `ac_JEd7dBt0V4CU` | `github` | Live |

All six live ones are tested end-to-end on `mspreddy7896@gmail.com` (Notion was authorized as `mspreddy789@gmail.com` separately).

### Composio tool-router etiquette

The MCP server we expose to Claude is the **tool router**, not raw Composio actions. Claude calls:

- `mcp__composio__COMPOSIO_SEARCH_TOOLS` to discover the right tool slug
- `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` to actually call it

A system prompt in `python/host.py` (`_COMPOSIO_SYSTEM_PROMPT`) tells Claude how to do this and — critically — what NOT to do:

- **Never mention Composio, MCP, tool routers, or how it got the data**
- **Never invent OAuth links** (we hit a bug where Claude offered Composio quick-connect URLs in chat that re-bound the wrong account)
- **Never compare the user's Anthropic login email with connected service accounts** (Claude Code surfaces the user's `oauthAccount.emailAddress` from `~/.claude.json`; left unchecked it'd say "you're connected as X but your Claude account is Y, want to reconcile?" — annoying)

---

## MCP isolation

Without strict isolation, Claude Code's spawned subprocess sees:
- Our Composio MCP (correct)
- claude.ai-side connectors authorized via the user's Anthropic account (wrong — they may be bound to entirely different addresses)

**Fix** (`python/host.py:_mcp_isolation_flags`): every `claude --print` invocation passes `--strict-mcp-config --mcp-config '<inline JSON>'` with only the Composio entry from `~/.claude/settings.json`. This blocks claude.ai connectors completely.

---

## OAuth UX

The OAuth flow uses the **system browser** (`shell.openExternal`). We previously had an embedded Electron `BrowserWindow` with cleared cookies, but that was defensive scaffolding for the `tradephani` bug — which turned out to be the auth-config issue, not the browser. The embedded window option was removed; one Connect button = one consistent flow.

The user's machine had a leftover account binding from before our fixes. To fully reset for someone:

1. `curl -X DELETE` every connection in Composio
2. `delete from public.device_connections` and `device_users` in Supabase
3. Rotate `device_user_id` in local SQLite (`update app_state set value = ? where key = 'device_user_id'`)
4. Clear `~/.claude/settings.json` `mcpServers.composio`
5. User reconnects via Connectors page

---

## Onboarding (v2)

`renderer/src/screens/OnboardingScreen.tsx` is the welcome flow. Three stages:

1. **Connect** — verify Claude Code CLI is installed (auto-detect, manual path, test)
2. **Profile** — 8 questions across 4 layers (Identity / Business / Priorities / Data) → written to `context/*.md` files in the workspace
3. **Ready** — summary card with three checked rows + "Start using AIOS"

The full editorial design (Sana × ChatGPT) — Geist Sans body, Instrument Serif italic accents, sage `#3d5a4a`, paper `#fafaf7`. Signature classes: `eyebrow`, `eyebrow-rule`, `btn-pill`, `btn-pill-ghost`, `card`, `hairline`. All under `.onboarding-v2-*` in `styles.css`.

Reset onboarding from Settings → "Reset onboarding" — calls the `reset_onboarding` IPC which clears `completed_at` in the `onboarding` table and rewinds `current_step` to 0. The renderer then re-reads workspace state and `setupRequired` flips back to true, no app restart needed.

---

## Splash + watchdog

`App.tsx` shows a centered card splash while `Promise.all([refreshWorkspace(), detectClaude()])` resolves. There is **no auto-clear watchdog** — entering the app with empty React state made the user think their data had vanished. Instead, after 10s of no progress, a "Retry" button appears that does `window.location.reload()`. Data is always safe in SQLite.

---

## Performance discipline

These were tightened in the recent cleanup pass; preserve the spirit when adding new screens:

- **All polling intervals are visibility-gated.** `if (document.visibilityState !== "visible") return;` at the top of every `setInterval` callback. Rates: workspace 60s, connectors heartbeat 120s, auto-tasks 60s.
- **Body class `window-hidden`** is toggled on `visibilitychange`. The CSS rule `body.window-hidden *:after, *:before, * { animation-play-state: paused !important }` pauses every CSS animation when the window isn't visible.
- **Memoized chat rendering**. `MessageMarkdown` (a memo'd ReactMarkdown wrapper) and `CodeBlock` are both `React.memo`. The `components` and `remarkPlugins` props are module-level constants — passing fresh object references would defeat memoization.
- **Voice transcription** ticks at 3.5s (down from 2s) and skips when window is hidden.

---

## What changed in this session

Highlights of the work that shipped during this conversation:

### New / rewritten
- Connectors page + 5 wired services (Gmail, Calendar, Slack, ClickUp, Notion)
- Supabase relay (`/register`, `/connections`, `/initiate`, `/disconnect`, `/mcp-config`) + Composio webhook
- Onboarding v2 — full editorial redesign, three stages, Back/Skip buttons, single-column layout
- Splash redesign with progress bar + retry escape hatch
- Connectors loading state — centered card with sage orb + italic accent

### Fixed
- Wrong-account Gmail bug → root cause was Composio's `is_enabled_for_tool_router: false` on user-created auth configs; tool router only saw the auto-default's stale connection
- claude.ai-side Gmail connector cross-contamination → `--strict-mcp-config` in every Claude spawn
- `New chat` button intermittent failure → race between `create_thread` and `refreshWorkspace` polling overwriting state; fixed by refetching the authoritative session list right after create
- Splash hanging forever → 10s retry button + watchdog removed (auto-clear was worse than the hang)
- "Click to set email" UX → removed entirely; identify task fully replaces it

### Cleaned up
- ~1,100 lines of dead onboarding CSS (`.setup-aside`, `.profile-layer-card`, `.app-shell.setup-required *` overrides, etc.)
- Dead `.windows-app-mark` / `.windows-app-name` topbar elements + their CSS overrides
- `probeAndStoreLabel` no-op stub in ConnectorsScreen
- Composio MCP-delete loop in relay (4 always-failing attempts) → reduced to one best-effort try
- `/probe` endpoint (renderer no longer calls it; chat-based identify replaces it)
- Sequential per-row Composio fetches in `handleListConnections` → `Promise.allSettled`

### Deferred (intentionally)
- Single-source-of-truth `AiosCommand` (currently duplicated between `main/types.ts` and `renderer/src/types.ts`) — high blast radius, in-sync today
- Python `run_claude_stream` line-reading timeout — never observed in real use; risk of breaking long legitimate streams outweighs the hypothetical gain
- Onboarding O(n²) layer-jump unlock check — 4 × 8 = 32 ops on a click, imperceptible

---

## Critical files

```
main/
  main.ts                  Electron main, OAuth window, before-quit cleanup
  preload.ts               IPC allowlist
  types.ts                 AiosCommand union (mirror of renderer/src/types.ts)

python/
  host.py                  JSON-RPC dispatch, run_claude_stream, MCP isolation
  workspace.py             SQLite layer, onboarding helpers, claude_settings_path

renderer/src/
  App.tsx                  Top-level state, polling, splash, screen routing
  types.ts                 AiosCommand mirror, AiosApi, WorkspaceInfo
  lib/aios-relay.ts        Relay client (register, listConnections, initiate, disconnect, getMcpConfig)
  components/BrandMark.tsx Inline SVG italic A in dark circle
  screens/
    CommandScreen.tsx      Chat — voice, attachments, memoized markdown
    ConnectorsScreen.tsx   Connector cards, polling, identifyAccount
    OnboardingScreen.tsx   v2 welcome flow
    SettingsScreen.tsx     Reset onboarding, Claude path, theme
    HistoryScreen.tsx, AutoTasksScreen.tsx, ContextScreen.tsx, etc.
  styles.css               7000+ lines; design tokens at top

supabase/
  functions/aios-relay/index.ts        Relay (5 routes, Composio mediator)
  functions/composio-webhook/index.ts  HMAC-verified webhook receiver
  migrations/0001_init.sql             device_users + device_connections schema
```

## Prerequisites (NOT auto-installed)

The app does **not** bundle Python or Claude CLI. Both are checked at startup; if missing the user sees a clear error.

| Dep | Min version | Install |
|-----|-------------|---------|
| Python | 3.10+ | macOS: `brew install python` (or python.org). Windows: python.org installer (check "Add to PATH") |
| Claude Code CLI | latest | `npm install -g @anthropic-ai/claude-code` (requires Node) |

The Onboarding "Connect Claude Code" stage handles Claude detection gracefully (auto-detect → Test → manual path). Python is harder because if the sidecar can't spawn at all, we can't even reach the renderer cleanly. Today this surfaces as `Python interpreter was not found` in the splash error banner with a list of attempted commands. **Future work**: bundle Python via PyInstaller for true plug-and-play.

Mac auto-detect search paths (`main/claude-finder.ts`):
- `which claude`
- `~/.npm-global/bin/claude`
- `~/.nvm/versions/node/current/bin/claude`
- `~/.volta/bin/claude`
- `/opt/homebrew/bin/claude`
- `/usr/local/bin/claude`
- `/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude`

## macOS specifics

- Window uses `titleBarStyle: "hiddenInset"` (system traffic lights visible, inset into our drag region) instead of `"hidden"` (Windows). The custom Minimize/Maximize/Close buttons in the topbar are hidden when `workspace.platform === "darwin"`.
- Workspace lives at `~/Library/Application Support/aios-desktop/ai-sales-os/` (resolved via `app.getPath("userData")`).
- Python sidecar's PATH augmentation (`python/host.py`) adds `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin` so `subprocess.run` can find Claude even when launched outside a shell.
- Code signing / notarization: not yet wired. First-launch Gatekeeper prompt is expected until signing is set up.

## Workspace data location

End-user workspace lives at `%APPDATA%/aios-desktop/ai-sales-os/` (Win) or `~/Library/Application Support/aios-desktop/ai-sales-os/` (Mac):
- `data/settings.db` — SQLite (sessions, app_state, onboarding, modules, auto_tasks, daily_briefs)
- `context/*.md` — human-readable profile files written by complete_onboarding
- `imports/`, `outputs/`, `plans/`, `gtd/`, `logs/`, `module-installs/`, `reference/`, `scripts/`
- `CLAUDE.md` — workspace-side context that Claude reads on every session

The starter kit template lives at `aios-starter-kit/` in the repo and is copied into the user's workspace on first launch.

## Verification — quick smoke test

1. App splash transitions to chat within ~3s
2. History page shows existing threads
3. Connectors page: all 5 live cards show their email labels
4. Click "New chat" → creates a fresh thread immediately, no race
5. Settings → Reset onboarding → v2 flow appears in place, no restart
6. Ask Claude in chat: *"What's my latest email?"* → returns a real email from the connected account
7. Ask Claude: *"What's on my calendar tomorrow?"* → returns real events
8. Open DevTools → no red console errors during navigation across screens

---

## Releasing — public Win + Mac installers

The app is packaged with **electron-builder** and the Python sidecar is bundled via **PyInstaller** so end users don't need Python installed. Auto-update is wired through **electron-updater** + GitHub Releases.

### One-time setup before your first release

1. **Set the GitHub repo target.** In `package.json` `build.publish`, replace `OWNER_PLACEHOLDER` and `REPO_PLACEHOLDER` with your GitHub `owner/repo`.
2. **Install PyInstaller locally** (only if you build outside CI): `pip install pyinstaller`
3. **Bigger icon** (optional but recommended). The current `assets/icon.png` is small. electron-builder wants 512×512+ (preferably 1024×1024) so it can derive .ico (Windows) and .icns (Mac). Drop a bigger PNG at `build/icon.png` to upgrade.

### Cutting a release (CI path — recommended)

```
# Bump version in package.json (e.g. 0.1.0 → 0.1.1), commit
git tag v0.1.1
git push origin v0.1.1
```

The `.github/workflows/release.yml` workflow runs on Windows + macOS in parallel. It:
1. Sets up Node 20 + Python 3.11
2. Installs npm deps + PyInstaller
3. Runs `npm run build:python` → bundles the sidecar
4. Runs `npm run release -- --win` (or `--mac`) → builds the installer + uploads to a **draft** GitHub Release
5. Uploads `latest.yml` / `latest-mac.yml` files needed by electron-updater

When the workflow finishes, go to **GitHub → Releases**, find the draft, and click **Publish**. From that moment forward, every running AIOS Desktop install will auto-download the new version on next launch and apply it on quit.

### Cutting a release (local path — for testing only)

```
npm run pack          # builds, doesn't package — fast smoke test
npm run dist:win      # Windows .exe + latest.yml in release/
npm run dist:mac      # macOS .dmg + latest-mac.yml in release/  (Mac only — DMG requires Mac to build)
```

Output lives in `release/`. Distribute the `.exe` / `.dmg` directly.

### Output artifacts

| Platform | Format | Filename pattern |
|----------|--------|-----------------|
| Windows | NSIS installer | `AIOS Desktop Setup <version>.exe` |
| macOS | DMG (universal: arm64 + x64) | `AIOS Desktop-<version>-arm64.dmg` / `-x64.dmg` |

### Code signing — when you're ready

**Mac (Apple Developer ID, $99/year):**
1. Get a Developer ID Application certificate from Apple
2. Export it as `.p12`, base64-encode, store in GitHub secret `CSC_LINK`
3. Store the password in `CSC_KEY_PASSWORD`
4. In `release.yml` remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"`
5. Flip `hardenedRuntime: true` in `package.json` `build.mac`
6. Add notarization: secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. electron-builder picks them up automatically.

**Windows (Authenticode, $200-700/year):**
1. Buy an OV or EV Code Signing certificate
2. Export as `.pfx`, base64-encode, store in `CSC_LINK`
3. Password in `CSC_KEY_PASSWORD`
4. The same env vars are read by electron-builder for both platforms

Until then the unsigned builds work — Mac users right-click → Open the first time, Windows users dismiss SmartScreen. Fine for early testers, not for public launch.

### What gets bundled in the final installer

- The compiled renderer (`dist/renderer/`)
- The compiled main + preload (`dist/main/`)
- The PyInstaller-built Python sidecar at `<app>/resources/aios-host/aios-host(.exe)` — a self-contained Python interpreter + our code
- The starter kit at `<app>/resources/aios-starter-kit/` — copied into the user's workspace on first launch
- The `keytar` native module (asar-unpacked so the OS keychain works)

Excluded from the installer (via `package.json` `build.files`):
- Source `.ts` / `.tsx` / `.scss` / `.md` files
- `supabase/` directory (relay lives remotely, not shipped)
- `.git`, `.edge-profile`, `__pycache__`, test directories
- The PyInstaller intermediate build dir

End user prerequisites after install:
- **Claude Code CLI** must be installed separately. Onboarding handles detection. We don't bundle it because npm-installed CLIs are complicated to ship.
- **No Python required** (bundled).

## Conventions / things to keep doing

- **No emojis in code or files** unless explicitly requested
- **No comments explaining what code does** — only why, only when non-obvious
- **No backwards-compat hacks** — change call sites, delete old code
- **Service-agnostic in Connectors infra** — never hardcode service names except in the catalog and the per-service identify prompts
- **Visibility-gate every poll** — pattern is `if (document.visibilityState !== "visible") return;`
- **Single-column editorial onboarding screens** — sage italic accent, sane typography, no purple gradients

When in doubt: read the existing screens for vocabulary, grep for similar patterns before inventing new ones.

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
│  • SQLite at %APPDATA%/...desktop/data/settings.db (Win) or          │
│    ~/Library/Application Support/aios-desktop/.../settings.db (Mac)  │
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

| Service | Auth config | Slug | Status | Used by |
|---------|-------------|------|--------|---------|
| Gmail | `ac_y-OIEuSxFKkE` | `gmail` | Live | (no module yet) |
| Google Calendar | `ac_cpWhovJpJ3kR` | `google-calendar` | Live | (no module yet) |
| Slack | `ac_jFwxYiIjQlUQ` | `slack` | Live | IntelOS |
| ClickUp | `ac_Aje5GIG8qKi6` | `clickup` | Live | (no module yet) |
| Notion | `ac_EwoOuiTf19rs` | `notion` | Live | (no module yet) |
| GitHub | `ac_JEd7dBt0V4CU` | `github` | Live | InfraOS |
| Stripe | `ac_lreLxEiFkTlp` | `stripe` | Live (v0.1.9+) | DataOS |
| YouTube | `ac_DRbRugQFigNA` | `youtube` | Live (v0.1.9+) | DataOS |
| Google Analytics | `ac_WOs6TpNhcvC-` | `google-analytics` | Live (v0.1.9+) | DataOS |
| Google Sheets | `ac_289PHe7QdUXw` | `google-sheets` | Live (v0.1.9+) | DataOS |
| Outlook | `ac_3ImWpplXGnoc` | `outlook` | Live (v0.1.11+) | (no module yet) |
| LinkedIn | `ac_RbmbGiYtSqX1` | `linkedin` | Live (v0.1.11+) | (no module yet) |
| WhatsApp Business | `ac_OOszVgWp2Xix` | `whatsapp` | Live (v0.1.15+) | (no module yet) |
| X (Twitter) | `ac_bOjT46HAfYwP` | `twitter` | Live (v0.1.16+) | (no module yet) |
| Telegram | `ac_W1_RWREtn21R` | `telegram` | Live (v0.1.16+) | (no module yet — Daily Brief still uses TELEGRAM_BOT_TOKEN env var) |
| Facebook | `ac_NzprCc18CEWA` | `facebook` | Live (v0.1.17+) | (no module yet) |
| Instagram | `ac_XzChOFJu_1mf` | `instagram` | Live (v0.1.17+) | (no module yet) |
| WhatsApp Personal | n/a (local Baileys, not Composio) | `whatsapp-personal` | Live (v0.1.19+) | Self-chat → AIOS task trigger |
| Supabase | `ac_HznZGRR1Vuyn` | `supabase` | Live (v0.1.26+) | (no module yet) |
| Google Drive | `ac_1pMu_e_RNyMB` | `google-drive` | Live (v0.1.26+) | (no module yet) |
| Airtable | `ac_b2B02yFpJsS6` | `airtable` | Live (v0.1.26+) | (no module yet) |
| Firecrawl | `ac_eqn8uWplxBKQ` | `firecrawl` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Discord | `ac_T-nIlJcsEUzh` | `discord` | Live (v0.1.26+) | (no module yet) |
| OneDrive | `ac_IkR5jjsaUqYx` | `onedrive` | Live (v0.1.26+) | (no module yet) |
| Exa | `ac_Sh8CUwFO11v1` | `exa` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| ElevenLabs | `ac_9EmJCrRwRqIZ` | `elevenlabs` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Salesforce | `ac_TLRXfUE077d2` | `salesforce` | Live (v0.1.26+) | (no module yet) |
| Calendly | `ac_q88bIqQR7O3z` | `calendly` | Live (v0.1.26+) | (no module yet) |
| Google Meet | `ac_1_TsspWazyZZ` | `google-meet` | Live (v0.1.26+) | (no module yet) |
| Zoho | `ac_ZD0BE4K4d4_k` | `zoho` | Live (v0.1.26+) | (no module yet) |
| Dropbox | `ac_TGJed2YNNnDc` | `dropbox` | Live (v0.1.26+) | (no module yet) |
| HeyGen | `ac_Hijz21nUVjrF` | `heygen` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| You.com | `ac_aWuvnZcjd6tX` | `yousearch` | Live (v0.1.26+) | (no module yet — API key, custom auth, single tool) |
| Retell AI | `ac_u5d8MI-YyetL` | `retellai` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Canva | `ac_xzCsInRgKjKn` | `canva` | Live (v0.1.26+) | (no module yet) |
| Cal.com | `ac_cMIUkG5J3LLW` | `cal-com` | Live (v0.1.26+) | (no module yet) |
| Telnyx | `ac_vZc2Yf4ZUxnF` | `telnyx` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Cloudflare | `ac_BMed_OU09AGb` | `cloudflare` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Reddit | `ac_DRe0X_LmTq1c` | `reddit` | Live (v0.1.26+) | (no module yet) |
| Cloudinary | `ac_lg2rQeIeQO2w` | `cloudinary` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Convex | `ac_xRSPlxHy0E4t` | `convex` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| DockerHub | `ac_3uM6woNxn7XE` | `dockerhub` | Live (v0.1.26+) | (no module yet — API key, custom auth) |
| Excel | `ac_ULSRLz3F653I` | `excel` | Live (v0.1.26+) | (no module yet — Excel Online via MS Graph) |
| Google Maps | `ac_T7MsVHm41uap` | `google-maps` | Live (v0.1.26+) | (no module yet) |

All 26 v0.1.26 Composio connectors are live, each with `is_enabled_for_tool_router: true` and a matching `COMPOSIO_AUTH_<SLUG>` secret in Supabase. (TikTok was dropped — Composio has no managed app and we don't have a TikTok Developer App to plug in.)

**Composio auth-type split (v0.1.26 lesson):** 15 of 26 are OAuth toolkits with managed Composio credentials → `type: "use_composio_managed_auth"`. 11 are API-key toolkits where Composio doesn't ship managed credentials → `type: "use_custom_auth"` + `authScheme: "API_KEY"` (each user provides their own key in the credential modal). The patch step also differs: managed-auth configs PATCH with `type: "default"`, custom-auth configs PATCH with `type: "custom"`. `scripts/setup-new-connectors.ps1` handles the OAuth managed flow; the 11 API-key configs were created via an inline retry batch in the v0.1.26 commit.

**Workspace gotcha (v0.1.26 lesson):** Composio API keys are scoped to a single workspace. An auth_config created with key `K1` is INVISIBLE to a relay running with key `K2`. The relay's master key lives in Supabase secrets as `COMPOSIO_API_KEY` — use *only that key* when creating new auth_configs, even if you have other Composio keys in your possession. We hit this in v0.1.26: created 26 auth_configs with the wrong key, deployed, every `/initiate` 400'd with "Auth_Config_NotFound" because the relay couldn't see them. Fix: re-create with the relay's key, update the secrets. Sanity check: `npx supabase secrets list` shows SHA-256 of each value — hash your candidate key locally and compare with the `COMPOSIO_API_KEY` line before using. **Auth flow split:** OAuth toolkits open the system browser for authorization; **API-key toolkits (Telegram, Firecrawl, Exa, ElevenLabs, HeyGen, You.com, Retell AI, Telnyx, Cloudflare, Cloudinary, Convex, DockerHub)** prompt for the key in a modal and complete synchronously — no browser. See `CONNECTOR_FIELD_REQUIREMENTS` in `ConnectorsScreen.tsx`. The relay's `handleListConnections` + `handleInitiate` + `handleExecuteTool` work for all of them generically — no per-service code paths.

**Connector-scope-lock (v0.1.26+):** the Composio MCP system prompt now ends with a dynamic "you may ONLY reference these services" block. `python/host.py:_get_composio_system_prompt()` calls `workspace.list_connected_service_slugs()` at every spawn and stitches in (a) the full allow-list of 45 known service display names, (b) the subset currently connected for this user. Tells the agent never to suggest Perplexity / Brave / Make.com / Zapier / etc. — anything outside the allow-list. Costs ~250 tokens per spawn but keeps replies on-rails with what AIOS can actually deliver. To grow the allow-list, add to `KNOWN_CONNECTORS` + `CONNECTOR_DISPLAY_NAMES` in `python/workspace.py` (it stays in sync with `CONNECTOR_CATALOG` in `ConnectorsScreen.tsx`).

**Save-as-PDF marker (v0.1.26+):** the agent can save any chat answer as a PDF by ending its reply with `[AIOS_EXPORT_PDF: outputs/<slug>.pdf]`. The renderer detects the marker, calls `export_to_pdf` IPC (in `main/main.ts` — uses `renderMarkdownStringToPdf` from `main/pdf-export.ts`), strips the marker from the displayed text, and adds a downloadable chip under the assistant bubble. Reuses the same offscreen `BrowserWindow.printToPDF` flow already in production for WhatsApp Remote PDF delivery.

**X (Twitter) note:** Composio doesn't provide managed credentials for X — the auth_config was created with `"type": "use_custom_auth"` using the project owner's X Developer App (OAuth 2.0). All users authorize through that single app. X's free tier severely limits read APIs; for full timeline / search / DM access you need X Basic tier ($200/mo).

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

For a clean *workspace* reset (context, chats, plans, outputs — not connectors), use the **Settings → Reset workspace** button in-app. To nuke the entire workspace from outside the app:
- Mac: `rm -rf ~/Library/Application\ Support/aios-desktop/`
- Windows (PowerShell): `Remove-Item -Recurse -Force "$env:APPDATA\aios-desktop"`

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

- **All polling intervals are visibility-gated.** `if (document.visibilityState !== "visible") return;` at the top of every `setInterval` callback. Rates: workspace 60s, connectors heartbeat 120s, auto-tasks 60s, theme-sync 10s.
- **Body class `window-hidden`** is toggled on `visibilitychange`. The CSS rule `body.window-hidden *:after, *:before, * { animation-play-state: paused !important }` pauses every CSS animation when the window isn't visible.
- **Memoized chat rendering**. `MessageMarkdown` (a memo'd ReactMarkdown wrapper) and `CodeBlock` are both `React.memo`. The `components` and `remarkPlugins` props are module-level constants — passing fresh object references would defeat memoization.
- **Voice transcription** ticks at 3.5s (down from 2s) and skips when window is hidden.
- **NO `backdrop-filter: blur(...)` on modal overlays.** Chromium-on-Electron-on-Windows Gaussian-blurs every pixel below the overlay on every frame — over a busy canvas (ReactFlow, chat list) it eats the modal-open frame budget and causes visible stutter. Dim with a slightly higher rgba alpha instead (e.g. `rgba(13,13,13,0.58)`). All existing overlays follow this rule as of v0.1.28 — preserve when adding new ones.
- **Mount-time layout in one frame.** When a screen needs to compute initial positions then `fitView` (or similar 2-step work), use `requestAnimationFrame` rather than chained `setTimeout`s — see `AgentsScreen.tsx`'s first-mount layout reset.

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
    AgentsScreen.tsx       n8n-style ReactFlow canvas (v0.1.28); CEO + specialists tree, drag, double-click prompt editor
    OnboardingScreen.tsx   v2 welcome flow
    SettingsScreen.tsx     Reset onboarding, Claude path, theme
    HistoryScreen.tsx, AutoTasksScreen.tsx, ContextScreen.tsx, etc.
  styles.css               7000+ lines; design tokens at top

supabase/
  functions/aios-relay/index.ts        Relay (5 routes, Composio mediator)
  functions/composio-webhook/index.ts  HMAC-verified webhook receiver
  migrations/0001_init.sql             device_users + device_connections schema
```

## Prerequisites

The app bundles its Python sidecar via PyInstaller, so end users do **not** need Python installed. Claude Code CLI is still checked at startup; if missing, the user sees a clear onboarding path.

| Dep | Min version | Install |
|-----|-------------|---------|
| Claude Code CLI | latest | `npm install -g @anthropic-ai/claude-code` (requires Node) |

The Onboarding "Connect Claude Code" stage handles Claude detection gracefully (auto-detect → Test → manual path). In development, the app still falls back to a system Python interpreter if the PyInstaller sidecar has not been built yet; packaged builds use the bundled sidecar at `<app>/resources/aios-host/`.

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

**Dev mode uses an isolated workspace.** When `app.isPackaged` is false (i.e. `npm run dev`), `main.ts` sets `userData` to `<cwd>/.aios-dev-user-data/` so dev runs never touch the installed app's SQLite or context files. The dev workspace lives at `<cwd>/.aios-dev-user-data/ai-sales-os/`. Because the path is relative to `process.cwd()`, always launch dev from the repo root or you'll get a different workspace each time. The `.aios-dev-user-data/` folder is gitignored.

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

---

## v0.1.19 architecture additions

### First-launch boot performance

The app used to show ~30 s of white window on first launch. v0.1.19 layered three fixes so cold start now feels instant.

1. **Inline boot splash** (`renderer/index.html`) — a sage paper background + italic "aios" mark + spinner + "Loading your workspace…" is hardcoded in the HTML with inline `<style>`. Paints the moment Electron loads the page, well before the React bundle parses. Once React mounts, an effect in `App.tsx` removes `#aios-boot-splash` from the DOM and the in-React splash takes over seamlessly. **Never add an external stylesheet load to index.html** — the whole point is that no resource has to download before something shows.

2. **`show: false` + `ready-to-show`** (`main/main.ts:createWindow`) — the `BrowserWindow` is created hidden and only shown when the first renderer frame is ready. A 1.5 s fallback `setTimeout` shows it anyway if the event somehow doesn't fire. Combined with #1, the window appears already painted — no flash of background-only frame.

3. **Fast workspace bootstrap** (`main/workspace.ts`) — `ensureRuntimeWorkspace()` is now **mkdir-only** (creates `data/` and `logs/` and returns). The heavy `copyDirClean(starterKit → workspace)` was extracted into a separate `backfillStarterKit()` that runs AFTER `ready-to-show` via `setImmediate`. First launch no longer pays ~0.5–2 s of synchronous file I/O on the main process.

4. **IPC critical-path warmup retry** (`renderer/src/App.tsx:refreshWorkspaceCritical`) — the four critical IPC calls (`get_workspace_info`, `get_onboarding_state`, `get_sessions`, `get_setting`) retry silently on failure for up to 15 s. During the Python sidecar's 2–5 s cold boot, IPC calls fail with `HOST_MISSING` — without retry the splash would surface the 10 s "Retry" button before the sidecar even had a chance.

### Auto-update banner (Windows-only)

`renderer/src/components/AutoUpdateBanner.tsx` is a slim top-of-window banner that subscribes to the existing `aios:update-state` events (broadcast from `main/main.ts:385-426`). Three visual states:

- **`available`** — "Update vX.Y.Z available · [Skip] [Download now]". Skip persists to localStorage (`aios.autoUpdate.skippedVersion`) and hides the banner until a newer version is announced.
- **`downloading`** — progress strip + percent. No buttons; electron-updater already auto-downloads on Windows.
- **`ready`** — "Update vX.Y.Z is ready to install · [Later] [Install & restart]". Install calls `aios:install-update` IPC → `autoUpdater.quitAndInstall(true, true)` (silent + auto-relaunch).

**Platform guard:** banner returns `null` on `platform !== "win32"`. Mac (unsigned) keeps the manual "open release page" fallback through Settings → General.

**Boot timing:** banner has zero cost when hidden (returns `null` before any DOM). The auto-update check that drives it already ran after `ready-to-show` even before v0.1.19, so it's never on the critical path.

### Chat-bubble file attachments

`ChatMessage.attachments: ChatAttachment[]` (renderer/src/types.ts) — assistant messages can now carry a list of `{ kind: "plan" | "output", path, filename }`. Rendered as sage file chips under the message body in `CommandScreen.tsx`. Click → App.tsx's `setPendingAttachmentOpen` routes to Plans or Outputs screen and pre-opens that file's preview modal via the screen's new `initialOpenPath` / `onInitialOpenConsumed` props.

Currently only the WhatsApp Remote PDF flow writes attachments to history (`main/whatsapp-scanner.ts:persistToHistory`). The renderer plumbing is generic, so future paths (chat-spawned plans, etc.) just need to populate the field.

### WhatsApp Personal — hardened

The personal WhatsApp Remote (Baileys-based) was rewritten this session for both UX and safety:

**As a Connectors card.** Lives in `CONNECTOR_CATALOG` (`renderer/src/screens/ConnectorsScreen.tsx`) with `localAuth: "baileys-qr"`. The card branch in `connect()` opens `WhatsAppQrModal` instead of going through the relay. The old inline `<WhatsAppScanner />` block at the bottom of the page is gone.

**Locked-down inbound filter** (`main/whatsapp-worker.js`). A message reaches AIOS only when **both** hold: `fromMe === true` (your account sent it) AND `remoteJid` is exactly your own number `@s.whatsapp.net` OR your own LID `@lid`. The old `(isLid && !isContact)` shortcut was catastrophically wrong — on modern WhatsApp every contact has an `@lid`, so outgoing messages to friends were being forwarded to AIOS.

**Locked-down outbound** (`main/whatsapp-worker.js:sendToSelfOnly`). Every `sock.sendMessage` call goes through this single helper, which hardcodes the destination to `<myNumber>@s.whatsapp.net`. The `jid` parameter that used to flow through scanner→worker IPC was deleted entirely. AIOS cannot post to anyone's chat other than your own self-chat, even if a future bug tried to.

**Persistent state files** (in `<userData>/`):
- `wa-my-lid.txt` — the user's own LID, captured from `creds.update`. Persisted so it survives worker restarts even when Baileys hasn't redelivered it. Loaded at worker boot; saved every time it's seen.
- `wa-processed-ids.json` — bounded LRU (cap 500) of `msg.key.id` values that have already been processed. Persisted so a WhatsApp post-reconnect history sync can't replay commands that already ran. Loaded at boot.

Both files are deleted on `whatsapp_stop` so a re-pair under a different account starts clean.

**Haiku for replies** (`main/whatsapp-scanner.ts`). Every `run_task` call from WhatsApp passes `model: "haiku"` — Sonnet/Opus felt broken at 5–15 s latency on a phone with no streaming UI. Haiku 4.5 brings casual replies down to 1–3 s.

**PDF delivery for plans/outputs.** When Claude saves a plan or output during a WhatsApp run (detected via `[AIOS_ARTIFACT: plans/foo.md]` marker in the response), `markdownArtifactToPdf` renders the file via an offscreen `BrowserWindow` + `printToPDF`, and the worker sends it via `sendToSelfOnly({ document: { url: pdfPath }, ... })`. The text reply goes first, then the PDF — like a person dropping a file after typing.

### Installer config (Windows)

`package.json` `build` block:

- `compression: "normal"` (was default LZMA/maximum). Makes the `.exe` self-extract noticeably faster when the user double-clicks. ~5–10 % larger file in exchange.
- `nsis.differentialPackage: false`. Differential block-file generation adds time at both build and install finalization. Disabled until we actually need delta updates.

`INSTALL.md` at the repo root documents the SmartScreen "Click More info → Run anyway" bypass for first-install users — paste-ready for GitHub Release notes.

### Critical files added or rewritten in v0.1.19

```
renderer/src/components/
  AutoUpdateBanner.tsx     NEW — Windows-only update banner, three states
                              + per-version Skip persistence

renderer/src/screens/
  ConnectorsScreen.tsx     Adds WhatsApp Personal card via `localAuth: "baileys-qr"`,
                              WhatsAppQrModal, mergeConnections branch, removed
                              inline WhatsAppScanner block
  CommandScreen.tsx        Renders attachment chips under assistant bubbles
  PlansScreen.tsx          New initialOpenPath + onInitialOpenConsumed props
  OutputsScreen.tsx        Same — deep-linkable file open
  OnboardingScreen.tsx     Skip on Profile routes through Ready (setStage("finish"))
  DailyBriefModal.tsx      "Skip for now" button (calls acknowledge → mark seen)

renderer/index.html        Inline boot splash + paper-bg style (no external CSS)
renderer/src/App.tsx       Boot-splash teardown effect; AutoUpdateBanner mount;
                              IPC warmup retry; pendingAttachmentOpen state

main/whatsapp-worker.js    sendToSelfOnly helper; processedMessageIds + disk
                              persistence; captureMyLid via creds.update; tight
                              fromMe + own-JID filter; document type handler
main/whatsapp-scanner.ts   No-caption PDF delivery; attachment metadata in
                              persistToHistory; model: "haiku"; phoneNumber
                              tracked + broadcast; wa-*.txt cleanup on stop
main/main.ts               BrowserWindow show:false + ready-to-show;
                              backfillStarterKit after window shown;
                              quitAndInstall(true, true) for silent updates
main/workspace.ts          ensureRuntimeWorkspace fast path; backfillStarterKit

package.json               compression: "normal"; nsis.differentialPackage: false
INSTALL.md                 NEW — SmartScreen bypass + first-launch notes
```

### Verification checklist (post-v0.1.19)

- Cold-start the installed app: paper-bg + spinner appears instantly; chat ready within ~3 s
- Connectors page: WhatsApp Personal card appears alongside WhatsApp Business; both can be Connect / Disconnect independently
- Send a message to your own WhatsApp self-chat: reply arrives in 1–3 s; agent chat thread shows the same exchange
- Send a message to a friend on WhatsApp: NO AIOS reply to them, NO leak into the agent chat
- Settings → Reset onboarding: Profile-stage "Skip for now" lands on the Ready summary, not on chat directly
- Daily Brief modal: "Skip for now" dismisses; reopen the app today and the modal does NOT reappear; the brief shows up in the Briefs tab as normal

---

## v0.1.28 — Agents canvas + app-wide perf

### Agents as a top-level screen

`AgentsScreen` (`renderer/src/screens/AgentsScreen.tsx`) was lifted out of Settings into its own sidebar entry (between Modules and Connectors). The old grid was replaced with an **n8n-style ReactFlow canvas** powered by `@xyflow/react`:

- CEO node at the top; built-in specialists laid out in a single horizontal row below, alphabetical; custom agents extend the same row to the right. Edges go straight down from CEO to each child (smoothstep), so no path ever crosses another node.
- Drag any node to rearrange — positions persist in localStorage (`aios.agents.canvas.positions.v3`) for the in-session experience. Every mount of the screen auto-resets to the canonical layout, so navigating away and back gives a clean slate. Drags are session-temporary.
- Double-click a node → opens the existing `AgentDetailDrawer` (prompt editor, reset, delete).
- Top-right floating `+` opens a `CreateAgentModal` (name, role, prompt). The modal includes a **"Generate with Claude" button** that runs the user's rough draft through Claude Haiku to rewrite it as a polished system prompt before saving — uses the existing `run_task` IPC with `model: "haiku"`.
- Bottom-left fit/reorganize button wipes drag positions, recomputes the default tree, and animates a fit-view in one click.
- Hover cursor on nodes is `pointer` (not `grab`) — desktop feel.

The renderer calls four agent IPCs: `list_agents`, `update_agent_prompt`, `reset_agent_prompt`, `delete_agent` (all pre-existing), plus a new `create_custom_agent` IPC wired through all four cross-stack places (`main/types.ts`, `main/preload.ts`, `renderer/src/types.ts`, `python/host.py` dispatch around line 911 — the Python function already existed at `python/agents.py:457`, only the IPC plumbing is new).

### App-wide perf cleanup

The Agents canvas surfaced UI-lag issues that turned out to be app-wide, not specific to the new screen. All fixed in v0.1.28:

- **Killed `backdrop-filter: blur(...)` on every modal overlay (7 places).** Chromium-on-Electron-on-Windows was Gaussian-blurring the entire page below every modal on every frame — over a busy canvas, this dominated the modal-open frame budget and caused visible stutter. Replaced with a small rgba alpha bump (0.04-0.08). Touched: `.daily-brief-overlay`, `.briefs-modal-overlay`, `.detail-modal-overlay` (two definitions), `.confirm-modal-overlay`, `.connector-creds-overlay`, `.wa-modal-overlay`, `.agents-drawer-overlay`. **This is now a hard rule — see Performance discipline.**
- **Theme-sync poll fixed** (`App.tsx:441-451`). Was 2s ungated → 10s + visibility-gated. Eliminates idle IPC churn even when the window is minimized.
- **Agents drawer animation simplified**: dropped the `translateX(32px) → 0` slide, kept opacity-only fade; duration 200ms → 140ms; box-shadow `-16px 0 48px` → `-8px 0 24px` (smaller blur radius = faster paint).
- **AgentsScreen mount sequence collapsed.** Was `setTimeout(80) → setNodes → setTimeout(50) → fitView` (three frames of state churn). Now `requestAnimationFrame(reorganize)` runs in one frame, instant settle.
- **Scoped the global button-press transform.** `button:active { transform: scale(0.98) }` → `.button:active { transform: scale(0.98) }` so it doesn't fire on ReactFlow controls, node action elements, or any non-design-system `<button>`.
- **Removed a dead duplicate `.screen-enter` keyframes block** — two definitions, the second was winning, the first was unused.

After these, modals snap open with no stutter even over the live ReactFlow canvas, and idle CPU drops noticeably.

### Files changed (v0.1.28)

```
renderer/src/App.tsx              Sidebar NavItem for Agents; theme poll fix; AgentsScreen prop wiring
renderer/src/screens/AgentsScreen.tsx
                                  Full rewrite: ReactFlow canvas, tree layout, drag persistence,
                                  Create modal with "Generate with Claude", reorganize button
renderer/src/screens/SettingsScreen.tsx
                                  Removed the now-redundant Team/Agents section + prop wiring
renderer/src/styles.css           Removed backdrop-filter from 7 overlays; tightened Agents drawer
                                  animation; scoped .button:active transform; cleanup
main/types.ts                     +create_custom_agent in AiosCommand union
main/preload.ts                   +create_custom_agent in allowlist
renderer/src/types.ts             +create_custom_agent mirror
python/host.py                    +create_custom_agent dispatch entry (Python function pre-existed)
package.json                      +@xyflow/react dependency; version 0.1.27 → 0.1.28
```

---

## v0.2.0 — Voice Control (speak → Claude sees screen → executes actions)

A TipTour-inspired voice loop that lets the user speak a command and have Claude drive the cursor + keyboard to fulfil it across any app. Mac-first design (eventual Swift sidecar with native AX tree); Windows ships as the production path today via the Python sidecar + UIAutomation.

### How it works

```
User clicks the Voice button (bottom-left of sidebar) OR presses Ctrl+Alt+V global hotkey
  → renderer captures mic via existing AudioContext + transcribe_audio IPC
  → transcript posted to voice_control_start IPC (main/voice-control.ts)
  → orchestrator loops:
      capture_screen + screen_ax_tree (parallel)
      → run_task with screenshot path + AX summary + system prompt
      → parse one [SENTINEL: ...] action from Claude's reply
      → execute via voice_click / voice_type / voice_hotkey / voice_open / etc.
      → repeat until [DONE] / [BLOCKED] / max turns
  → on [DONE], take a fresh screenshot and run an INDEPENDENT verifier call;
    only accept DONE if verifier says [VERIFIED: ...]; otherwise convert to BLOCKED
```

### Critical design choices

- **Universal evidence pattern (no hardcoded task categories).** Claude declares a `SUCCESS_CRITERION:` on turn 1 — a specific, falsifiable, visible-on-screen condition derived from the user's request. Every subsequent turn checks the screen against the criterion. Before [DONE], a server-side verifier independently derives ITS OWN criterion from the user's transcript and rechecks the fresh screenshot. False [DONE] is treated as the worst possible outcome.
- **Action sentinels** Claude can emit (parsed by `main/voice-control.ts:SENTINEL_RE`):
  `[OPEN]`, `[CLICK]` (with `target_id` or `x,y`, `button`, `clicks`), `[TYPE]` (with `clear`), `[HOTKEY]`, `[SCROLL]`, `[MOVE]`, `[DRAG]`, `[CLIPBOARD_SET]`, `[CLIPBOARD_GET]`, `[WAIT]`, `[CONTINUE]`, `[DONE]`, `[BLOCKED]`.
- **AX tree resolution (Windows).** Each turn fetches up to 200 elements from the focused window via the `uiautomation` Python lib, summarises the top 40 by area into the prompt (`[14] ButtonControl "Submit" @ 480,320 200x40`). Claude prefers `[CLICK: target_id=14]` (resolved to bounds-center) over guessing pixel coords. Walked at depth 8 with a 1.5s time budget. **Mac falls back to pure vision** until the Swift sidecar lands.
- **Smart app launching.** `voice_open` is a layered fallback chain:
  1. PowerShell `Get-StartApps` (for any app-name target — Spotify, Discord, WhatsApp, anything in the Start menu). AppID may be an AUMID or a file path — script branches on which.
  2. `cmd /c start "" <target>` (URLs, file paths, `ms-settings:`).
  3. `os.startfile`, then direct `Popen` as last resorts.
  On Mac: `open -a <name>` → `open <url>` → `open -b <bundleId>`.
  After a successful Windows launch, `_win_bring_to_foreground` does the `AttachThreadInput + SetForegroundWindow + BringWindowToTop` dance to bring the new window forward so Claude doesn't burn a turn clicking the taskbar.
- **Multi-monitor capture.** `screen_capture` defaults to `monitor: "active"` — uses `GetForegroundWindow` + `MonitorFromWindow` to capture the screen the user is actually working on. Other modes: `"primary"`, `"all"`, numeric index. Powered by `mss` (already a transitive dep of pyautogui).
- **Dynamic turn budget.** Defaults to 16 turns. Claude can emit `[CONTINUE: reason="..."]` for +8 more (hard cap 32). The panel shows current/max.
- **Repeat-action detection** (orchestrator). Each action is hashed to a normalized fingerprint (CLICK coords bucketed to 40-pixel cells, etc.). Second identical action → ⚠ warning injected into next prompt telling Claude to try a different approach. Third → loop aborts as BLOCKED. Kills the click-thrash failure mode.
- **Per-action settle.** OPEN waits 1000ms before the next screenshot (apps need time to draw), DRAG 250ms, everything else 120ms.
- **Hover-reveal UI guidance.** The prompt documents the `MOVE → CLICK` pattern for apps with hover-only action buttons (Spotify rows, YouTube tiles, GitHub PR rows, Linear, Gmail message rows, file-manager inline actions). Claude reaches for MOVE first instead of clicking phantom coords.
- **Trigger surface.** Bottom-left Voice button in the sidebar footer (`renderer/src/App.tsx`); the same panel also opens via Ctrl+Alt+V global hotkey registered in `main/main.ts` (followed precedent of `Cmd+,` for preferences). Mac uses CommandOrControl+Alt+V; same UX. Panel shows live transcript, thinking/executing state, the action being executed (with target_id or coords), and a Stop button.

### Action sentinel grammar (system prompt teaches all this)

```
[OPEN: target="<app/URL/path/protocol>"]
[CLICK: target_id=N, label="..."]     // preferred when AX tree has the element
[CLICK: x=NUM, y=NUM, label="...", button="left|right|middle", clicks=1|2|3]
[TYPE: text="...", clear=true]        // clear=true wipes field first (Ctrl+A, Del)
[HOTKEY: keys="ctrl+shift+t"]
[SCROLL: dy=NUM]
[MOVE: x=NUM, y=NUM, duration=0.2]    // hover without clicking
[DRAG: x1=, y1=, x2=, y2=, button=, duration=]
[CLIPBOARD_SET: text="..."] + [HOTKEY: keys="ctrl+v"]   // fast paste for long text
[CLIPBOARD_GET]                       // result fed back into next turn's notes
[WAIT: seconds=N]                     // ≤ 5s per call
[CONTINUE: reason="..."]              // grants +8 turns (cap 32)
[DONE: summary]
[BLOCKED: reason]
```

### Release gate (prevents broken sidecar shipping)

After v0.2.0 ran into a "every page shows NameError" incident — caused by editing `host.py` and accidentally deleting a function whose name was still referenced in the `dispatch` dict — the release workflow now runs `npm run check` (full TS build + JS/TS unit tests + Python sidecar tests including `test_dispatch_handlers_all_resolve`) BEFORE PyInstaller starts packaging. A broken `host.py` fails CI before any installer is uploaded. See `.github/workflows/release.yml` + `tests/host_test.py:test_dispatch_handlers_all_resolve`.

### Files (v0.2.0)

```
main/voice-control.ts              NEW — orchestration loop, sentinel parser, AX-tree
                                   summariser, action fingerprinting, evidence verifier
main/main.ts                       +mainHandledCommands for voice_control_*; globalShortcut
                                   Ctrl+Alt+V; globalShortcut.unregisterAll() on quit
main/types.ts                      +voice_* IPC commands
main/preload.ts                    +voice_* + onShortcutVoiceToggle
renderer/src/types.ts              mirror union
renderer/src/screens/VoiceControlPanel.tsx
                                   NEW — bottom-left floating panel: mic capture, transcript
                                   display, action labels, abort button
renderer/src/App.tsx               +Voice button in sidebar footer; toggleSignal state;
                                   Ctrl+Alt+V handler bumps the signal
renderer/src/styles.css            +.voice-panel-* (bottom-left fixed positioning);
                                   +.aios-sidebar-voice
python/host.py                     +screen_capture (with monitor= arg + Win32 active-monitor
                                   detection); +screen_ax_tree (uiautomation walker);
                                   +voice_click/type/hotkey/scroll/move/open/drag;
                                   +voice_clipboard_get/set; +voice_wait;
                                   +_win_launch_via_start_apps (PS Get-StartApps);
                                   +_win_bring_to_foreground (post-launch focus);
                                   run_task accepts imagesBase64 → temp PNG → injected path
python/requirements.txt            +pyautogui, +Pillow, +uiautomation (Windows-only)
build/aios-host.spec               +hidden imports for pyautogui, mss, PIL, uiautomation, comtypes
tests/host_test.py                 +test_dispatch_handlers_all_resolve (catches NameError-on-
                                   dispatch class of bug before it ships)
.github/workflows/release.yml      +Release gate step: npm run check BEFORE build:python
package.json                       version 0.1.28 → 0.2.0
```

### Out of scope (deferred to v0.3+)

- Mac Swift sidecar with native AX tree (needs a Mac to build/test). Mac users today get pyautogui-only fallback — clicks/types work, AX tree-grounded clicks don't.
- Set-of-Mark overlay (numbered green boxes drawn on the screenshot from AX bounds). Planned but punted to keep this release focused.
- Browser CDP integration for richer DOM access on web apps.
- OCR fallback for apps that expose no UIA tree.

---

## v0.2.1 — Floating FAB + safety hardening

First phase of the TipTour-parity roadmap. Small, focused release.

**Ships:**
- **Right-edge floating FAB** (`renderer/src/components/VoiceFAB.tsx`) — single always-visible entry point for Computer Control. Sidebar "Control" button removed; only Settings remains in the sidebar footer. Hotkey Ctrl+Alt+V still opens the same panel.
- **Operation tokens** in the voice loop. Every `startVoiceLoop` mints a fresh UUID; `publishState` calls are wrapped in a `publish` closure that drops if `runId !== currentRunId`. Stale callbacks from a prior run (settle-timer fires, in-flight async) can't paint the panel for the next run.
- **Pause on user app-switch.** Between every turn, `voice_check_environment` probes the foreground process. If it's not the baseline app for 2 consecutive polls (debounced — kills toast/notification false positives), the loop blocks with "Paused — you switched to <app>." Baseline re-captured at end of each turn so Claude's own intentional `[OPEN: ...]` doesn't trigger the safety net.
- **Modal detection.** Same probe checks for `WindowPattern.IsModal` on top-level windows owned by the foreground process. If a modal dialog appears mid-workflow, the loop blocks with "A modal dialog appeared — pausing so you can handle it."
- **AX prewarm + 2s cache.** `startVoiceLoop` fires a fire-and-forget `screen_ax_tree` call before `runLoop` starts. Python caches the result for 2s keyed by walk args, so the first turn's parallel ax call reuses the warm walk instead of paying cold COM init.

**New IPC: `voice_check_environment`** (Win-only; Mac returns `{available: false}` until v0.5.0 lands Mac AX). Returns `{foreground_app, foreground_title, foreground_pid, modal_present}`. Process name resolved via `OpenProcess` + `QueryFullProcessImageNameW` (ctypes, no subprocess). Modal detection iterates root children matching pid + checks `GetWindowPattern().IsModal`.

**Files changed:**
```
renderer/src/components/VoiceFAB.tsx    NEW — right-edge floating FAB (~30 lines)
renderer/src/App.tsx                    Removed sidebar Control button block; mount <VoiceFAB/>;
                                        dropped Bot import (FAB owns it now)
renderer/src/styles.css                 .aios-sidebar-voice → .voice-fab (fixed right-mid, circular)
main/voice-control.ts                   randomUUID runId + currentRunId guard; publish() wrapper;
                                        foreground/modal probe between turns; baseline re-capture
                                        at end of each turn; prewarm screen_ax_tree at run start
main/types.ts / preload.ts              +voice_check_environment in AiosCommand union + allowlist
renderer/src/types.ts                   mirror
python/host.py                          +voice_check_environment (Win UIA + ctypes process name +
                                        WindowPattern IsModal scan); +2s TTL cache on screen_ax_tree
package.json                            version 0.2.0 → 0.2.1
```

**Verification:**
- FAB visible from every screen (chat, connectors, agents, settings, etc.). Click toggles panel.
- Sidebar footer now only has Settings.
- Start a long voice task (e.g. *"Open Notepad, write a haiku, save it"*). Cmd-Tab to Chrome mid-execution → after ~2 turn polls, panel shows "Paused — you switched to chrome.exe."
- Trigger a modal mid-task (e.g. say *"Quit Notepad without saving"* with unsaved changes) → panel pauses with "A modal dialog appeared".
- Open the panel quickly while a prior task is mid-loop → no stale state from old run leaks into the new panel state.

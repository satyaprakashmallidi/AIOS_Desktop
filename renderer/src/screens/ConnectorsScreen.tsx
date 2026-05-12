import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Calendar,
  Check,
  CheckSquare,
  CreditCard,
  ExternalLink,
  FileText,
  Github,
  Inbox,
  Linkedin,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Plug,
  Plus,
  Sheet,
  X,
  Youtube
} from "lucide-react";
import { relay, RELAY_AVAILABLE, RelayError, type RelayConnection } from "../lib/aios-relay";
import { invoke, newId } from "../lib/api";
import type { ClaudeStatus } from "../types";

type ConnectorStatus = "connected" | "not_connected" | "connecting" | "error" | "expired" | "stalled";

interface Connector {
  service: string;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number }>;
  logoUrl?: string;
  comingSoon?: boolean;
}

const CONNECTOR_CATALOG: Connector[] = [
  {
    service: "gmail",
    label: "Gmail",
    description: "Read your inbox, draft replies, find threads, send mail.",
    Icon: Mail,
    logoUrl: "https://api.iconify.design/logos:google-gmail.svg"
  },
  {
    service: "google-calendar",
    label: "Google Calendar",
    description: "See your schedule, find free slots, create events.",
    Icon: Calendar,
    logoUrl: "https://api.iconify.design/logos:google-calendar.svg"
  },
  {
    service: "slack",
    label: "Slack",
    description: "Read channels, post messages, search conversations.",
    Icon: MessageSquare,
    logoUrl: "https://api.iconify.design/logos:slack-icon.svg"
  },
  {
    service: "clickup",
    label: "ClickUp",
    description: "Create tasks, update statuses, query lists.",
    Icon: CheckSquare,
    logoUrl: "https://svgl.app/library/clickup.svg"
  },
  {
    service: "notion",
    label: "Notion",
    description: "Read pages, search databases, append blocks.",
    Icon: FileText,
    logoUrl: "https://api.iconify.design/logos:notion.svg"
  },
  {
    service: "github",
    label: "GitHub",
    description: "Browse repos, read issues, open PRs.",
    Icon: Github,
    logoUrl: "https://api.iconify.design/logos:github-icon.svg"
  },
  {
    service: "stripe",
    label: "Stripe",
    description: "Payments, subscriptions, customers, charges, MRR.",
    Icon: CreditCard,
    logoUrl: "https://api.iconify.design/logos:stripe.svg"
  },
  {
    service: "youtube",
    label: "YouTube",
    description: "Channel stats, video performance, subscriber growth.",
    Icon: Youtube,
    logoUrl: "https://api.iconify.design/logos:youtube-icon.svg"
  },
  {
    service: "google-analytics",
    label: "Google Analytics",
    description: "Site traffic, conversion, audience metrics from GA4.",
    Icon: BarChart3,
    logoUrl: "https://api.iconify.design/logos:google-analytics.svg"
  },
  {
    service: "google-sheets",
    label: "Google Sheets",
    description: "Read structured data from sheets you own.",
    Icon: Sheet,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ae/Google_Sheets_2020_Logo.svg"
  },
  // Communication / social connectors (v0.1.11+)
  {
    service: "outlook",
    label: "Outlook",
    description: "Read mail, draft replies, search threads, manage your inbox.",
    Icon: Inbox,
    logoUrl: "https://api.iconify.design/logos:microsoft-icon.svg"
  },
  {
    service: "linkedin",
    label: "LinkedIn",
    description: "Read your profile, post updates, browse connections.",
    Icon: Linkedin,
    logoUrl: "https://api.iconify.design/logos:linkedin-icon.svg"
  },
  {
    service: "whatsapp",
    label: "WhatsApp",
    description: "Send WhatsApp Business messages, manage templates, read profile.",
    Icon: MessageCircle,
    logoUrl: "https://api.iconify.design/logos:whatsapp-icon.svg"
  }
];

// Connectors that require extra user-provided fields BEFORE OAuth can start.
// Composio surfaces these via auth_config.expected_input_fields. The renderer
// pops a small modal asking for the values and forwards them to the relay as
// `{ authScheme, val: { ...fields } }` on /initiate.
interface FieldRequirement {
  key: string;            // exact key Composio expects under state.val (e.g. "generic_id")
  label: string;          // human label shown in the modal
  placeholder: string;
  description: string;    // shown directly under the input
  helpText: string;       // longer "where do I find this?" hint at the bottom
  helpLink?: string;
}

const CONNECTOR_FIELD_REQUIREMENTS: Record<string, { authScheme: string; fields: FieldRequirement[] }> = {
  whatsapp: {
    authScheme: "OAUTH2",
    fields: [
      {
        key: "generic_id",
        label: "WhatsApp Business Account ID",
        placeholder: "e.g. 102553451781234",
        description: "Numeric WhatsApp Business Account (WABA) ID issued by Meta when your WhatsApp Business API was approved.",
        helpText:
          "Open Meta Business Manager → Business settings → Accounts → WhatsApp accounts. Pick your account; the WABA ID is shown at the top. " +
          "If you don't have one yet, you'll need to apply through Meta Business Suite — WhatsApp connector only supports approved WhatsApp Business accounts (not personal WhatsApp).",
        helpLink: "https://business.facebook.com/settings/whatsapp-business-accounts",
      },
    ],
  },
};

interface ConnectorView extends Connector {
  status: ConnectorStatus;
  accountLabel?: string;
  connectionId?: string;
  errorMessage?: string;
}

function mergeConnections(
  catalog: Connector[],
  live: RelayConnection[],
  stalled: Set<string>,
  localLabels: Record<string, string>
): ConnectorView[] {
  const byService = new Map(live.map((c) => [c.service, c]));
  return catalog.map((entry) => {
    const found = byService.get(entry.service);
    if (!found) {
      return { ...entry, status: "not_connected" as ConnectorStatus };
    }
    let status: ConnectorStatus;
    if (found.status === "connected") status = "connected";
    else if (found.status === "expired") status = "expired";
    else if (found.status === "error") status = "error";
    else if (stalled.has(entry.service)) status = "stalled";
    else status = "connecting";
    return {
      ...entry,
      status,
      accountLabel: localLabels[entry.service] ?? found.account_label ?? undefined,
      connectionId: found.composio_connection_id
    };
  });
}

export function ConnectorsScreen({ deviceUserId, claude }: { deviceUserId: string; claude: ClaudeStatus | null }) {
  const [identifying, setIdentifying] = useState<Set<string>>(new Set());
  const [localLabels, setLocalLabels] = useState<Record<string, string>>({});
  const identifyAttemptedRef = useRef<Set<string>>(new Set());

  // Ask Claude to identify the connected account's email. Composio's REST API
  // redacts every identity field, but Claude (via the Composio MCP tool router)
  // can call a service-specific tool and extract the email from the result.
  //
  // SPEED: prompts pre-specify the Composio tool slug so Claude skips the
  // COMPOSIO_SEARCH_TOOLS roundtrip. Combined with model: "haiku" override,
  // identify went from ~10s to ~3-4s per service.
  async function identifyAccount(service: string) {
    if (!claude?.path || !claude.runtimeOk) return;
    if (identifyAttemptedRef.current.has(service)) return;
    identifyAttemptedRef.current.add(service);
    setIdentifying((s) => new Set(s).add(service));
    try {
      const prompts: Record<string, string> = {
        gmail: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GMAIL_FETCH_EMAILS" and arguments {"query": "in:sent", "max_results": 1}. Read the "From" header of the returned message — that address is the account owner. Reply with ONLY the bare email, nothing else. If the result has no messages, reply: UNKNOWN.`,
        "google-calendar": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLECALENDAR_LIST_CALENDARS" and arguments {}. Find the calendar where "primary" is true — its "id" is the user's email. Reply with ONLY the bare email, nothing else. If no primary calendar, reply: UNKNOWN.`,
        slack: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "SLACK_LIST_ALL_SLACK_TEAM_CHANNELS_WITH_VARIOUS_FILTERS" and arguments {"types": "public_channel", "limit": 1}. From the response, read team_id. Then call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL with tool_slug "SLACK_RETRIEVE_TEAM_PROFILE_DETAILS" and arguments {"team": team_id_from_step_1}. Reply with the team's "name" field — that's the workspace name. ONLY the workspace name, nothing else. If unsure, reply: UNKNOWN.`,
        clickup: `Reply with the single word: UNKNOWN`,
        notion: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "NOTION_GET_ABOUT_ME" and arguments {}. Find the user's email (often at bot.owner.user.person.email) or workspace name. Reply with ONLY the bare email or workspace name, nothing else. If unsure, reply: UNKNOWN.`,
        github: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GITHUB_GET_THE_AUTHENTICATED_USER" and arguments {}. Read the "email" field. If null, use "@" + the "login" field. Reply with ONLY the bare email or @login, nothing else. If unsure, reply: UNKNOWN.`,
        stripe: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "STRIPE_RETRIEVE_BALANCE" and arguments {}. Read available[0].currency (uppercased). Reply with "Stripe (CURRENCY)" — e.g. "Stripe (USD)". ONLY that, nothing else. If unsure, reply: UNKNOWN.`,
        youtube: `Reply with the single word: UNKNOWN`,
        "google-analytics": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLE_ANALYTICS_LIST_ACCOUNTS" and arguments {}. Find the first account's "displayName". Reply with ONLY that name, nothing else. If no accounts, reply: UNKNOWN.`,
        "google-sheets": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLESHEETS_SEARCH_SPREADSHEETS" and arguments {"query": "", "page_size": 1}. Find the owner's emailAddress in the first result's "owners[0].emailAddress" field. Reply with ONLY that bare email, nothing else. If unsure, reply: UNKNOWN.`,
        outlook: `Reply with the single word: UNKNOWN`,
        linkedin: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "LINKEDIN_GET_MY_INFO" and arguments {}. Read the profile's name. Reply with ONLY the name, nothing else. If unsure, reply: UNKNOWN.`,
        whatsapp: `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "WHATSAPP_GET_PHONE_NUMBERS" and arguments {}. From the first phone number in the response, read its "verified_name" field (the WhatsApp Business display name). Reply with ONLY that name, nothing else. If unsure, reply: UNKNOWN.`
      };
      const prompt = prompts[service] ?? "Reply with: UNKNOWN";
      const res = await invoke<{ response: string }>("run_task", {
        prompt,
        claudePath: claude.path,
        streamId: newId("identify"),
        // Haiku for identify — one-tool-call extraction, ~3x faster than Sonnet/Opus.
        model: "haiku",
      });
      const raw = (res?.response || "").trim();
      const emailMatch = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const handleMatch = raw.match(/@[A-Za-z0-9_.-]{2,}/);
      const label =
        emailMatch?.[0] ||
        (handleMatch?.[0] && !raw.toUpperCase().includes("UNKNOWN") ? handleMatch[0] : null);
      if (label) {
        setLocalLabels((cur) => ({ ...cur, [service]: label }));
        await invoke("set_setting", { key: `connector_label_${service}`, value: label }).catch(() => undefined);
      }
    } catch {
      // Non-fatal — card just shows "Connected" without the email.
    } finally {
      setIdentifying((s) => {
        const next = new Set(s);
        next.delete(service);
        return next;
      });
    }
  }

  // Hydrate local labels from the settings DB on first mount so we don't
  // re-spawn a Claude task on every refresh. Parallel batch — 12 sequential
  // IPC roundtrips would cost ~1-2s on cold open; Promise.all collapses that
  // into a single round-trip wall time (~150ms).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const services = CONNECTOR_CATALOG.filter((c) => !c.comingSoon).map((c) => c.service);
        const results = await Promise.all(
          services.map((service) =>
            invoke<{ key: string; value: string | null }>("get_setting", { key: `connector_label_${service}` })
              .then((r) => [service, r?.value] as const)
              .catch(() => [service, null] as const)
          )
        );
        if (cancelled) return;
        const stored: Record<string, string> = {};
        for (const [service, value] of results) {
          if (value) stored[service] = value;
        }
        if (Object.keys(stored).length > 0) {
          setLocalLabels((cur) => ({ ...stored, ...cur }));
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [liveConnections, setLiveConnections] = useState<RelayConnection[]>([]);
  const [busyService, setBusyService] = useState<string | null>(null);
  const [stalledServices, setStalledServices] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [credsModalService, setCredsModalService] = useState<string | null>(null);
  // Each entry tracks an active poll so cancel can abort + clean up the right row.
  const activePollsRef = useRef<Map<string, { aborted: boolean; connectionId: string }>>(new Map());

  const connectors = useMemo(
    () => mergeConnections(CONNECTOR_CATALOG, liveConnections, stalledServices, localLabels),
    [liveConnections, stalledServices, localLabels]
  );
  const connectedCount = useMemo(() => connectors.filter((c) => c.status === "connected").length, [connectors]);
  const totalActive = useMemo(() => connectors.filter((c) => !c.comingSoon).length, [connectors]);

  const hasSyncedMcpRef = useRef(false);

  async function refresh() {
    try {
      const res = await relay.listConnections(deviceUserId);
      setLiveConnections(res.connections);
      setError(null);
      // First time we see any active connection on this page-load, push the
      // MCP config to Claude. Idempotent thereafter; pollForConnect re-syncs
      // when a brand-new connection lands. Both run as background work so
      // they never block rendering.
      // Always re-sync the MCP URL when we observe any connected service.
      // Composio's `composio.create(userId)` may return a fresh session URL
      // tied to the latest tokens; if we don't re-fetch, Claude can end up
      // pointed at a stale session bound to an old/wrong OAuth account.
      if (res.connections.some((c) => c.status === "connected")) {
        hasSyncedMcpRef.current = true;
        window.setTimeout(() => { void syncMcpToClaude(); }, 0);
      }
      // For any newly-connected service without a local label, ask Claude to
      // identify the account. Short delay (250ms) so syncMcpToClaude's file
      // write has settled before identify spawns — was 1500ms, but the Mac
      // strict-mcp-config path doesn't actually need that long.
      for (const c of res.connections) {
        if (c.status === "connected" && !localLabels[c.service]) {
          window.setTimeout(() => { void identifyAccount(c.service); }, 250);
        }
      }
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!RELAY_AVAILABLE) {
      setError("Connectors backend is not configured. Set VITE_AIOS_RELAY_URL in renderer/.env and restart the dev server.");
      setLoading(false);
      return;
    }
    if (!deviceUserId) return;
    refresh();
    // Heartbeat refresh only when the page is actually visible. Connectors
    // page state rarely changes outside the active OAuth poll window, so
    // 2-minute cadence is plenty for catching webhook-driven status flips.
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refresh();
    }, 120_000);
    return () => {
      window.clearInterval(heartbeat);
      for (const guard of activePollsRef.current.values()) guard.aborted = true;
      activePollsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceUserId]);

  function clearStalled(service: string) {
    setStalledServices((current) => {
      if (!current.has(service)) return current;
      const next = new Set(current);
      next.delete(service);
      return next;
    });
  }

  async function syncMcpToClaude() {
    // Pull the current Composio MCP session config and merge it into Claude
    // Code's settings.json. Called every time a connection completes so Claude
    // sees the latest tool router on its next launch.
    try {
      const cfg = await relay.getMcpConfig(deviceUserId);
      // The relay returns { mcp: {type, url, headers, ...}, ... }.
      const mcpEntry = (cfg as any).mcp ?? null;
      if (!mcpEntry) return;
      await invoke("update_claude_mcp", { name: "composio", config: mcpEntry });
    } catch {
      // Non-fatal — the connection still works, the user just won't have
      // Claude tools wired up until the next time we try.
    }
  }

  async function pollForConnect(service: string, connectionId: string) {
    // Cancel any prior poll for this same service.
    const prior = activePollsRef.current.get(service);
    if (prior) prior.aborted = true;
    const guard = { aborted: false, connectionId };
    activePollsRef.current.set(service, guard);

    const deadline = Date.now() + 90_000; // 90s window
    while (Date.now() < deadline && !guard.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (guard.aborted) return;
      try {
        const res = await relay.listConnections(deviceUserId);
        setLiveConnections(res.connections);
        const found = res.connections.find((c) => c.service === service);
        if (found?.status === "connected") {
          activePollsRef.current.delete(service);
          // Connection landed: push MCP config to Claude first (so identify
          // has Gmail tools available), then ask Claude to identify the
          // connected account email.
          await syncMcpToClaude();
          window.setTimeout(() => { void identifyAccount(service); }, 1500);
          return;
        }
      } catch {
        // Keep polling; transient errors recover.
      }
    }
    // Reached deadline without success → mark stalled so user sees Retry/Cancel.
    if (!guard.aborted) {
      setStalledServices((current) => new Set(current).add(service));
      activePollsRef.current.delete(service);
    }
  }

  async function connect(service: string) {
    // Services that need user-provided fields (e.g. WhatsApp WABA ID) get a
    // credentials modal first; the actual initiate happens in submitCreds().
    if (CONNECTOR_FIELD_REQUIREMENTS[service]) {
      setError(null);
      clearStalled(service);
      setCredsModalService(service);
      return;
    }
    setBusyService(service);
    setError(null);
    clearStalled(service);
    try {
      const { redirectUrl, connectionId } = await relay.initiate(deviceUserId, service);
      const open = await window.aios.openExternal(redirectUrl);
      if (!open.ok) throw new Error(open.error || "Failed to open external browser");
      await refresh();
      pollForConnect(service, connectionId);
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  async function submitCreds(service: string, values: Record<string, string>) {
    const requirements = CONNECTOR_FIELD_REQUIREMENTS[service];
    if (!requirements) return;
    setCredsModalService(null);
    setBusyService(service);
    setError(null);
    try {
      const { redirectUrl, connectionId } = await relay.initiate(deviceUserId, service, {
        authScheme: requirements.authScheme,
        val: values,
      });
      const open = await window.aios.openExternal(redirectUrl);
      if (!open.ok) throw new Error(open.error || "Failed to open external browser");
      await refresh();
      pollForConnect(service, connectionId);
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  // Cancel works in two cases:
  //   1. Polling for completion → stop the poll AND tell Composio to drop
  //      the pending account so retry can start fresh.
  //   2. Stalled state → same cleanup, just no poll to stop.
  // Optimistic UI: flip the card back to not_connected immediately so the
  // user gets instant feedback. The 3 chained network calls (listConnections
  // → disconnect → refresh) run in the background. If a probe later finds
  // that the OAuth actually succeeded mid-cancel, refresh restores it.
  async function cancel(service: string, connectionId?: string) {
    setError(null);
    // Stop the active poll first so it can't write back into liveConnections.
    const guard = activePollsRef.current.get(service);
    if (guard) {
      guard.aborted = true;
      activePollsRef.current.delete(service);
    }
    // Optimistic: instant visual feedback — drop the pending row + stalled flag.
    const previousConnections = liveConnections;
    setLiveConnections((current) => current.filter((c) => c.service !== service));
    clearStalled(service);
    // Network cleanup runs in the background.
    void (async () => {
      try {
        if (connectionId) {
          await relay.disconnect(deviceUserId, connectionId).catch(() => undefined);
        }
        // Re-sync with relay to catch the edge case where OAuth completed
        // simultaneously — refresh will restore the row as "connected" if so.
        const fresh = await relay.listConnections(deviceUserId);
        setLiveConnections(fresh.connections);
      } catch (err) {
        // Roll back optimistic update on hard failure so the user can retry.
        setLiveConnections(previousConnections);
        const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
  }

  async function retry(service: string, connectionId?: string) {
    // Same cleanup as cancel, but re-initiates immediately afterwards. Must
    // await the disconnect inline (instead of fire-and-forget) so the upsert
    // in handleInitiate doesn't race a pending DELETE on the same row.
    const guard = activePollsRef.current.get(service);
    if (guard) {
      guard.aborted = true;
      activePollsRef.current.delete(service);
    }
    setLiveConnections((current) => current.filter((c) => c.service !== service));
    clearStalled(service);
    if (connectionId) {
      await relay.disconnect(deviceUserId, connectionId).catch(() => undefined);
    }
    await connect(service);
  }

  async function disconnect(service: string, connectionId?: string) {
    setBusyService(service);
    setError(null);
    // Optimistically clear the card right away so the user sees feedback.
    // If the relay roundtrip fails, the heartbeat will repopulate it.
    const previousConnections = liveConnections;
    setLiveConnections((current) => current.filter((c) => c.service !== service));
    setLocalLabels((cur) => {
      const next = { ...cur };
      delete next[service];
      return next;
    });
    identifyAttemptedRef.current.delete(service);
    try { await invoke("set_setting", { key: `connector_label_${service}`, value: "" }); }
    catch { /* non-fatal */ }
    try {
      if (connectionId) {
        await relay.disconnect(deviceUserId, connectionId);
      }
      const res = await relay.listConnections(deviceUserId);
      setLiveConnections(res.connections);
      // If no connections remain, remove the MCP entry from Claude's settings
      // so the next chat doesn't try to talk to a dead tool router.
      if (!res.connections.some((c) => c.status === "connected")) {
        try { await invoke("update_claude_mcp", { name: "composio", config: null }); }
        catch { /* non-fatal */ }
        hasSyncedMcpRef.current = false;
      }
    } catch (err) {
      // Roll back the optimistic update so the user can see the connection is
      // still there and retry. Surface the error.
      setLiveConnections(previousConnections);
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  return (
    <section className="connectors-screen">
      <div className="connectors-shell">
        <header className="connectors-hero">
          <div className="connectors-hero-text">
            <p className="layer-badge"><span className="layer-dot" aria-hidden="true" />Layer · Connectors</p>
            <h1>Your <em>connections</em></h1>
            <p className="connectors-hero-detail">
              Plug your services in once. Claude can read and act on them inside any chat — no custom prompts, no copy-paste.
            </p>
          </div>
          <div className="connectors-overview">
            <Plug size={13} />
            <span><strong>{connectedCount}</strong> / {totalActive} connected</span>
          </div>
        </header>

        {error ? (
          <div className="connectors-error">
            <strong>Connectors error:</strong> {error}
          </div>
        ) : null}

        {loading && liveConnections.length === 0 ? (
          <div className="connectors-status-pill">
            <Loader2 size={14} className="spin" />
            <span>Syncing with relay…</span>
          </div>
        ) : null}
        <div className="connectors-grid">
          {connectors.map((connector) => (
              <ConnectorCard
                key={connector.service}
                connector={connector}
                isBusy={busyService === connector.service}
                isIdentifying={identifying.has(connector.service)}
                onConnect={() => connect(connector.service)}
                onCancel={() => cancel(connector.service, connector.connectionId)}
                onRetry={() => retry(connector.service, connector.connectionId)}
                onDisconnect={() => disconnect(connector.service, connector.connectionId)}
              />
            ))}
          </div>
      </div>
      {credsModalService && CONNECTOR_FIELD_REQUIREMENTS[credsModalService] && (
        <ConnectorCredsModal
          service={credsModalService}
          label={CONNECTOR_CATALOG.find((c) => c.service === credsModalService)?.label || credsModalService}
          requirements={CONNECTOR_FIELD_REQUIREMENTS[credsModalService]}
          onCancel={() => setCredsModalService(null)}
          onSubmit={(values) => submitCreds(credsModalService, values)}
        />
      )}
    </section>
  );
}

function ConnectorCredsModal({
  service,
  label,
  requirements,
  onCancel,
  onSubmit,
}: {
  service: string;
  label: string;
  requirements: { authScheme: string; fields: FieldRequirement[] };
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const allFilled = requirements.fields.every((f) => (values[f.key] ?? "").trim().length > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allFilled) return;
    const trimmed: Record<string, string> = {};
    for (const f of requirements.fields) trimmed[f.key] = (values[f.key] ?? "").trim();
    onSubmit(trimmed);
  }

  return (
    <div className="connector-creds-overlay" role="dialog" aria-modal="true" aria-labelledby={`creds-${service}-title`}>
      <form className="connector-creds-card" onSubmit={handleSubmit}>
        <header className="connector-creds-head">
          <h2 id={`creds-${service}-title`}>Connect <em>{label}</em></h2>
          <button type="button" className="connector-creds-close" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="connector-creds-body">
          {requirements.fields.map((f) => (
            <label key={f.key} className="connector-creds-field">
              <span className="connector-creds-label">{f.label}</span>
              <input
                type="text"
                className="connector-creds-input"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
              <span className="connector-creds-help">{f.description}</span>
            </label>
          ))}
        </div>
        <div className="connector-creds-note">
          <p className="connector-creds-note-title">Where to find this</p>
          {requirements.fields.map((f) => (
            <p key={`note-${f.key}`} className="connector-creds-note-body">
              {f.helpText}
              {f.helpLink && (
                <>
                  {" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      void window.aios.openExternal(f.helpLink!);
                    }}
                  >
                    Open Meta Business
                  </a>
                </>
              )}
            </p>
          ))}
        </div>
        <footer className="connector-creds-foot">
          <button type="button" className="connector-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="connector-btn is-primary" disabled={!allFilled}>
            <ExternalLink size={13} /> Continue to {label}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ConnectorCard({
  connector,
  isBusy,
  isIdentifying,
  onConnect,
  onCancel,
  onRetry,
  onDisconnect
}: {
  connector: ConnectorView;
  isBusy: boolean;
  isIdentifying: boolean;
  onConnect: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDisconnect: () => void;
}) {
  const { label, description, Icon, comingSoon, status, accountLabel } = connector;
  const isConnected = status === "connected";
  // "connecting" = backend has a pending row AND we're actively polling.
  const isConnecting = status === "connecting";
  const isStalled = status === "stalled";
  const isExpired = status === "expired";

  return (
    <article
      className={
        `connector-card ` +
        `${isConnected ? "is-connected" : ""} ` +
        `${comingSoon ? "is-soon" : ""} ` +
        `${isStalled ? "is-stalled" : ""}`
      }
    >
      <div className="connector-card-head">
        <div className="connector-icon" aria-hidden="true">
          {connector.logoUrl ? (
            <img 
              src={connector.logoUrl} 
              alt="" 
              style={{ 
                width: 18, 
                height: 18, 
                objectFit: "contain", 
                filter: "none",
                opacity: 1,
                transition: "all 0.3s ease"
              }} 
              className="connector-logo-img"
            />
          ) : (
            <Icon size={18} />
          )}
        </div>
        <div className="connector-card-title">
          <strong>{label}</strong>
          <p>{description}</p>
        </div>
      </div>

      <div className="connector-card-status">
        {comingSoon ? (
          <span className="connector-status-pill is-soon">
            <span className="connector-dot" /> Coming soon
          </span>
        ) : isConnected ? (
          // Always show Check + Connected immediately. Account-email lookup
          // runs silently in the background; the label fades in when ready.
          // Showing a spinner here made users feel a connection wasn't complete
          // for ~10s after OAuth, even though it actually was.
          <span className="connector-status-pill is-connected">
            <Check size={11} />
            <span className="connector-status-label">
              {accountLabel || "Connected"}
            </span>
          </span>
        ) : isExpired ? (
          <span className="connector-status-pill is-soon">
            <span className="connector-dot" /> Expired — reconnect
          </span>
        ) : isStalled ? (
          <span className="connector-status-pill is-soon">
            <span className="connector-dot" /> No response — try again
          </span>
        ) : isConnecting ? (
          <span className="connector-status-pill is-soon">
            <Loader2 size={11} className="spin" /> Waiting for OAuth…
          </span>
        ) : (
          <span className="connector-status-pill is-off">
            <span className="connector-dot" /> Not connected
          </span>
        )}
      </div>

      <div className="connector-card-actions">
        {comingSoon ? (
          <button type="button" className="connector-btn is-disabled" disabled>
            Coming soon
          </button>
        ) : isConnected ? (
          <button type="button" className="connector-btn is-secondary" onClick={onDisconnect} disabled={isBusy}>
            <X size={13} />
            Disconnect
          </button>
        ) : isConnecting ? (
          <>
            <button type="button" className="connector-btn is-secondary" onClick={onCancel} disabled={isBusy}>
              <X size={13} />
              Cancel
            </button>
          </>
        ) : isStalled ? (
          <>
            <button type="button" className="connector-btn is-secondary" onClick={onCancel} disabled={isBusy}>
              <X size={13} />
              Cancel
            </button>
            <button type="button" className="connector-btn is-primary" onClick={onRetry} disabled={isBusy}>
              {isBusy ? <Loader2 size={13} className="spin" /> : <ExternalLink size={13} />}
              Retry
            </button>
          </>
        ) : (
          <button
            type="button"
            className="connector-btn is-primary"
            onClick={onConnect}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 size={13} className="spin" /> : <ExternalLink size={13} />}
            {isExpired ? `Reconnect ${label}` : `Connect ${label}`}
          </button>
        )}
      </div>
    </article>
  );
}

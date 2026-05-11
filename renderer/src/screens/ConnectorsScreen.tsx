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
  Loader2,
  Mail,
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
  comingSoon?: boolean;
}

const CONNECTOR_CATALOG: Connector[] = [
  {
    service: "gmail",
    label: "Gmail",
    description: "Read your inbox, draft replies, find threads, send mail.",
    Icon: Mail
  },
  {
    service: "google-calendar",
    label: "Google Calendar",
    description: "See your schedule, find free slots, create events.",
    Icon: Calendar
  },
  {
    service: "slack",
    label: "Slack",
    description: "Read channels, post messages, search conversations.",
    Icon: MessageSquare
  },
  {
    service: "clickup",
    label: "ClickUp",
    description: "Create tasks, update statuses, query lists.",
    Icon: CheckSquare
  },
  {
    service: "notion",
    label: "Notion",
    description: "Read pages, search databases, append blocks.",
    Icon: FileText
  },
  {
    service: "github",
    label: "GitHub",
    description: "Browse repos, read issues, open PRs.",
    Icon: Github
  },
  // DataOS connectors. These are required by the DataOS module so it can
  // pull live business metrics without asking the user for raw API keys.
  {
    service: "stripe",
    label: "Stripe",
    description: "Payments, subscriptions, customers, charges, MRR.",
    Icon: CreditCard
  },
  {
    service: "youtube",
    label: "YouTube",
    description: "Channel stats, video performance, subscriber growth.",
    Icon: Youtube
  },
  {
    service: "google-analytics",
    label: "Google Analytics",
    description: "Site traffic, conversion, audience metrics from GA4.",
    Icon: BarChart3
  },
  {
    service: "google-sheets",
    label: "Google Sheets",
    description: "Read structured data from sheets you own.",
    Icon: Sheet
  }
];

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
        "google-sheets": `Call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL once with tool_slug "GOOGLESHEETS_SEARCH_SPREADSHEETS" and arguments {"query": "", "page_size": 1}. Find the owner's emailAddress in the first result's "owners[0].emailAddress" field. Reply with ONLY that bare email, nothing else. If unsure, reply: UNKNOWN.`
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
  // re-spawn a Claude task on every refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored: Record<string, string> = {};
        for (const c of CONNECTOR_CATALOG) {
          if (c.comingSoon) continue;
          const r = await invoke<{ key: string; value: string | null }>("get_setting", { key: `connector_label_${c.service}` });
          if (r?.value) stored[c.service] = r.value;
        }
        if (!cancelled && Object.keys(stored).length > 0) {
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
      // identify the account. We wait a beat so the MCP is loaded into Claude
      // before the identify task spawns.
      for (const c of res.connections) {
        if (c.status === "connected" && !localLabels[c.service]) {
          window.setTimeout(() => { void identifyAccount(c.service); }, 1500);
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

  // Cancel works in two cases:
  //   1. Polling for completion → stop the poll AND tell Composio to drop
  //      the pending account so retry can start fresh.
  //   2. Stalled state → same cleanup, just no poll to stop.
  // Footgun guard: re-check live status first. If the connection is actually
  // 'connected' (e.g., poll timed out but OAuth has since completed), we
  // refresh and bail out instead of nuking a working connection.
  async function cancel(service: string, connectionId?: string) {
    setBusyService(service);
    setError(null);
    const guard = activePollsRef.current.get(service);
    if (guard) {
      guard.aborted = true;
      activePollsRef.current.delete(service);
    }
    try {
      const fresh = await relay.listConnections(deviceUserId);
      setLiveConnections(fresh.connections);
      const found = fresh.connections.find((c) => c.service === service);
      if (found?.status === "connected") {
        // It actually went through — don't disconnect, just clear the stalled flag.
        clearStalled(service);
        return;
      }
      clearStalled(service);
      if (connectionId) {
        await relay.disconnect(deviceUserId, connectionId).catch(() => undefined);
      }
      await refresh();
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusyService(null);
    }
  }

  async function retry(service: string, connectionId?: string) {
    // Same cleanup as cancel, but re-initiates immediately afterwards.
    await cancel(service, connectionId);
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

        {loading ? (
          <div className="connectors-loading">
            <div className="connectors-loading-card">
              <span className="connectors-loading-orb"><Loader2 size={20} className="spin" /></span>
              <strong>Loading <em>connectors</em></strong>
              <span>Pulling your connected services from the relay.</span>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </section>
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
          <Icon size={18} />
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

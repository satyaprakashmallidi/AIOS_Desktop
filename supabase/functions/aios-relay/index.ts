// AIOS Connectors relay — Supabase Edge Function (Deno).
//
// This is the only place the master Composio API key lives at runtime.
// The desktop app authenticates with its `device_user_id` (UUID it generated
// on first launch); all Composio operations are scoped to that user's entity.
//
// Routes:
//   POST   /register
//   GET    /connections
//   POST   /connections/:service/initiate
//   DELETE /connections/:connectionId
//   GET    /mcp-config
//
// Deploy:
//   supabase functions deploy aios-relay
//
// Required secrets (set via `supabase secrets set ...`):
//   COMPOSIO_API_KEY            — your Composio org API key
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400, code = "BAD_REQUEST") {
  return jsonResponse({ error: { code, message } }, status);
}

async function composioFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${COMPOSIO_BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": COMPOSIO_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function getAuthedDeviceUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

async function findUser(deviceUserId: string) {
  const { data, error } = await supabase
    .from("device_users")
    .select("device_user_id, composio_entity_id, created_at")
    .eq("device_user_id", deviceUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── POST /register ────────────────────────────────────────────────────────
//
// Composio v3 creates entities implicitly the first time you reference them
// in a connection. So "register" is purely our own concept — we track the
// mapping in Postgres so we know which device users we've seen and when.
async function handleRegister(req: Request, deviceUserId: string): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const os = typeof body.os === "string" ? body.os : null;
  const appVersion = typeof body.appVersion === "string" ? body.appVersion : null;

  const existing = await findUser(deviceUserId);
  if (existing) {
    await supabase
      .from("device_users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("device_user_id", deviceUserId);
    return jsonResponse({ entityId: existing.composio_entity_id, alreadyRegistered: true });
  }

  const { error: insertError } = await supabase.from("device_users").insert({
    device_user_id: deviceUserId,
    composio_entity_id: deviceUserId,
    os,
    app_version: appVersion,
  });
  if (insertError) {
    return errorResponse(insertError.message, 500, "DB_ERROR");
  }

  return jsonResponse({ entityId: deviceUserId, alreadyRegistered: false });
}

// ─── GET /connections ──────────────────────────────────────────────────────
//
// Polling-friendly: for any rows currently in 'pending', fetch the specific
// Composio connection by ID to see if OAuth has completed. Avoids the
// list-with-filter format ambiguity in Composio's v3 API.
async function handleListConnections(deviceUserId: string): Promise<Response> {
  // Step 1: load our DB rows for this user.
  const { data: rows, error: loadErr } = await supabase
    .from("device_connections")
    .select("id, service, composio_connection_id, status, account_label, connected_at")
    .eq("device_user_id", deviceUserId);
  if (loadErr) return errorResponse(loadErr.message, 500, "DB_ERROR");

  // Step 2: for any pending row, ask Composio for its current state. Run
  // the per-row probes in parallel — sequential awaits made the whole list
  // endpoint block on the slowest Composio response.
  const pending = (rows ?? []).filter((r) => r.status === "pending");
  await Promise.allSettled(
    pending.map(async (row) => {
      try {
        const res = await composioFetch(`/connected_accounts/${encodeURIComponent(row.composio_connection_id)}`);
        if (!res.ok) return; // 404 = user cancelled at provider; leave row pending
        const item: any = await res.json();
        const statusRaw = String(item.status ?? item.state ?? "").toUpperCase();
        const isActive = statusRaw === "ACTIVE" || statusRaw === "CONNECTED" || statusRaw === "SUCCESS";
        if (!isActive) return;

        const accountLabel =
          item.account_label ??
          item.accountLabel ??
          item.email ??
          item.params?.email ??
          item.metadata?.email ??
          item.account_id ??
          null;

        await supabase
          .from("device_connections")
          .update({
            status: "connected",
            account_label: accountLabel,
            connected_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      } catch {
        // Transient — try again on next poll.
      }
    })
  );

  // Step 3: return the now-up-to-date mirror.
  const { data, error } = await supabase
    .from("device_connections")
    .select("id, service, composio_connection_id, status, account_label, connected_at")
    .eq("device_user_id", deviceUserId)
    .order("connected_at", { ascending: false });
  if (error) return errorResponse(error.message, 500, "DB_ERROR");
  return jsonResponse({ connections: data ?? [] });
}

// ─── POST /connections/:service/initiate ───────────────────────────────────
//
// Composio v3: each integration (Gmail, Slack, etc.) is set up once in the
// Composio dashboard as an "Auth Config" with an ID like `ac_xxxxx`. We map
// service slug → auth_config_id via env vars: COMPOSIO_AUTH_GMAIL=ac_xxx etc.
async function handleInitiate(deviceUserId: string, service: string): Promise<Response> {
  const user = await findUser(deviceUserId);
  if (!user) return errorResponse("Device user not registered", 404, "NOT_REGISTERED");

  const envKey = `COMPOSIO_AUTH_${service.toUpperCase().replace(/-/g, "_")}`;
  const authConfigId = Deno.env.get(envKey);
  if (!authConfigId) {
    return errorResponse(
      `Auth config for "${service}" is not configured on the server. ` +
        `Create the integration in Composio dashboard and set ${envKey}=<auth_config_id> in Supabase secrets.`,
      500,
      "NO_AUTH_CONFIG"
    );
  }

  // Composio v3 connected accounts API. Nested body shape:
  //   { auth_config: { id: "ac_..." }, connection: { user_id: "..." } }
  // Returns: { id, redirect_url, ... } on success.
  const initRes = await composioFetch("/connected_accounts", {
    method: "POST",
    body: JSON.stringify({
      auth_config: { id: authConfigId },
      connection: { user_id: deviceUserId },
    }),
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    return errorResponse(`Composio initiate failed (${initRes.status}): ${text.slice(0, 500)}`, 502, "COMPOSIO_ERROR");
  }

  const initData = await initRes.json();
  const composioConnectionId =
    initData.id ?? initData.connectedAccountId ?? initData.connection_id;
  const redirectUrl =
    initData.redirect_url ?? initData.redirectUrl ?? initData.authUrl;

  if (!composioConnectionId || !redirectUrl) {
    return errorResponse(
      `Composio response missing connection id or redirect URL. Raw: ${JSON.stringify(initData).slice(0, 500)}`,
      502,
      "COMPOSIO_ERROR"
    );
  }

  const { error } = await supabase
    .from("device_connections")
    .upsert(
      {
        device_user_id: deviceUserId,
        service,
        composio_connection_id: composioConnectionId,
        status: "pending",
      },
      { onConflict: "device_user_id,service" }
    );
  if (error) return errorResponse(error.message, 500, "DB_ERROR");

  return jsonResponse({ redirectUrl, connectionId: composioConnectionId });
}

// /probe was deprecated and removed — the renderer now identifies connected
// accounts via a Claude task using Composio MCP (see ConnectorsScreen
// identifyAccount), which is more reliable than poking REST endpoints that
// all redact identity fields.

// ─── DELETE /connections/:connectionId ─────────────────────────────────────
async function handleDisconnect(deviceUserId: string, connectionId: string): Promise<Response> {
  // Verify the connection belongs to this user, then ALWAYS remove the local
  // row. Composio's delete is best-effort — if it 5xxs we still want our DB
  // and the user's UI to reflect the disconnect, otherwise the card is stuck
  // in a "Connected" state with no way out.
  const { data: row, error: lookupErr } = await supabase
    .from("device_connections")
    .select("id")
    .eq("composio_connection_id", connectionId)
    .eq("device_user_id", deviceUserId)
    .maybeSingle();
  if (lookupErr) return errorResponse(lookupErr.message, 500, "DB_ERROR");

  // Try Composio delete; swallow any error so our local cleanup still runs.
  try {
    await composioFetch(`/connected_accounts/${connectionId}`, { method: "DELETE" });
  } catch { /* best-effort */ }

  if (row) {
    await supabase.from("device_connections").delete().eq("id", row.id);
  }
  return jsonResponse({ ok: true });
}

// ─── GET /mcp-config ───────────────────────────────────────────────────────
//
// Provisions a per-user Composio MCP session by calling Composio's official
// TS SDK (loaded via Deno's npm: import). The SDK does whatever REST dance
// is needed under the hood; we just hand AIOS the resulting `session.mcp`
// config so it can drop it into Claude Code's settings.json.
async function handleMcpConfig(deviceUserId: string): Promise<Response> {
  const user = await findUser(deviceUserId);
  if (!user) return errorResponse("Device user not registered", 404, "NOT_REGISTERED");

  try {
    const composioModule = await import("npm:@composio/core");
    const ComposioCtor: any = composioModule.Composio ?? composioModule.default ?? composioModule;
    const composio = new ComposioCtor({ apiKey: COMPOSIO_API_KEY });

    // Best-effort cleanup of any prior tool-router session bound to this
    // user. Every endpoint we tried for this 404s in practice — Composio
    // doesn't expose a session-delete API. We rotate the device_user_id
    // client-side instead when we need a truly fresh session.
    try {
      await composioFetch(`/tool_router/sessions/${encodeURIComponent(deviceUserId)}`, { method: "DELETE" });
    } catch { /* swallow — best-effort */ }

    const session: any = await composio.create(deviceUserId);

    return jsonResponse({
      mcp: session?.mcp ?? null,
      session: {
        id: session?.id,
        userId: session?.userId ?? deviceUserId,
      },
      label: "composio",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(
      `Composio SDK call failed: ${message.slice(0, 800)}`,
      502,
      "COMPOSIO_ERROR"
    );
  }
}

// ─── POST /execute-tool ────────────────────────────────────────────────────
//
// Direct tool execution path — used by module scripts (IntelOS Slack
// collector, DataOS Stripe/YouTube/GA/Sheets collectors, etc.) to call a
// Composio tool with the user's OAuth-authorized connection WITHOUT going
// through Claude / MCP. Lets scheduled scripts run independently of the app.
//
// Body: { tool_slug: string, service?: string, args?: object }
// Returns: { ok: true, data: <tool response> } or { error }
//
// The service field is optional — when present, we use it to look up the
// user's connected_account for that service and pass `connectedAccountId`
// to Composio's tool execute. When absent, Composio infers from the tool
// slug (e.g. SLACK_* → user's Slack connection).
async function handleExecuteTool(req: Request, deviceUserId: string): Promise<Response> {
  const user = await findUser(deviceUserId);
  if (!user) return errorResponse("Device user not registered", 404, "NOT_REGISTERED");

  const body = await req.json().catch(() => ({}));
  const toolSlug = typeof body.tool_slug === "string" ? body.tool_slug : "";
  const service = typeof body.service === "string" ? body.service : null;
  const args = body.args && typeof body.args === "object" ? body.args : {};

  if (!toolSlug) {
    return errorResponse("Missing tool_slug in request body", 400, "BAD_REQUEST");
  }

  // Service guard — if the caller specifies a service, refuse if that service
  // isn't connected for this user. Surface a clear error so scripts know to
  // tell the user "open the Connectors page".
  let connectedAccountId: string | null = null;
  if (service) {
    const { data: conn, error: connErr } = await supabase
      .from("device_connections")
      .select("composio_connection_id, status")
      .eq("device_user_id", deviceUserId)
      .eq("service", service)
      .maybeSingle();
    if (connErr) return errorResponse(connErr.message, 500, "DB_ERROR");
    if (!conn || conn.status !== "connected") {
      return errorResponse(
        `Service "${service}" is not connected. Open the Connectors page in AIOS Desktop.`,
        409,
        "NOT_CONNECTED"
      );
    }
    connectedAccountId = conn.composio_connection_id;
  }

  // Use the Composio SDK — same path as /mcp-config — so we don't have to
  // hand-roll the REST shape (Composio v3 hasn't documented it publicly).
  try {
    const composioModule = await import("npm:@composio/core");
    const ComposioCtor: any = composioModule.Composio ?? composioModule.default ?? composioModule;
    const composio = new ComposioCtor({ apiKey: COMPOSIO_API_KEY });

    // The SDK exposes execute under different names depending on the version
    // we get from npm. Try in priority order.
    const executor: any =
      composio?.tools?.execute ??
      composio?.actions?.execute ??
      composio?.execute;
    if (typeof executor !== "function") {
      return errorResponse(
        "Composio SDK does not expose a tool execute method we recognise.",
        502,
        "SDK_SHAPE_UNKNOWN"
      );
    }

    // @composio/core v3 signature:
    //   composio.tools.execute(toolSlug, { userId, arguments, connectedAccountId })
    // toolSlug must be a positional first argument; older versions of this
    // relay passed everything in a single options object, which made the SDK
    // see toolSlug as undefined and reject with "parameter should be a object,
    // but you provided a undefined".
    const callOpts = {
      userId: deviceUserId,
      arguments: args,
      ...(connectedAccountId ? { connectedAccountId } : {}),
    };
    const result = await executor.call(composio, toolSlug, callOpts);

    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(
      `Composio tool execute failed: ${message.slice(0, 800)}`,
      502,
      "COMPOSIO_ERROR"
    );
  }
}

// ─── Router ────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Strip "/aios-relay" prefix that Supabase prepends.
  const path = url.pathname.replace(/^\/aios-relay/, "") || "/";

  if (!COMPOSIO_API_KEY) {
    return errorResponse("Server is not configured (missing COMPOSIO_API_KEY).", 500, "NO_API_KEY");
  }

  const deviceUserId = await getAuthedDeviceUserId(req);
  if (!deviceUserId) {
    return errorResponse("Missing or malformed Authorization: Bearer <device_user_id>", 401, "UNAUTHORIZED");
  }

  try {
    // Routes
    if (req.method === "POST" && path === "/register") {
      return await handleRegister(req, deviceUserId);
    }
    if (req.method === "GET" && path === "/connections") {
      return await handleListConnections(deviceUserId);
    }
    if (req.method === "POST" && path.startsWith("/connections/") && path.endsWith("/initiate")) {
      const service = path.split("/")[2];
      return await handleInitiate(deviceUserId, service);
    }
    if (req.method === "DELETE" && path.startsWith("/connections/")) {
      const connectionId = path.split("/")[2];
      return await handleDisconnect(deviceUserId, connectionId);
    }
    if (req.method === "GET" && path === "/mcp-config") {
      return await handleMcpConfig(deviceUserId);
    }
    if (req.method === "POST" && path === "/execute-tool") {
      return await handleExecuteTool(req, deviceUserId);
    }

    return errorResponse(`No route for ${req.method} ${path}`, 404, "NOT_FOUND");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message, 500, "INTERNAL");
  }
});

// Thin client for the AIOS Connectors relay (Supabase Edge Function).
//
// Auth: every call sends `Authorization: Bearer <deviceUserId>`.
// The deviceUserId is generated and persisted by the Python sidecar on
// first launch — read it from `workspace.deviceUserId` and pass it in.

// Hardcoded production relay URL. The Supabase Edge Function URL itself is
// not a secret — the relay uses Bearer device_user_id auth, and the actual
// COMPOSIO_API_KEY lives in Supabase secrets server-side. VITE_AIOS_RELAY_URL
// can still override at build-time for local testing against a different
// deployment.
const DEFAULT_RELAY_URL = "https://cnvimnicyeljkihbjztv.supabase.co/functions/v1/aios-relay";
const RELAY_URL = ((import.meta.env.VITE_AIOS_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL).replace(/\/$/, "");

export interface RelayConnection {
  id: string;
  service: string;
  composio_connection_id: string;
  status: "pending" | "connected" | "expired" | "error";
  account_label: string | null;
  connected_at: string | null;
}

export class RelayError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(
  path: string,
  deviceUserId: string,
  init?: RequestInit
): Promise<T> {
  if (!RELAY_URL) {
    throw new RelayError("NO_RELAY_URL", "VITE_AIOS_RELAY_URL is not set in renderer/.env", 0);
  }
  const res = await fetch(`${RELAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${deviceUserId}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const msg = body?.error?.message ?? text ?? `Request failed (${res.status})`;
    throw new RelayError(code, msg, res.status);
  }
  return body as T;
}

export const relay = {
  async register(deviceUserId: string, os: string, appVersion: string) {
    return call<{ entityId: string; alreadyRegistered: boolean }>(
      "/register",
      deviceUserId,
      { method: "POST", body: JSON.stringify({ os, appVersion }) }
    );
  },

  async listConnections(deviceUserId: string) {
    return call<{ connections: RelayConnection[] }>(
      "/connections",
      deviceUserId,
      { method: "GET" }
    );
  },

  async initiate(deviceUserId: string, service: string) {
    return call<{ redirectUrl: string; connectionId: string }>(
      `/connections/${encodeURIComponent(service)}/initiate`,
      deviceUserId,
      { method: "POST" }
    );
  },

  async disconnect(deviceUserId: string, connectionId: string) {
    return call<{ ok: true }>(
      `/connections/${encodeURIComponent(connectionId)}`,
      deviceUserId,
      { method: "DELETE" }
    );
  },

  async getMcpConfig(deviceUserId: string) {
    return call<{ mcpUrl: string; mcpAuthHeader: string; label: string } | { mcp: any; session: any; label: string }>(
      "/mcp-config",
      deviceUserId,
      { method: "GET" }
    );
  },
};

export const RELAY_AVAILABLE = Boolean(RELAY_URL);

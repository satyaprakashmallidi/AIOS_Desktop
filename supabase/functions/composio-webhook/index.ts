// Composio webhook receiver — Supabase Edge Function (Deno).
//
// Composio fires this when an OAuth flow completes (or a connection's status
// changes — disconnect, refresh failure, etc.). We update the matching row
// in device_connections so the desktop app's polling sees the new state.
//
// Deploy with:
//   supabase functions deploy composio-webhook --no-verify-jwt
//
// Then in Composio dashboard, set the webhook URL to:
//   https://<project-ref>.supabase.co/functions/v1/composio-webhook

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("COMPOSIO_WEBHOOK_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifySignature(req: Request, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true; // dev mode — secret not configured yet
  const sig = req.headers.get("x-composio-signature") ?? req.headers.get("composio-signature") ?? "";
  if (!sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === sig;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const raw = await req.text();
  if (!(await verifySignature(req, raw))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Composio v3 events we subscribe to:
  //   composio.connected_account.expired  — token expired, needs re-auth
  //   composio.trigger.disabled           — trigger was auto-disabled (rare)
  //
  // OAuth completion is NOT a webhook event in Composio v3 — the desktop
  // app detects completion via polling /connections.
  const event = String(payload.event ?? payload.type ?? "");
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const connectionId = String(
    (data as any).connectedAccountId ??
      (data as any).connection_id ??
      (data as any).id ??
      ""
  );

  if (event.includes("connected_account.expired") || event.includes("expired")) {
    if (!connectionId) {
      return new Response("Missing connection id in payload", { status: 400 });
    }
    await supabase
      .from("device_connections")
      .update({ status: "expired" })
      .eq("composio_connection_id", connectionId);
    return new Response("ok", { status: 200 });
  }

  if (event.includes("trigger.disabled") || event.includes("disabled")) {
    if (!connectionId) {
      return new Response("ok", { status: 200 });
    }
    await supabase
      .from("device_connections")
      .update({ status: "error" })
      .eq("composio_connection_id", connectionId);
    return new Response("ok", { status: 200 });
  }

  // Unknown event type — log shape and 200 so Composio doesn't retry forever.
  console.warn("Unhandled Composio webhook event:", event);
  return new Response("ok", { status: 200 });
});

import { relay, RELAY_AVAILABLE } from "./aios-relay";
import { invoke } from "./api";

/**
 * apiAuthFetch is a thin wrapper around the global fetch API that automatically
 * injects the deviceUserId as a Bearer token. This is used by the Kanban board
 * and other connector-heavy screens to talk to the AIOS relay or custom backends.
 */
export async function apiAuthFetch(path: string, init?: RequestInit): Promise<Response> {
  // 1. Resolve the target URL. If it's a relative path starting with /api, 
  // we route it through the AIOS relay.
  const baseUrl = (import.meta.env.VITE_AIOS_RELAY_URL as string) || "https://cnvimnicyeljkihbjztv.supabase.co/functions/v1/aios-relay";
  const url = path.startsWith("http") ? path : `${baseUrl.replace(/\/$/, "")}${path}`;

  // 2. Resolve the deviceUserId. We fetch it from the workspace info via IPC.
  // In a real production app, we'd cache this in memory after the first call.
  let deviceUserId = "";
  try {
    const info = await invoke<{ deviceUserId: string }>("get_workspace_info");
    deviceUserId = info.deviceUserId;
  } catch (err) {
    console.error("apiAuthFetch: could not resolve deviceUserId", err);
  }

  // 3. Execute the fetch with the Bearer token.
  const response = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${deviceUserId}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  return response;
}

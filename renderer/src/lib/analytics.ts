// Thin PostHog wrapper. Ships with a baked-in project token so every
// install measures from day one — `phc_` tokens are explicitly safe in
// client code per PostHog's docs (write-only, no read access). Users
// who want to point at their own PostHog instance can override via
// Settings → Analytics.
//
// One module-level posthog reference is set by `initAnalytics`; `track`
// is the only API surface the rest of the app uses.

import type { PostHog } from "posthog-js";

let posthog: PostHog | null = null;
let initialized = false;

// Default to PostHog Cloud US. Settings can override with EU host if/when
// we add a region picker (eu.i.posthog.com).
const DEFAULT_HOST = "https://us.i.posthog.com";

// AIOS Desktop's PostHog project (everyai-com workspace, project 438685).
// Write-only public key — safe to embed in shipped client code.
// Replace via Settings → Analytics for personal forks.
const DEFAULT_PUBLIC_KEY = "phc_nVdMCfPuSut5yVX9rS6JBooYjuFv8UdcrcADv7wtNwq8";

export async function initAnalytics(apiKey: string | null | undefined, host?: string): Promise<void> {
  if (initialized) return;
  // Empty user setting falls back to the AIOS default project. Users can
  // explicitly disable by setting the string "disabled" (or anything that
  // doesn't start with phc_) via Settings → Analytics.
  const userKey = (apiKey ?? "").trim();
  const key = userKey || DEFAULT_PUBLIC_KEY;
  if (!key.startsWith("phc_")) {
    // User explicitly opted out (or pasted a phx_ personal key by mistake).
    return;
  }
  initialized = true;
  try {
    const mod = await import("posthog-js");
    posthog = mod.default;
    posthog.init(key, {
      api_host: host || DEFAULT_HOST,
      // Capture is opt-in per app convention — we fire events explicitly
      // from known code paths instead of letting autocapture sweep the DOM.
      autocapture: false,
      // Don't capture pageviews automatically — we don't have URL routing
      // (Electron app uses internal screen state).
      capture_pageview: false,
      capture_pageleave: false,
      // Local-only session recording disabled by default — desktop apps
      // with sensitive content (chats, connectors) should not record.
      disable_session_recording: true,
      // Persistence in localStorage so distinct_id survives app restarts
      // without our own ID management.
      persistence: "localStorage",
    });
  } catch (err) {
    // Module import or init failed — drop posthog and never retry. The
    // user can re-enter the key + reload to retry.
    posthog = null;
    initialized = false;
    // eslint-disable-next-line no-console
    console.warn("[analytics] PostHog init failed:", err);
  }
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!posthog) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Never let analytics break the app.
  }
}

export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  if (!posthog) return;
  try {
    posthog.identify(distinctId, properties);
  } catch { /* swallow */ }
}

export function resetAnalytics(): void {
  if (!posthog) return;
  try {
    posthog.reset();
  } catch { /* swallow */ }
}

export function isAnalyticsActive(): boolean {
  return posthog !== null;
}

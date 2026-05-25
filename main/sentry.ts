// Sentry init for the Electron main process.
//
// DSN is a public identifier (not a secret) — safe to bundle in the binary.
// Override at runtime with SENTRY_DSN env var if you ever need to redirect events
// (e.g. dev → staging project). Set SENTRY_DISABLE=1 to opt out entirely in local dev.

import * as Sentry from "@sentry/electron/main";
import { app } from "electron";

const DEFAULT_DSN =
  "https://2d3eeb6da88327c1cdd288264bb081f4@o4511448708022272.ingest.us.sentry.io/4511448714706944";

export function initSentryMain(): void {
  if (process.env.SENTRY_DISABLE === "1") return;
  // Skip during verifier/test runs unless explicitly opted in — keeps probe noise
  // out of the production Sentry project.
  if (process.env.AIOS_VERIFIER === "1" && process.env.SENTRY_TEST !== "1") return;

  const dsn = process.env.SENTRY_DSN ?? DEFAULT_DSN;
  const release = `aios-desktop@${app.getVersion()}`;
  const environment = app.isPackaged ? "production" : "development";

  Sentry.init({
    dsn,
    release,
    environment,
    // Capture native crashes via Crashpad — caught by Sentry's Electron integration.
    // Performance tracing off by default (free tier; enable per-feature later).
    tracesSampleRate: 0,
    // Don't auto-send breadcrumbs from console.log — too noisy on a chatty app.
    integrations: (defaults) => defaults.filter((i) => i.name !== "Console"),
  });
}

// Sentry init for the renderer process.
//
// Mirrors main/sentry.ts. The renderer-side init also exposes a readiness flag
// the VerifierOS probe consumes to assert "Sentry SDK loaded and initialized".

import * as Sentry from "@sentry/electron/renderer";

const DEFAULT_DSN =
  "https://2d3eeb6da88327c1cdd288264bb081f4@o4511448708022272.ingest.us.sentry.io/4511448714706944";

declare global {
  interface Window {
    __sentryReady?: boolean;
    __sentryDsn?: string;
  }
}

export function initSentryRenderer(): void {
  if (import.meta.env.VITE_SENTRY_DISABLE === "1") return;

  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? DEFAULT_DSN;

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });

  // Verifier probe asserts these. Don't remove without updating
  // verifier/probes/sentry-init.ts.
  window.__sentryReady = true;
  window.__sentryDsn = dsn;
}

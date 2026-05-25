import React, { useEffect, useRef, useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { invoke } from "../lib/api";

// Paced macOS permissions modal. Replaces the v0.2.18 auto-firing useEffect
// that triggered all 4 native dialogs back-to-back without explanation. Now
// each step is gated by a user click on "Grant" or "Skip" — no native
// dialog appears until the user explicitly asks for it. Each step shows
// plain-English context for WHY AIOS needs the permission before any
// macOS surface appears.
//
// Step order (microphone first because it's the most important for voice,
// and AVCaptureDevice.requestAccess shows the dialog directly without
// kicking the user to System Settings — friendliest first prompt):
//   1. Microphone     — native dialog appears in-app
//   2. Accessibility  — opens Settings → Privacy & Security → Accessibility
//   3. Screen Recording — opens Settings → Privacy & Security → Screen Recording
//   4. Automation     — native dialog the first time osascript fires
//
// On `onClose`, App.tsx sets the localStorage flag so this modal never
// re-appears (matches the v0.2.18 contract). User can grant any missed
// permission later via System Settings — they don't need this modal back.

type StepKind = "microphone" | "accessibility" | "screenRecording" | "automation";
type StepStatus = "pending" | "requesting" | "granted" | "denied" | "skipped";

interface StepDef {
  kind: StepKind;
  title: string;
  body: string;
  needsPolling: boolean;
}

const STEPS: StepDef[] = [
  {
    kind: "microphone",
    title: "Microphone",
    body: "AIOS uses your microphone for voice commands in Computer Control. macOS will show a permission dialog when you click Grant.",
    needsPolling: true,
  },
  {
    kind: "accessibility",
    title: "Accessibility",
    body: "Computer Control moves the cursor and types on your behalf. macOS requires Accessibility permission for any app that does this — enable AIOS Desktop in the Settings pane that opens.",
    needsPolling: true,
  },
  {
    kind: "screenRecording",
    title: "Screen Recording",
    body: "AIOS sees what's on your screen so Claude understands what you're working with. macOS requires Screen Recording permission — enable AIOS Desktop in the Settings pane that opens.",
    needsPolling: true,
  },
  {
    kind: "automation",
    title: "Automation",
    body: "When you say 'open <app>', AIOS uses Apple Events to bring the launched app to the foreground. macOS shows an Automation prompt the first time this fires.",
    needsPolling: false,
  },
];

type PermSnap = {
  available: boolean;
  microphone: string;
  screenRecording: string;
  accessibility: string;
  automation: string;
};

const POLL_INTERVAL_MS = 800;
const PER_PERMISSION_TIMEOUT_MS = 60_000;

export function MacPermissionsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const [statuses, setStatuses] = useState<Record<StepKind, StepStatus>>({
    microphone: "pending",
    accessibility: "pending",
    screenRecording: "pending",
    automation: "pending",
  });
  // Tracks the polling timer so unmount / Skip / Continue can stop it
  // cleanly. Without this a stale poll would keep firing setStatus after
  // the user moved on.
  const pollAbortRef = useRef<{ aborted: boolean } | null>(null);

  const step = STEPS[stepIndex];
  const status = statuses[step.kind];
  const isLast = stepIndex === STEPS.length - 1;

  useEffect(() => {
    return () => {
      if (pollAbortRef.current) pollAbortRef.current.aborted = true;
    };
  }, []);

  // Escape closes the modal — clicking the X has the same effect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateStatus = (kind: StepKind, next: StepStatus) => {
    setStatuses((cur) => ({ ...cur, [kind]: next }));
  };

  const grant = async () => {
    if (pollAbortRef.current) pollAbortRef.current.aborted = true;
    const abort = { aborted: false };
    pollAbortRef.current = abort;

    updateStatus(step.kind, "requesting");

    let initial: string | undefined;
    if (step.needsPolling) {
      try {
        const before = await invoke<PermSnap>("mac_check_permissions");
        if (before?.available) initial = (before as unknown as Record<string, string>)[step.kind];
      } catch { /* fall through — request will still fire */ }
    }

    try {
      await invoke("mac_request_permission", { kind: step.kind });
    } catch {
      // Backend failure — surface as denied so the user can move on
      // rather than getting stuck on "Requesting…" forever.
      updateStatus(step.kind, "denied");
      return;
    }

    if (!step.needsPolling) {
      // Automation has no public detection API. Treat as granted on a
      // best-effort basis after the macOS prompt fires.
      updateStatus(step.kind, "granted");
      return;
    }

    const deadline = Date.now() + PER_PERMISSION_TIMEOUT_MS;
    while (!abort.aborted && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (abort.aborted) return;
      try {
        const snap = await invoke<PermSnap>("mac_check_permissions");
        if (!snap?.available) break;
        const current = (snap as unknown as Record<string, string>)[step.kind];
        if (current === "granted") {
          updateStatus(step.kind, "granted");
          return;
        }
        if (current !== initial && current === "denied") {
          updateStatus(step.kind, "denied");
          return;
        }
      } catch { /* keep polling */ }
    }
    if (!abort.aborted) {
      // Hit the 60s deadline without a state change. User can grant later
      // via System Settings — don't keep them spinning here.
      updateStatus(step.kind, "denied");
    }
  };

  const skip = () => {
    if (pollAbortRef.current) pollAbortRef.current.aborted = true;
    updateStatus(step.kind, "skipped");
    advance();
  };

  const advance = () => {
    if (pollAbortRef.current) pollAbortRef.current.aborted = true;
    if (isLast) {
      onClose();
    } else {
      setStepIndex((idx) => idx + 1);
    }
  };

  const statusLabel: Record<StepStatus, string> = {
    pending: "Not requested",
    requesting: "Requesting…",
    granted: "Granted",
    denied: "Not granted",
    skipped: "Skipped",
  };
  const statusClass: Record<StepStatus, string> = {
    pending: "is-pending",
    requesting: "is-requesting",
    granted: "is-granted",
    denied: "is-denied",
    skipped: "is-skipped",
  };

  const canContinue = status === "granted" || status === "denied" || status === "skipped";
  const continueLabel = isLast ? "Finish" : "Continue";

  return (
    <div className="mac-permissions-overlay" role="dialog" aria-modal="true" aria-label="Permissions setup">
      <div className="mac-permissions-card">
        <button
          type="button"
          className="mac-permissions-dismiss"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.5} />
        </button>

        <div className="mac-permissions-eyebrow">
          <span className="mac-permissions-eyebrow-rule" />
          Step {stepIndex + 1} of {STEPS.length}
        </div>

        <h1 className="mac-permissions-title">
          <span className="mac-permissions-title-italic">{step.title.toLowerCase()}</span> permission
        </h1>

        <p className="mac-permissions-body">{step.body}</p>

        <div className={`mac-permissions-status ${statusClass[status]}`}>
          {status === "requesting" ? (
            <Loader2 size={13} className="mac-permissions-status-spin" />
          ) : status === "granted" ? (
            <Check size={13} strokeWidth={2.5} />
          ) : null}
          <span>{statusLabel[status]}</span>
        </div>

        <div className="mac-permissions-actions">
          {status === "pending" ? (
            <>
              <button type="button" className="mac-permissions-grant" onClick={grant}>
                Grant
              </button>
              <button type="button" className="mac-permissions-skip" onClick={skip} data-testid="mac-permissions-skip">
                Skip for now
              </button>
            </>
          ) : status === "requesting" ? (
            <button type="button" className="mac-permissions-skip" onClick={skip}>
              Skip
            </button>
          ) : (
            <button type="button" className="mac-permissions-grant" onClick={advance} disabled={!canContinue}>
              {continueLabel}
            </button>
          )}
        </div>

        <ol className="mac-permissions-dots" aria-hidden="true">
          {STEPS.map((s, idx) => {
            const st = statuses[s.kind];
            const active = idx === stepIndex;
            const done = st === "granted" || st === "denied" || st === "skipped";
            return (
              <li
                key={s.kind}
                className={`mac-permissions-dot ${active ? "is-active" : ""} ${done ? "is-done" : ""}`}
              />
            );
          })}
        </ol>
      </div>
    </div>
  );
}

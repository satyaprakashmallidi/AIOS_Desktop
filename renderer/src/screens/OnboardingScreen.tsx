import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  Loader2,
  LogIn,
  Search,
  ShieldCheck,
  Terminal,
  UserRound
} from "lucide-react";
import { invoke } from "../lib/api";
import { onboardingQuestions } from "../lib/onboarding";
import type { ClaudeStatus } from "../types";
import type { OnboardingState, Screen } from "../ui";

type ClaudeInstallState = "idle" | "running" | "done" | "failed";
// Auth method the user picked once the Claude Code binary is detected.
// Stored in `claude_auth_method` setting so it survives across launches and
// drives whether the Continue button is enabled.
type AuthMethod = "claude_login" | "api_key" | "skip";

type StageId = "connect" | "profile" | "finish";

const stages: { id: StageId; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "profile", label: "Profile" },
  { id: "finish", label: "Ready" }
];

const profileLayers = [
  { source: "Identity",       label: "You",        eyebrow: "Identity" },
  { source: "Business Model", label: "Business",   eyebrow: "Business model" },
  { source: "Priorities",     label: "Priorities", eyebrow: "Strategy" },
  { source: "Data",           label: "Data",       eyebrow: "Operating signals" }
] as const;

export function OnboardingScreen({
  state,
  claude,
  onRefreshWorkspace,
  onClaudeChanged,
  onNavigate
}: {
  state: OnboardingState | null;
  claude: ClaudeStatus | null;
  onRefreshWorkspace: () => Promise<void>;
  onClaudeChanged: () => Promise<ClaudeStatus>;
  onNavigate: (screen: Screen) => void;
}) {
  const initialStep = Math.min(state?.currentStep ?? 0, onboardingQuestions.length);
  const [stage, setStage] = useState<StageId>(
    state?.completedAt ? "finish" : initialStep > 0 ? "profile" : "connect"
  );
  const [step, setStep] = useState(initialStep);
  const [answers, setAnswers] = useState<Record<string, string>>(state?.answers ?? {});
  const [draft, setDraft] = useState(() =>
    onboardingQuestions[initialStep] ? state?.answers?.[onboardingQuestions[initialStep].id] ?? "" : ""
  );
  const [manualPath, setManualPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [copiedHint, setCopiedHint] = useState(false);
  // Platform-aware "where is claude" command shown in the help card.
  const isMacOrLinux = !/^Win/i.test(navigator.platform);
  const whereCmd = isMacOrLinux ? "which claude" : "where claude";

  // In-app Claude Code installer state. Streams the official standalone-
  // installer script via the `install_claude` IPC. The script is the same
  // one Anthropic ships:
  //   Mac/Linux: curl -fsSL https://claude.ai/install.sh | bash
  //   Windows  : irm https://claude.ai/install.ps1 | iex
  // No npm / Node prerequisite — installer drops a self-contained binary
  // into the user's local bin dir. After a successful run we auto-detect
  // so the rest of the onboarding flow can proceed without a manual step.
  const [installState, setInstallState] = useState<ClaudeInstallState>("idle");
  const [installLog, setInstallLog] = useState<string>("");
  const installLogRef = useRef<HTMLPreElement | null>(null);
  // True once we auto-spawned the `claude` login terminal post-install for
  // this session — prevents popping a second terminal if the user re-installs
  // or re-enters onboarding while installState is still "done".
  const loginTerminalSpawnedRef = useRef(false);

  // Auth method state. Hydrated from `claude_auth_method` setting on mount —
  // if the user has already picked a method in a prior session we skip the
  // picker. The picker collapsed in v0.1.26 to a single Claude.ai-via-
  // terminal path because `claude /login` itself offers the API-key vs
  // OAuth choice inline; duplicating those in our UI just confused users.
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  // Guard the hydration so a slow SQLite read can't clobber a method the
  // user already picked. We capture authMethod into a ref so we can compare
  // current state inside the async block without re-triggering the effect.
  const authMethodRef = useRef<AuthMethod | null>(null);
  useEffect(() => { authMethodRef.current = authMethod; }, [authMethod]);
  useEffect(() => {
    (async () => {
      try {
        const res = await invoke<{ key: string; value: string | null }>(
          "get_setting",
          { key: "claude_auth_method" }
        );
        const v = res?.value;
        // Only restore if the user hasn't picked anything since mount.
        if (authMethodRef.current !== null) return;
        if (v === "claude_login" || v === "api_key" || v === "skip") {
          setAuthMethod(v);
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Subscribe to install-log events from main. Stays mounted across the
  // whole onboarding flow so log lines that arrive between renders aren't
  // dropped — but only the active install run appends.
  useEffect(() => {
    const off = window.aios?.onHostEvent?.((evt: any) => {
      if (evt?.event !== "claude_install_log") return;
      const line = String(evt?.data?.line ?? "");
      if (!line) return;
      setInstallLog((prev) => {
        const next = prev + line;
        // Cap the buffer so a chatty installer can't bloat React state
        // without bound. ~32 KB is plenty for a tail UI.
        return next.length > 32000 ? next.slice(-32000) : next;
      });
    });
    return () => { off?.(); };
  }, []);

  // Keep the log view pinned to the bottom while streaming.
  useEffect(() => {
    if (installState !== "running") return;
    const el = installLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [installLog, installState]);

  async function persistAuthMethod(method: AuthMethod, message?: string) {
    try {
      await invoke("set_setting", { key: "claude_auth_method", value: method });
    } catch { /* non-fatal — the user can re-pick if persistence failed */ }
    setAuthMethod(method);
    if (message) setAuthMessage(message);
  }

  async function openClaudeLoginTerminal() {
    setAuthBusy(true);
    setAuthMessage(null);
    try {
      const res = await invoke<{ ok: boolean; error?: string }>("open_claude_login_terminal");
      if (!res?.ok) {
        setAuthMessage(res?.error ?? "Couldn't open a terminal — run `claude /login` manually.");
      } else {
        setAuthMessage("Sign in inside the terminal that just opened. Click 'I've signed in' when done.");
      }
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function confirmClaudeLogin() {
    setAuthBusy(true);
    try {
      await persistAuthMethod("claude_login", "Signed in with Claude.ai.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function installClaude() {
    setInstallState("running");
    setInstallLog("");
    setSetupMessage(null);
    try {
      const res = await invoke<{ ok: boolean; error?: string }>("install_claude");
      if (res?.ok) {
        setInstallState("done");
        // Give the OS a beat to register the new binary in PATH, then
        // re-run auto-detect so the connect card flips to "Connected".
        await new Promise((r) => setTimeout(r, 600));
        const detected = await onClaudeChanged();
        if (detected.found) {
          setSetupMessage(`Installed ${detected.version ?? "Claude Code"}. Now sign in to connect your account.`);
          // Fresh Claude install needs auth before it can run any prompt.
          // Spawn a terminal with `claude /login` so the user lands directly
          // in Claude's own login flow (which itself offers API-key vs
          // Claude.ai). One terminal per session — re-installs reuse it.
          if (!loginTerminalSpawnedRef.current) {
            loginTerminalSpawnedRef.current = true;
            try {
              await invoke("open_claude_login_terminal");
              setAuthMessage("A terminal opened with `claude /login` running — sign in there, then click 'I've signed in' below.");
            } catch {
              setAuthMessage("Sign in by running `claude /login` in a terminal, then click 'I've signed in' below.");
            }
          } else {
            setAuthMessage("Sign in inside the `claude /login` terminal we already opened, then click 'I've signed in' below.");
          }
        } else {
          setSetupMessage("Installed. Restart AIOS so it picks up the new PATH, or paste the path manually below.");
        }
      } else {
        setInstallState("failed");
        setSetupMessage(res?.error ?? "Install did not finish — see log below.");
      }
    } catch (err) {
      setInstallState("failed");
      setSetupMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const question = onboardingQuestions[step];
  const completed = Boolean(state?.completedAt) || step >= onboardingQuestions.length;
  const answeredCount = onboardingQuestions.filter((item) => answers[item.id]?.trim()).length;
  const claudeReady = Boolean(claude?.found && claude.runtimeOk);
  // `claude === null` means initial detection hasn't completed yet (App.tsx
  // sets it after find_claude or after reading workspace.claudePath). During
  // that window we don't yet know whether to show the Install card or the
  // Auth picker — guessing wrong flashes the wrong UI for ~500-2000ms on
  // cold start, which reads as a bug to the user ("install steps showing
  // even though Claude is connected").
  const claudeDetecting = claude === null;
  const claudeMissing = !claudeDetecting && !claudeReady;
  const activeLayer = profileLayers.find((item) => item.source === question?.layer) ?? profileLayers[0];
  const activeLayerIndex = profileLayers.findIndex((item) => item.source === activeLayer.source);
  const layerQuestions = onboardingQuestions.filter((item) => item.layer === activeLayer.source);
  const questionIndexInLayer = Math.max(0, layerQuestions.findIndex((item) => item.id === question?.id));

  const grouped = useMemo(() =>
    profileLayers.map((layer) => {
      const items = onboardingQuestions.filter((item) => item.layer === layer.source);
      return { ...layer, total: items.length, answered: items.filter((item) => answers[item.id]?.trim()).length };
    })
  , [answers]);

  async function autoDetectClaude() {
    setSaving(true);
    setSetupMessage(null);
    try {
      const detected = await onClaudeChanged();
      setSetupMessage(detected.found
        ? `Detected ${detected.version ?? "Claude Code"}.`
        : detected.error ?? "Claude Code was not found.");
    } finally { setSaving(false); }
  }

  async function saveManualPath() {
    if (!manualPath.trim()) return;
    setSaving(true);
    setSetupMessage(null);
    try {
      const response = await invoke<{ stored: boolean; version: string | null; error?: string }>("set_claude_path", { path: manualPath.trim() });
      setSetupMessage(response.stored ? `Saved Claude Code ${response.version ?? ""}`.trim() : response.error ?? "Invalid Claude path.");
      await onClaudeChanged();
    } finally { setSaving(false); }
  }

  async function continueFromConnect() {
    setSaving(true);
    try {
      // Note: `claude_auth_mode` was a legacy key from an earlier flow that
      // nothing reads anymore. The new auth picker writes `claude_auth_method`
      // and the hydration effect reads that. We keep no longer write the
      // legacy key — it was a no-op and the mismatch made debugging confusing.
      setStage("profile");
    } finally { setSaving(false); }
  }

  async function submitAnswer() {
    if (!question || !draft.trim()) return;
    setSaving(true);
    const nextAnswers = { ...answers, [question.id]: draft.trim() };
    const nextStep = step + 1;
    setAnswers(nextAnswers);
    await invoke("save_onboarding_answer", { questionId: question.id, value: draft.trim(), step: nextStep });
    if (nextStep >= onboardingQuestions.length) {
      await invoke("complete_onboarding", { answers: nextAnswers });
      setStage("finish");
    }
    setStep(nextStep);
    setDraft(nextStep < onboardingQuestions.length ? nextAnswers[onboardingQuestions[nextStep].id] ?? "" : "");
    setSaving(false);
  }

  async function finish() {
    setSaving(true);
    setSetupMessage(null);
    await invoke("complete_onboarding", { answers });
    await onRefreshWorkspace();
    setSaving(false);
    onNavigate("command");
  }

  function goBackQuestion() {
    if (step === 0) {
      // First question → step back into Connect stage
      setStage("connect");
      return;
    }
    const previous = step - 1;
    setStep(previous);
    setDraft(answers[onboardingQuestions[previous]?.id] ?? "");
  }

  function goBackFromFinish() {
    // Step back to the last question of profile so the user can edit it.
    const last = Math.max(0, onboardingQuestions.length - 1);
    setStage("profile");
    setStep(last);
    setDraft(answers[onboardingQuestions[last]?.id] ?? "");
  }

  function skipConnect() {
    // Connect-stage Skip → advance to Profile. Skipping a step should
    // move forward one stage, not jump straight to Ready (the old
    // behavior, which surprised users testing the onboarding flow).
    setSetupMessage(null);
    setStage("profile");
  }

  function skipProfile() {
    // Profile-stage Skip → jump straight to Ready. The user has already
    // moved past Connect at this point; bouncing through more questions
    // they explicitly skipped would be friction. The Ready summary card
    // gives them a confirmation step before landing in chat.
    setSetupMessage(null);
    setStage("finish");
  }

  function jumpToLayer(layer: (typeof profileLayers)[number]) {
    const layerIndex = profileLayers.findIndex((item) => item.source === layer.source);
    const unlocked = profileLayers.slice(0, layerIndex).every((previousLayer) => {
      const previousQuestions = onboardingQuestions.filter((item) => item.layer === previousLayer.source);
      return previousQuestions.every((item) => answers[item.id]?.trim());
    });
    if (!unlocked && layerIndex > activeLayerIndex) return;
    const target = onboardingQuestions.findIndex((item) => item.layer === layer.source && !answers[item.id]?.trim());
    const fallback = onboardingQuestions.findIndex((item) => item.layer === layer.source);
    const next = target >= 0 ? target : fallback;
    if (next < 0) return;
    setStep(next);
    setDraft(answers[onboardingQuestions[next]?.id] ?? "");
  }

  const currentStageIndex = stages.findIndex((s) => s.id === stage);

  return (
    <section className="onboarding-v2">
      <div className="onboarding-v2-shell">
        <ol className="onboarding-v2-stages" aria-label="Setup progress">
          {stages.map((s, idx) => {
            const done = idx < currentStageIndex || (s.id === "finish" && completed);
            const active = s.id === stage;
            return (
              <li key={s.id} className={`onboarding-v2-stage ${active ? "is-active" : ""} ${done ? "is-done" : ""}`}>
                <span className="onboarding-v2-stage-dot">{done ? <Check size={11} strokeWidth={3} /> : idx + 1}</span>
                <span className="onboarding-v2-stage-label">{s.label}</span>
                {idx < stages.length - 1 ? <span className="onboarding-v2-stage-rule" /> : null}
              </li>
            );
          })}
        </ol>

        {stage === "connect" ? (
          <div className="onboarding-v2-body">
            <div className="onboarding-v2-intro">
              <h1>Connect <em>Claude Code</em>.</h1>
              <p>AIOS uses Claude Code as the local backend that reads your files, runs your commands, and streams responses. Connect the executable once — everything else flows from there.</p>
            </div>

            <div className="card connect-card">
              <div className="connect-card-row">
                <div className="connect-card-icon"><Terminal size={18} /></div>
                <div className="connect-card-copy">
                  <strong>Claude Code</strong>
                  <span>{claudeReady ? `Connected · ${claude?.version ?? "ready"}` : "Auto-detect or paste the path manually."}</span>
                </div>
                <span className={`status-pill ${claudeReady ? "is-ok" : "is-pending"}`}>
                  {claudeReady ? <><Check size={11} strokeWidth={3} /> Connected</> : "Not connected"}
                </span>
              </div>

              <div className="hairline" />

              <div className="connect-card-actions">
                <button className="btn-pill" onClick={autoDetectClaude} disabled={saving}>
                  {saving ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
                  Auto-detect
                </button>
                <button className="btn-pill-ghost" onClick={async () => {
                  setSaving(true);
                  const r = await invoke<{ ok: boolean; version: string | null; error?: string }>("test_claude_connection");
                  setSetupMessage(r.ok ? `Connection ok · ${r.version}` : r.error ?? "Connection failed.");
                  setSaving(false);
                }} disabled={saving}>
                  <Terminal size={14} />
                  Test
                </button>
              </div>

              <div className="connect-manual">
                <p className="eyebrow-rule">Manual path</p>
                <div className="connect-manual-row">
                  <input
                    value={manualPath}
                    onChange={(event) => setManualPath(event.target.value)}
                    placeholder={/^Mac/i.test(navigator.platform) ? "/opt/homebrew/bin/claude" : "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd"}
                    spellCheck={false}
                  />
                  <button className="btn-pill-ghost" onClick={saveManualPath} disabled={saving || !manualPath.trim()}>Save</button>
                </div>
              </div>
            </div>

            {setupMessage ? <p className={`onboarding-v2-msg ${/fail|not|invalid/i.test(setupMessage) ? "is-warn" : "is-ok"}`}>{setupMessage}</p> : null}

            {claudeDetecting ? (
              <div className="onboarding-v2-msg">
                <Loader2 size={12} className="spin" /> Checking for Claude Code on this machine…
              </div>
            ) : null}

            {claudeMissing ? (
              <div className="onboarding-v2-help">
                <div className="onboarding-v2-help-row">
                  <div className="onboarding-v2-help-text">
                    <strong>Don't have Claude Code yet?</strong>
                    <span>
                      AIOS can install it for you — runs the official Anthropic
                      installer ({isMacOrLinux ? "curl + bash" : "PowerShell"}).
                      No Node or npm required.
                    </span>
                  </div>
                  {installState === "idle" || installState === "failed" ? (
                    <button
                      type="button"
                      className="btn-pill"
                      onClick={installClaude}
                      disabled={saving}
                    >
                      <Download size={14} />
                      {installState === "failed" ? "Try again" : "Install Claude Code"}
                    </button>
                  ) : null}
                  {installState === "running" ? (
                    <span className="status-pill is-pending">
                      <Loader2 size={11} className="spin" /> Installing…
                    </span>
                  ) : null}
                  {installState === "done" ? (
                    <span className="status-pill is-ok">
                      <Check size={11} strokeWidth={3} /> Installed
                    </span>
                  ) : null}
                </div>

                {installState === "running" || installState === "failed" || installState === "done" ? (
                  <>
                    <div className="hairline" />
                    <pre
                      ref={installLogRef}
                      className={`onboarding-v2-install-log ${installState === "failed" ? "is-failed" : ""}`}
                      aria-live="polite"
                    >
                      {installLog || (installState === "running" ? "Starting installer…" : "")}
                    </pre>
                    {installState === "failed" ? (
                      <div className="onboarding-v2-help-row">
                        <div className="onboarding-v2-help-text">
                          <AlertTriangle size={11} /> If the auto-installer keeps
                          failing, install manually from Anthropic's docs and we'll
                          pick it up on next launch.
                        </div>
                        <button
                          type="button"
                          className="onboarding-v2-link"
                          onClick={() => { void window.aios?.openExternal?.("https://docs.claude.com/en/docs/claude-code/setup"); }}
                        >
                          Open install docs
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}

                <div className="hairline" />
                <div className="onboarding-v2-help-row">
                  <div className="onboarding-v2-help-text">
                    <strong>Already installed but we can't find it?</strong>
                    <span>Open Terminal, run this, copy the output, paste it into Manual Path above:</span>
                  </div>
                </div>
                <div className="onboarding-v2-copy-row">
                  <code>{whereCmd}</code>
                  <button
                    type="button"
                    className="onboarding-v2-copy-btn"
                    title="Copy command"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(whereCmd)
                        .then(() => {
                          setCopiedHint(true);
                          window.setTimeout(() => setCopiedHint(false), 1200);
                        })
                        .catch(() => undefined);
                    }}
                  >
                    {copiedHint ? <Check size={11} /> : <ClipboardCopy size={11} />}
                    {copiedHint ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}

            {/*
              Only auto-show the auth picker when AIOS just ran the installer
              this session (installState === "done"). Users who already had
              Claude Code installed before AIOS launched almost certainly have
              it authenticated already (otherwise their existing setup
              wouldn't work), so making them pick an auth method again is
              friction without value. If chat later fails with an auth error
              we can surface the picker reactively.
            */}
            {claudeReady && !authMethod && installState === "done" ? (
              <div className="onboarding-v2-auth">
                <div className="onboarding-v2-auth-head">
                  <p className="eyebrow">Sign in to Claude</p>
                  <h2>Connect your Claude account.</h2>
                  <p>
                    We opened a terminal running <code>claude /login</code>. It walks you through
                    picking your auth method (Claude.ai for Pro/Max, or an API key) and signs you in.
                    Once you're done, click <em>I've signed in</em>.
                  </p>
                </div>

                <div className="onboarding-v2-auth-grid">
                  <div className="onboarding-v2-auth-card is-active">
                    <div className="onboarding-v2-auth-card-head">
                      <div className="onboarding-v2-auth-icon"><LogIn size={16} /></div>
                      <div>
                        <strong>Sign in via terminal</strong>
                        <span>Use the <code>claude /login</code> window we just opened.</span>
                      </div>
                    </div>
                    <div className="onboarding-v2-auth-card-body">
                      <div className="onboarding-v2-auth-actions">
                        <button
                          type="button"
                          className="btn-pill-ghost"
                          onClick={openClaudeLoginTerminal}
                          disabled={authBusy}
                        >
                          <Terminal size={14} /> Reopen terminal
                        </button>
                        <button
                          type="button"
                          className="btn-pill"
                          onClick={confirmClaudeLogin}
                          disabled={authBusy}
                        >
                          <Check size={14} /> I've signed in
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {authMessage ? (
                  <p className={`onboarding-v2-msg ${/fail|couldn|error/i.test(authMessage) ? "is-warn" : "is-ok"}`}>
                    {authMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            {claudeReady && authMethod ? (
              <p className="onboarding-v2-msg is-ok">
                <Check size={12} /> Auth method set:{" "}
                {authMethod === "claude_login" ? "Claude.ai account"
                  : authMethod === "api_key" ? "Anthropic API key"
                  : "Skipped (configure later)"}.
                {" "}
                <button
                  type="button"
                  className="onboarding-v2-link is-inline"
                  onClick={() => { setAuthMethod(null); setAuthMessage(null); }}
                >
                  Change
                </button>
              </p>
            ) : null}

            <div className="onboarding-v2-foot">
              <button className="btn-pill-ghost" onClick={skipConnect} disabled={saving}>
                Skip for now
              </button>
              <button
                className="btn-pill"
                onClick={continueFromConnect}
                disabled={saving || !claudeReady}
              >
                Continue
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : null}

        {stage === "profile" && !completed && question ? (
          <div className="onboarding-v2-body is-profile">
            <div className="onboarding-v2-intro is-tight">
              <h1>Build <em>your context</em>.</h1>
              <p>A few short answers so AIOS knows who you are and what you're moving. Refine later in Context.</p>
            </div>

            <nav className="onboarding-v2-layers" aria-label="Profile layers">
              {grouped.map((layer, idx) => {
                const active = layer.source === activeLayer.source;
                const done = layer.answered >= layer.total;
                const unlocked = grouped.slice(0, idx).every((p) => p.answered >= p.total);
                return (
                  <button
                    key={layer.source}
                    type="button"
                    className={`onboarding-v2-layer ${active ? "is-active" : ""} ${done ? "is-done" : ""} ${unlocked ? "" : "is-locked"}`}
                    onClick={() => jumpToLayer(layer)}
                    disabled={!unlocked && !active}
                    title={unlocked ? layer.label : "Complete the previous section first"}
                  >
                    <strong>{layer.label}</strong>
                    <small>{layer.answered}/{layer.total}</small>
                  </button>
                );
              })}
            </nav>

            <div className="card onboarding-v2-question is-tight" key={question.id}>
              <p className="eyebrow-rule">{activeLayer.eyebrow} · {questionIndexInLayer + 1} of {layerQuestions.length}</p>
              <h2>{question.question}</h2>
              <textarea
                className="onboarding-v2-answer"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitAnswer();
                  }
                }}
                placeholder="A short, plain-English answer is perfect."
                autoFocus
              />
              <div className="onboarding-v2-question-foot">
                <span>Enter to continue · Shift + Enter for a new line</span>
                <span>{draft.trim().length ? `${draft.trim().length} chars` : "—"}</span>
              </div>
            </div>

            <div className="onboarding-v2-foot">
              <div className="onboarding-v2-foot-group">
                <button className="btn-pill-ghost" onClick={goBackQuestion} disabled={saving}>
                  <ArrowLeft size={14} />
                  Back
                </button>
                <button className="btn-pill-ghost" onClick={skipProfile} disabled={saving}>
                  Skip for now
                </button>
              </div>
              <span className="onboarding-v2-foot-hint">{answeredCount}/{onboardingQuestions.length} answered</span>
              <button className="btn-pill" onClick={submitAnswer} disabled={saving || !draft.trim()}>
                {saving ? <Loader2 size={14} className="spin" /> : null}
                {step + 1 >= onboardingQuestions.length ? "Save and finish" : "Next"}
                {!saving && step + 1 < onboardingQuestions.length ? <ArrowRight size={14} /> : null}
              </button>
            </div>
          </div>
        ) : null}

        {(stage === "finish" || completed) ? (
          <div className="onboarding-v2-body is-finish">
            <div className="onboarding-v2-intro is-finish-intro">
              <h1>AIOS is <em>ready</em>.</h1>
              <p>Your context lives in local Markdown files. Claude opens every session with this in mind.</p>
            </div>

            <div className="onboarding-v2-summary">
              <div className="onboarding-v2-summary-row">
                <span className="onboarding-v2-summary-icon"><ShieldCheck size={14} /></span>
                <strong>Claude connection</strong>
                <span>{claudeReady ? "Verified" : "Needs review"}</span>
              </div>
              <div className="hairline" />
              <div className="onboarding-v2-summary-row">
                <span className="onboarding-v2-summary-icon"><UserRound size={14} /></span>
                <strong>Profile context</strong>
                <span>{answeredCount} answers saved</span>
              </div>
              <div className="hairline" />
              <div className="onboarding-v2-summary-row">
                <span className="onboarding-v2-summary-icon"><CheckCircle2 size={14} /></span>
                <strong>Workspace files</strong>
                <span>context/*.md ready</span>
              </div>
            </div>

            <div className="onboarding-v2-foot is-finish-foot">
              <button className="btn-pill-ghost" onClick={goBackFromFinish} disabled={saving}>
                <ArrowLeft size={14} />
                Back
              </button>
              <span className="onboarding-v2-foot-hint">Saved locally in your AIOS workspace.</span>
              <button className="btn-pill" onClick={finish} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : null}
                Start using AIOS
                <ArrowRight size={14} />
              </button>
            </div>
            {setupMessage ? <p className="onboarding-v2-msg is-ok">{setupMessage}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

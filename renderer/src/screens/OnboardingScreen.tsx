import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  Search,
  ShieldCheck,
  Terminal,
  UserRound
} from "lucide-react";
import { invoke } from "../lib/api";
import { onboardingQuestions } from "../lib/onboarding";
import type { ClaudeStatus } from "../types";
import type { OnboardingState, Screen } from "../ui";

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

  const question = onboardingQuestions[step];
  const completed = Boolean(state?.completedAt) || step >= onboardingQuestions.length;
  const answeredCount = onboardingQuestions.filter((item) => answers[item.id]?.trim()).length;
  const claudeReady = Boolean(claude?.found && claude.runtimeOk);
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
      await invoke("set_setting", { key: "claude_auth_mode", value: "claude_code" });
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

  function skipProfile() {
    // Match the Next-button flow: don't immediately bounce into chat, route
    // through the stage-3 "Ready" summary so the user gets the same
    // confirmation card and clicks "Start using AIOS" themselves. The
    // existing finish() handler is what actually persists onboarding state
    // and navigates, so we don't duplicate that work here.
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

            {!claudeReady ? (
              <div className="onboarding-v2-help">
                <div className="onboarding-v2-help-row">
                  <div className="onboarding-v2-help-text">
                    <strong>Don't have Claude Code yet?</strong>
                    <span>It's a free CLI from Anthropic — install once, AIOS finds it next launch.</span>
                  </div>
                  <button
                    type="button"
                    className="onboarding-v2-link"
                    onClick={() => { void window.aios?.openExternal?.("https://docs.anthropic.com/en/docs/claude-code/setup"); }}
                  >
                    Install Claude Code
                    <ExternalLink size={11} />
                  </button>
                </div>
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

            <div className="onboarding-v2-foot">
              <button className="btn-pill-ghost" onClick={skipProfile} disabled={saving}>
                Skip for now
              </button>
              <button className="btn-pill" onClick={continueFromConnect} disabled={saving || !claudeReady}>
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

import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  Zap
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "../lib/api";
import type { ConnectionStatus, FilePreview, ModuleInfo } from "../types";

const NAME_MAP: Record<string, string> = {
  "context-os": "ContextOS",
  "data-os": "DataOS",
  "intel-os": "IntelOS",
  "infra-os": "InfraOS",
  "productivity-os": "ProductivityOS",
  "daily-brief": "Daily Brief"
};

function prettyName(id: string): string {
  return NAME_MAP[id] || id;
}

export function ModulesScreen({
  modules,
  connections,
  onAskClaude,
  onNavigate
}: {
  modules: ModuleInfo[];
  connections: ConnectionStatus[];
  onChanged: () => Promise<void>;
  onAskClaude: (prompt: string) => void;
  onNavigate: (screen: string) => void;
}) {
  const installedIds = useMemo(
    () => new Set(modules.filter((m) => m.installed).map((m) => m.id)),
    [modules]
  );

  const installedCount = modules.filter((m) => m.installed).length;
  const totalCount = modules.length;
  const progressPct = totalCount > 0 ? Math.round((installedCount / totalCount) * 100) : 0;

  const recommendedNext = useMemo(() => {
    const sorted = [...modules].sort((a, b) => a.phase - b.phase);
    return sorted.find(
      (m) =>
        !m.installed &&
        !m.builtIn &&
        m.sourceExists &&
        (m.requires ?? []).every((r) => installedIds.has(r))
    );
  }, [modules, installedIds]);

  return (
    <section className="modules-screen">
      <div className="modules-shell">
        <header className="modules-hero">
          <div className="modules-hero-left">
            <p className="modules-eyebrow">Layer · Modules</p>
            <h1>AIOS <em>modules</em></h1>
            <p className="modules-hero-detail">
              Plug-and-play building blocks for your AIOS. Install them one at a time, in order — each unlocks
              a new capability, and Claude walks you through the setup.
            </p>
          </div>
          <div className="modules-progress-card">
            <div className="modules-progress-numbers">
              <span className="modules-progress-big">{installedCount}</span>
              <span className="modules-progress-of">of {totalCount}</span>
            </div>
            <span className="modules-progress-label">installed</span>
            <div className="modules-progress-bar">
              <div className="modules-progress-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </header>

        {recommendedNext ? (
          <div className="modules-next">
            <div className="modules-next-text">
              <span className="modules-next-eyebrow">
                <Sparkles size={12} />
                Recommended next
              </span>
              <h2>{recommendedNext.name}</h2>
              <p>{recommendedNext.description || recommendedNext.capability}</p>
            </div>
            <button
              type="button"
              className="modules-next-cta"
              onClick={() => onAskClaude(`/install ${recommendedNext.installPath}`)}
            >
              Install {recommendedNext.name}
              <ArrowRight size={14} />
            </button>
          </div>
        ) : null}

        <div className="modules-list">
          {modules.map((module) => (
            <ModuleRow
              key={module.id}
              module={module}
              installedIds={installedIds}
              onAskClaude={onAskClaude}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        {connections.length > 0 ? (
          <div className="modules-connections-panel">
            <div className="modules-connections-head">
              <span className="modules-connections-eyebrow">Runtime</span>
              <h3>Workspace readiness</h3>
            </div>
            <div className="modules-connections-list">
              {connections.map((connection) => (
                <div className="modules-connection-row" key={connection.id}>
                  <div>
                    <strong>{connection.label}</strong>
                    <span>{connection.detail}</span>
                  </div>
                  <span className={`modules-connection-pill is-${connection.status}`}>
                    {connection.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ModuleRow({
  module,
  installedIds,
  onAskClaude,
  onNavigate
}: {
  module: ModuleInfo;
  installedIds: Set<string>;
  onAskClaude: (prompt: string) => void;
  onNavigate: (screen: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [readme, setReadme] = useState<string | null>(null);
  const [loadingReadme, setLoadingReadme] = useState(false);

  const requires = module.requires ?? [];
  const missingDeps = requires.filter((r) => !installedIds.has(r));
  const sourceMissing = !module.sourceExists;
  // Once a module is installed, it can always be reinstalled — dependency check only blocks fresh installs.
  const blockedByDeps = missingDeps.length > 0 && !module.installed;
  const blocked = sourceMissing || blockedByDeps;

  const status: "builtin" | "installed" | "ready" | "locked" | "missing" = module.builtIn
    ? "builtin"
    : sourceMissing
      ? "missing"
      : module.installed
        ? "installed"
        : blockedByDeps
          ? "locked"
          : "ready";

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !readme && !sourceMissing) {
      setLoadingReadme(true);
      try {
        const data = await invoke<FilePreview>("read_markdown_preview", {
          path: `${module.installPath}/README.md`
        });
        setReadme(data?.content ?? "");
      } finally {
        setLoadingReadme(false);
      }
    }
  }

  function startInstall() {
    onAskClaude(`/install ${module.installPath}`);
  }

  return (
    <article className={`modules-row is-${status}`}>
      <button
        type="button"
        className="modules-row-main"
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        <div className="modules-phase">
          <span className="modules-phase-number">{module.phase}</span>
        </div>
        <div className="modules-row-text">
          <div className="modules-row-title">
            <strong>{module.name}</strong>
            <StatusChip status={status} missingDeps={missingDeps} />
          </div>
          <p className="modules-row-desc">{module.description || module.capability}</p>
          <div className="modules-row-meta">
            {requires.length > 0 ? (
              <span className="modules-meta-item">
                <span className="modules-meta-label">Needs</span>
                {requires.map((r, i) => (
                  <span key={r} className={`modules-meta-dep ${installedIds.has(r) ? "ok" : "missing"}`}>
                    {prettyName(r)}{i < requires.length - 1 ? "," : ""}
                  </span>
                ))}
              </span>
            ) : null}
            {module.connections && module.connections.length > 0 ? (
              <span className="modules-meta-item">
                <span className="modules-meta-label">Connects</span>
                {module.connections.join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
        <span className="modules-row-chev">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      <div className="modules-row-action">
        {module.builtIn ? (
          <button
            type="button"
            className="modules-install-btn is-builtin"
            onClick={() => onNavigate(module.builtInRoute || "command")}
            title={module.builtInButtonLabel || "Open"}
          >
            <ExternalLink size={13} />
            <span>{module.builtInButtonLabel || "Open"}</span>
          </button>
        ) : (
          <button
            type="button"
            className={`modules-install-btn ${module.installed ? "is-reinstall" : ""}`}
            disabled={blocked}
            onClick={startInstall}
            title={
              blockedByDeps
                ? `Install ${missingDeps.map(prettyName).join(", ")} first`
                : sourceMissing
                  ? "Module source folder is missing on disk"
                  : undefined
            }
          >
            {sourceMissing ? <Lock size={13} /> : module.installed ? <RefreshCw size={13} /> : blocked ? <Lock size={13} /> : <Download size={13} />}
            <span>
              {sourceMissing
                ? "Source missing"
                : module.installed
                  ? "Reinstall"
                  : blockedByDeps
                    ? `Install ${prettyName(missingDeps[0])} first`
                    : "Install"}
            </span>
          </button>
        )}
      </div>

      {expanded ? (
        <div className="modules-row-expand">
          {module.artifacts && module.artifacts.length > 0 ? (
            <div className="modules-expand-meta">
              <span className="modules-meta-label">Adds to workspace</span>
              <code className="modules-meta-mono">{module.artifacts.join("    ")}</code>
            </div>
          ) : null}
          <div className="modules-expand-readme">
            {loadingReadme ? (
              <div className="modules-readme-loading">
                <Loader2 size={14} className="spin" />
                Loading README…
              </div>
            ) : readme ? (
              <div className="aios-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
              </div>
            ) : sourceMissing ? (
              <p className="modules-readme-empty">Source folder is missing — nothing to preview.</p>
            ) : (
              <p className="modules-readme-empty">No README available.</p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function StatusChip({
  status,
  missingDeps
}: {
  status: "builtin" | "installed" | "ready" | "locked" | "missing";
  missingDeps: string[];
}) {
  if (status === "builtin") {
    return (
      <span className="modules-status is-builtin">
        <Zap size={11} />
        Built in
      </span>
    );
  }
  if (status === "installed") {
    return (
      <span className="modules-status is-installed">
        <Check size={11} />
        Installed
      </span>
    );
  }
  if (status === "missing") {
    return <span className="modules-status is-missing">Source missing</span>;
  }
  if (status === "locked") {
    return (
      <span className="modules-status is-locked">
        Needs {missingDeps.map(prettyName).join(", ")}
      </span>
    );
  }
  return <span className="modules-status is-ready">Ready to install</span>;
}

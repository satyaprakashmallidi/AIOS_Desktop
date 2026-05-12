import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  Building2,
  Crown,
  DollarSign,
  Loader2,
  Megaphone,
  Microscope,
  PenLine,
  Save,
  Sparkles,
  TrendingUp,
  Wand2,
  Wrench,
  X
} from "lucide-react";
import { invoke } from "../lib/api";
import type { AgentInfo } from "../types";

type AgentIcon = React.ComponentType<{ size?: number }>;

const ICONS: Record<string, AgentIcon> = {
  ceo: Crown,
  product: Sparkles,
  engineering: Wrench,
  marketing: Megaphone,
  sales: TrendingUp,
  operations: Building2,
  finance: DollarSign,
  research: Microscope,
  assistant: Wand2,
  content: PenLine
};

function iconFor(agent: AgentInfo): AgentIcon {
  return ICONS[agent.id] || Briefcase;
}

export function AgentsScreen({ onBackToSettings }: { onBackToSettings?: () => void }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    // Listen for CEO-spawned custom agents (the runner broadcasts this when
    // it processes a [SPAWN_AGENT:] sentinel). New agents show up instantly
    // instead of waiting for a manual refresh / screen reopen.
    const unsub = window.aios?.onHostEvent?.((event: any) => {
      if (event?.event === "agents_changed") void refresh();
    });
    return () => unsub?.();
  }, []);

  async function refresh() {
    setLoadError(null);
    try {
      const res = await invoke<{ agents: AgentInfo[] }>("list_agents", {});
      setAgents(res?.agents || []);
    } catch (err) {
      console.error("Failed to load agents:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const ceo = useMemo(() => agents.find((a) => a.id === "ceo") || null, [agents]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, AgentInfo[]>();
    for (const a of agents) {
      if (!a.parent_id) continue;
      const list = map.get(a.parent_id) || [];
      list.push(a);
      map.set(a.parent_id, list);
    }
    // Stable ordering: built-ins first (alpha), then custom (by created_at)
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.is_builtin !== b.is_builtin) return a.is_builtin ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [agents]);
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedId) || null,
    [agents, selectedId]
  );

  if (loading) {
    return (
      <section className="agents-screen">
        <div className="agents-loading">
          <Loader2 size={16} className="spin" />
          Loading agents…
        </div>
      </section>
    );
  }

  return (
    <section className="agents-screen">
      <header className="agents-hero">
        <div className="agents-hero-top">
          <button
            type="button"
            className="agents-back-button"
            onClick={onBackToSettings}
            disabled={!onBackToSettings}
          >
            <ArrowLeft size={14} />
            Back to settings
          </button>
        </div>
        <div className="agents-hero-text">
          <p className="layer-badge">
            <span className="layer-dot" aria-hidden="true" />
            Layer · Agents
          </p>
          <h1>Your <em>team</em></h1>
          <p className="agents-hero-detail">
            One CEO at the top with global context. Eight department specialists below — each focused on one job. Click any agent to read or rewrite its operating prompt.
          </p>
        </div>
      </header>

      <div className="agents-body">
        {agents.length === 0 ? (
          <div className="agents-empty">
            <Loader2 size={20} aria-hidden="true" />
            <h3>{loadError ? "Couldn't load your agents" : "Agents not loaded yet"}</h3>
            <p>
              {loadError
                ? `The local agent registry isn't responding. ${loadError}`
                : "Your agent roster lives in the local Python sidecar. If you just upgraded, please restart AIOS to initialize the 10 built-in agents."}
            </p>
            <button type="button" className="button button-secondary compact" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : ceo ? (
          <div className="org-tree">
            <OrgNode
              agent={ceo}
              childrenByParent={childrenByParent}
              selectedId={selectedId}
              onSelect={setSelectedId}
              isRoot
            />
          </div>
        ) : null}
      </div>

      {selectedAgent && (
        <AgentDetailDrawer
          agent={selectedAgent}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => {
            setAgents((cur) => cur.map((a) => (a.id === updated.id ? updated : a)));
          }}
          onDeleted={(deletedId) => {
            setAgents((cur) => cur.filter((a) => a.id !== deletedId));
            setSelectedId(null);
          }}
        />
      )}
    </section>
  );
}

function AgentTile({ agent }: { agent: AgentInfo }) {
  const Icon = iconFor(agent);
  const customised = !!agent.custom_prompt;
  return (
    <>
      <span className="agents-card-icon" aria-hidden="true"><Icon size={16} /></span>
      <span className="agents-card-name">{agent.name}</span>
      <span className="agents-card-role">{agent.role}</span>
      {customised && <span className="agents-card-badge">edited</span>}
    </>
  );
}

function OrgNode({
  agent,
  childrenByParent,
  selectedId,
  onSelect,
  isRoot
}: {
  agent: AgentInfo;
  childrenByParent: Map<string, AgentInfo[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isRoot?: boolean;
}) {
  const children = childrenByParent.get(agent.id) || [];
  return (
    <div className={`org-node ${isRoot ? "is-root" : ""}`}>
      <button
        type="button"
        className={`agents-card ${isRoot ? "agents-card-ceo" : ""} ${!agent.is_builtin ? "is-custom" : ""} ${selectedId === agent.id ? "is-selected" : ""}`}
        onClick={() => onSelect(agent.id)}
      >
        <AgentTile agent={agent} />
      </button>

      {children.length > 0 && (
        <>
          <div className="org-stem-down" aria-hidden="true" />
          <div className="org-junction" aria-hidden="true" />
          <div className="org-children">
            {children.map((child) => (
              <div key={child.id} className="org-subtree">
                <div className="org-stem-up" aria-hidden="true" />
                <OrgNode
                  agent={child}
                  childrenByParent={childrenByParent}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentDetailDrawer({
  agent,
  onClose,
  onUpdated,
  onDeleted
}: {
  agent: AgentInfo;
  onClose: () => void;
  onUpdated: (agent: AgentInfo) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState(agent.custom_prompt ?? agent.default_prompt);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // When the user clicks a different agent, sync the local draft.
  useEffect(() => {
    setDraft(agent.custom_prompt ?? agent.default_prompt);
    setSavedFlash(false);
  }, [agent.id, agent.custom_prompt, agent.default_prompt]);

  const isCustomised = !!agent.custom_prompt;
  const hasUnsavedEdits = draft.trim() !== (agent.custom_prompt ?? agent.default_prompt).trim();

  async function save() {
    setSaving(true);
    try {
      const updated = await invoke<AgentInfo>("update_agent_prompt", {
        id: agent.id,
        prompt: draft,
      });
      if (updated) onUpdated(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      console.error("Failed to save agent prompt:", err);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      const updated = await invoke<AgentInfo>("reset_agent_prompt", { id: agent.id });
      if (updated) {
        onUpdated(updated);
        setDraft(updated.default_prompt);
      }
    } catch (err) {
      console.error("Failed to reset agent prompt:", err);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the "${agent.name}" agent? This can't be undone.`)) return;
    setSaving(true);
    try {
      await invoke("delete_agent", { id: agent.id });
      onDeleted(agent.id);
    } catch (err) {
      console.error("Failed to delete agent:", err);
      setSaving(false);
    }
  }

  return (
    <div className="agents-drawer-overlay" onClick={onClose}>
      <aside className="agents-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="agents-drawer-head">
          <div>
            <p className="agents-drawer-eyebrow">{agent.is_builtin ? "Built-in agent" : "Custom agent"}</p>
            <h2>{agent.name}</h2>
            <p className="agents-drawer-role">{agent.role}</p>
          </div>
          <button type="button" className="agents-drawer-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="agents-drawer-body">
          <div className="agents-drawer-field">
            <div className="agents-drawer-field-head">
              <span className="agents-drawer-field-label">System prompt</span>
              {isCustomised && <span className="agents-drawer-badge">customised</span>}
            </div>
            <textarea
              className="agents-drawer-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={24}
            />
            <p className="agents-drawer-hint">
              This is the system prompt Claude receives when this agent runs a task.
              `{`USER_CONTEXT`}` is replaced at run-time with the user's profile
              from <code>context/*.md</code>.
            </p>
          </div>
        </div>

        <footer className="agents-drawer-foot">
          <div className="agents-drawer-foot-left">
            {!agent.is_builtin && (
              <button
                type="button"
                className="button button-ghost compact agents-drawer-delete"
                onClick={remove}
                disabled={saving}
              >
                Delete agent
              </button>
            )}
            {agent.is_builtin && isCustomised && (
              <button
                type="button"
                className="button button-ghost compact"
                onClick={reset}
                disabled={saving}
              >
                Reset to default
              </button>
            )}
          </div>
          <div className="agents-drawer-foot-right">
            {savedFlash && <span className="agents-drawer-saved">Saved</span>}
            <button
              type="button"
              className="button button-primary compact"
              onClick={save}
              disabled={saving || !hasUnsavedEdits}
            >
              {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
              Save changes
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

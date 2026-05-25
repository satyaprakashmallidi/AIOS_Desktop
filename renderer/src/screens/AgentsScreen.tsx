import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  Crown,
  DollarSign,
  Loader2,
  Maximize2,
  Megaphone,
  Microscope,
  PenLine,
  Plus,
  Save,
  Sparkles,
  TrendingUp,
  Wand2,
  Wand,
  Wrench,
  X
} from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { invoke } from "../lib/api";
import { ConfirmModal } from "../components/ui";
import type { AgentInfo, ClaudeStatus } from "../types";

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

const POSITIONS_KEY = "aios.agents.canvas.positions.v3";
const COL_SPACING = 210;
const CHILDREN_Y = 220;

type StoredPositions = Record<string, { x: number; y: number }>;

function loadStoredPositions(): StoredPositions {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredPositions) : {};
  } catch {
    return {};
  }
}

function saveStoredPositions(positions: StoredPositions) {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    // localStorage full or unavailable — silently skip; positions reset on next load.
  }
}

function rowPosition(index: number, total: number): { x: number; y: number } {
  // Single horizontal row centered around x=0. Edges from CEO never cross other nodes.
  const x = (index - (total - 1) / 2) * COL_SPACING;
  return { x: Math.round(x), y: CHILDREN_Y };
}

function computeDefaultPosition(
  agent: AgentInfo,
  childIndex: number,
  childTotal: number
): { x: number; y: number } {
  if (agent.id === "ceo") return { x: 0, y: 0 };
  return rowPosition(childIndex, childTotal);
}

type AgentNodeData = {
  agent: AgentInfo;
  kind: "ceo" | "specialist" | "custom";
  onOpen: (id: string) => void;
};

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, kind, onOpen } = data;
  const Icon = iconFor(agent);
  const customised = !!agent.custom_prompt;
  return (
    <div
      className={`agents-node agents-node-${kind} ${customised ? "is-edited" : ""}`}
      onDoubleClick={() => onOpen(agent.id)}
      title="Double-click to edit prompt"
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="agents-node-icon" aria-hidden="true">
        <Icon size={kind === "ceo" ? 17 : 14} />
      </span>
      <div className="agents-node-text">
        <span className="agents-node-name">{agent.name}</span>
        <span className="agents-node-role">{agent.role}</span>
      </div>
      <div className="agents-node-badges">
        {customised && <span className="agents-node-badge">Edited</span>}
        {kind === "custom" && <span className="agents-node-badge is-custom">Custom</span>}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { agent: AgentNode };

// Tracks the current `data-theme` attribute on <html> so canvas-side colors
// (ReactFlow Background dots) can flip with the app theme. App.tsx writes the
// attribute directly when the user picks a theme — same-window writes don't
// fire `storage` events, so we use a MutationObserver on the html attribute.
function useCurrentTheme(): string {
  const [theme, setTheme] = useState<string>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.getAttribute("data-theme") || "light";
  });
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme") || "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function AgentsScreen({ claude }: { claude: ClaudeStatus | null }) {
  return (
    <ReactFlowProvider>
      <AgentsCanvas claude={claude} />
    </ReactFlowProvider>
  );
}

function AgentsCanvas({ claude }: { claude: ClaudeStatus | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const positionsRef = useRef<StoredPositions>(loadStoredPositions());
  const rf = useReactFlow();
  const persistTimer = useRef<number | null>(null);
  const theme = useCurrentTheme();
  const dotsColor = theme === "dark"
    ? "rgba(156, 175, 165, 0.10)"   // sage-with-alpha — visible on warm-dark paper
    : "rgba(17, 17, 17, 0.08)";      // existing light value

  useEffect(() => {
    void refresh();
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

  const handleOpen = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const initialNodes = useMemo<Node<AgentNodeData>[]>(() => {
    if (agents.length === 0) return [];
    // All non-CEO children share a single horizontal row. Specialists come
    // first (alphabetical, stable order), then customs — so existing
    // positions stay put as new ones are added.
    const specialists = agents
      .filter((a) => a.id !== "ceo" && a.is_builtin)
      .sort((a, b) => a.name.localeCompare(b.name));
    const customs = agents
      .filter((a) => !a.is_builtin)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const children = [...specialists, ...customs];
    const childIndex = new Map(children.map((a, i) => [a.id, i]));
    return agents.map((agent) => {
      const stored = positionsRef.current[agent.id];
      const position =
        stored ??
        computeDefaultPosition(
          agent,
          childIndex.get(agent.id) ?? 0,
          children.length
        );
      // Persist computed defaults so they're stable on next mount
      if (!stored) {
        positionsRef.current[agent.id] = position;
      }
      const kind: AgentNodeData["kind"] =
        agent.id === "ceo" ? "ceo" : agent.is_builtin ? "specialist" : "custom";
      return {
        id: agent.id,
        type: "agent",
        position,
        data: { agent, kind, onOpen: handleOpen }
      };
    });
  }, [agents, handleOpen]);

  // Persist any default-position writes from the memoized compute
  useEffect(() => {
    if (initialNodes.length > 0) saveStoredPositions(positionsRef.current);
  }, [initialNodes]);

  const [nodes, setNodes] = useState<Node<AgentNodeData>[]>(initialNodes);

  // Keep node list in sync when agents change (add/remove/edit)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes]);

  // On the first arrival of agents (per mount), reset to the canonical
  // single-row tree layout and fit the viewport. Drag positions only persist
  // in-session, so switching away and back gives a clean slate. rAF here
  // avoids the setTimeout-then-setTimeout chain — one frame, instant settle.
  const didInitLayout = useRef(false);
  useEffect(() => {
    if (agents.length === 0 || didInitLayout.current) return;
    didInitLayout.current = true;
    const raf = requestAnimationFrame(() => reorganize(false));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]);

  const edges = useMemo<Edge[]>(() => {
    return agents
      .filter((a) => a.id !== "ceo" && agents.some((p) => p.id === a.parent_id))
      .map((a) => ({
        id: `${a.parent_id}->${a.id}`,
        source: a.parent_id || "ceo",
        target: a.id,
        type: "smoothstep",
        animated: false,
        // Stroke color comes from CSS — `.agents-canvas .react-flow__edge-path`
        // is theme-tokened (border-strong in light, sage-alpha in dark).
        // Passing stroke here would override the CSS and break dark mode.
        style: { strokeWidth: 1.5 }
      }));
  }, [agents]);

  const onNodesChange = useCallback((changes: NodeChange<Node<AgentNodeData>>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      // Persist on position changes (debounced)
      const hasPositionChange = changes.some((c) => c.type === "position");
      if (hasPositionChange) {
        next.forEach((n) => {
          positionsRef.current[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
        });
        if (persistTimer.current) window.clearTimeout(persistTimer.current);
        persistTimer.current = window.setTimeout(() => {
          saveStoredPositions(positionsRef.current);
        }, 250);
      }
      return next;
    });
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedId) || null,
    [agents, selectedId]
  );

  function reorganize(animate = true) {
    // Wipe stored positions, recompute the default tree layout from current
    // agents, write the new positions back to localStorage, and fit the
    // viewport. Used by the bottom-left button (animate=true) and by the
    // first-mount effect (animate=false for an instant settle).
    const specialists = agents
      .filter((a) => a.id !== "ceo" && a.is_builtin)
      .sort((a, b) => a.name.localeCompare(b.name));
    const customs = agents
      .filter((a) => !a.is_builtin)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const children = [...specialists, ...customs];
    const next: StoredPositions = {};
    agents.forEach((agent) => {
      if (agent.id === "ceo") {
        next[agent.id] = { x: 0, y: 0 };
      } else {
        const idx = children.findIndex((c) => c.id === agent.id);
        next[agent.id] = computeDefaultPosition(agent, Math.max(0, idx), children.length);
      }
    });
    positionsRef.current = next;
    saveStoredPositions(next);
    setNodes((current) =>
      current.map((n) => ({ ...n, position: next[n.id] || n.position }))
    );
    // Fit in the next paint so ReactFlow has the updated node positions.
    // rAF is cheaper and more accurate than setTimeout for paint-coordinated work.
    requestAnimationFrame(() => {
      rf.fitView({ padding: 0.18, maxZoom: 1, duration: animate ? 400 : 0 });
    });
  }

  async function handleCreate(input: { name: string; role: string; prompt: string }) {
    const created = await invoke<AgentInfo>("create_custom_agent", {
      name: input.name,
      role: input.role,
      prompt: input.prompt,
      parentId: "ceo"
    });
    if (created) {
      // Append to the end of the single child row. nextIndex = current child
      // count (specialists + existing customs) — that's where the new node
      // lands in the next render's computeDefaultPosition.
      const currentChildCount = agents.filter((a) => a.id !== "ceo").length;
      positionsRef.current[created.id] = computeDefaultPosition(
        created,
        currentChildCount,
        currentChildCount + 1
      );
      saveStoredPositions(positionsRef.current);
      setAgents((cur) => [...cur, created]);
      setCreateOpen(false);
      // Center the camera on the new node shortly after render
      window.setTimeout(() => {
        const pos = positionsRef.current[created.id];
        if (pos) rf.setCenter(pos.x, pos.y, { zoom: 1, duration: 400 });
      }, 80);
    }
  }

  return (
    <section className="agents-screen">
      <header className="agents-hero">
        <div className="agents-hero-text">
          <p className="layer-badge">
            <span className="layer-dot" aria-hidden="true" />
            Layer · Agents
          </p>
          <h1>Your <em>team</em></h1>
          <p className="agents-hero-detail">
            Drag any node to rearrange. Double-click to edit its system prompt.
          </p>
        </div>
      </header>

      <div className="agents-canvas-wrap">
        <button
          type="button"
          className="agents-add-fab"
          onClick={() => setCreateOpen(true)}
          title="New agent"
          aria-label="Create a new agent"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="agents-fit-fab"
          onClick={() => reorganize(true)}
          title="Reorganize and fit"
          aria-label="Reset layout and fit all nodes to view"
        >
          <Maximize2 size={14} />
        </button>
        {loading ? (
          <div className="agents-loading">
            <Loader2 size={16} className="spin" />
            Loading agents…
          </div>
        ) : agents.length === 0 ? (
          <div className="agents-empty">
            <Loader2 size={20} aria-hidden="true" />
            <h3>{loadError ? "Couldn't load your agents" : "Agents not loaded yet"}</h3>
            <p>
              {loadError
                ? `The local agent registry isn't responding. ${loadError}`
                : "Your agent roster lives in the local Python sidecar. If you just upgraded, please restart AIOS to initialize the built-in agents."}
            </p>
            <button type="button" className="button button-secondary compact" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
            minZoom={0.35}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
            className="agents-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={dotsColor} />
            <Controls showInteractive={false} showFitView={false} />
          </ReactFlow>
        )}
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
            delete positionsRef.current[deletedId];
            saveStoredPositions(positionsRef.current);
            setSelectedId(null);
          }}
        />
      )}

      {createOpen && (
        <CreateAgentModal
          claude={claude}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </section>
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
        prompt: draft
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

  const [confirmRemove, setConfirmRemove] = useState(false);
  function remove() {
    setConfirmRemove(true);
  }
  async function handleConfirmRemove() {
    setConfirmRemove(false);
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
          <button type="button" className="agents-drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
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
      <ConfirmModal
        open={confirmRemove}
        title="Delete agent?"
        message={`Delete the "${agent.name}" agent? This can't be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleConfirmRemove}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

function CreateAgentModal({
  claude,
  onClose,
  onCreate
}: {
  claude: ClaudeStatus | null;
  onClose: () => void;
  onCreate: (input: { name: string; role: string; prompt: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0 && !saving && !generating;
  const canGenerate =
    !generating && !saving && name.trim().length > 0 && prompt.trim().length > 0 && !!claude?.path;

  async function generate() {
    if (!canGenerate || !claude?.path) return;
    setError(null);
    setGenerating(true);
    try {
      const meta = role.trim() ? `Its role: "${role.trim()}".` : "";
      const enhancePrompt = [
        "You are helping a user write a clean system prompt for a specialist AI agent in their workspace.",
        "",
        `Agent name: "${name.trim()}".`,
        meta,
        "",
        "Their rough draft (notes, may be incomplete):",
        "---",
        prompt.trim(),
        "---",
        "",
        "Rewrite the draft as a polished system prompt that:",
        "- Opens with one sentence stating who the agent is and its purpose.",
        "- Lists its core responsibilities (3-6 bullet points).",
        "- Notes its tone, what it should do, and what it should avoid.",
        "- Stays focused and under ~250 words.",
        "- Uses plain language, no marketing speak.",
        "",
        "Reply with ONLY the rewritten system prompt — no preamble, no markdown headers, no \"Here's your prompt:\" wrapper. Just the prompt text itself."
      ]
        .filter(Boolean)
        .join("\n");

      const res = await invoke<{ response: string }>("run_task", {
        prompt: enhancePrompt,
        claudePath: claude.path,
        model: "haiku"
      });
      const text = (res?.response || "").trim();
      if (text) {
        setPrompt(text);
      } else {
        setError("Claude returned an empty response. Try editing the draft and generating again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), role: role.trim(), prompt: prompt.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="agents-drawer-overlay" onClick={onClose}>
      <aside className="agents-drawer agents-create-modal" onClick={(e) => e.stopPropagation()}>
        <header className="agents-drawer-head">
          <div>
            <p className="agents-drawer-eyebrow">New custom agent</p>
            <h2>Add to your team</h2>
            <p className="agents-drawer-role">Wires to the CEO; spawned automatically when CEO routes a task to it.</p>
          </div>
          <button type="button" className="agents-drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <form className="agents-drawer-body" onSubmit={submit}>
          <div className="agents-drawer-field">
            <div className="agents-drawer-field-head">
              <span className="agents-drawer-field-label">Name</span>
            </div>
            <input
              className="agents-create-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Legal"
              autoFocus
              spellCheck={false}
              maxLength={60}
            />
          </div>

          <div className="agents-drawer-field">
            <div className="agents-drawer-field-head">
              <span className="agents-drawer-field-label">Role</span>
              <span className="agents-create-optional">optional</span>
            </div>
            <input
              className="agents-create-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Contracts, compliance, and policy"
              spellCheck={false}
              maxLength={120}
            />
          </div>

          <div className="agents-drawer-field">
            <div className="agents-drawer-field-head">
              <span className="agents-drawer-field-label">System prompt</span>
            </div>
            <textarea
              className="agents-drawer-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              spellCheck={false}
              rows={14}
              placeholder="You are a Legal specialist. Review contracts, flag risks, suggest edits…"
            />
            <p className="agents-drawer-hint">
              This is the system prompt Claude receives when the CEO routes a task to this agent.
            </p>
          </div>

          {error && <div className="agents-create-error">{error}</div>}

          <footer className="agents-drawer-foot agents-create-foot">
            <button
              type="button"
              className="button button-ghost compact agents-generate-button"
              onClick={generate}
              disabled={!canGenerate}
              title={
                !claude?.path
                  ? "Claude CLI not configured — set it up in Settings"
                  : !name.trim() || !prompt.trim()
                  ? "Add a name and a rough draft prompt first"
                  : "Rewrite the draft with Claude"
              }
            >
              {generating ? <Loader2 size={13} className="spin" /> : <Wand size={13} />}
              {generating ? "Generating…" : "Generate with Claude"}
            </button>
            <div className="agents-create-foot-right">
              <button
                type="button"
                className="button button-ghost compact"
                onClick={onClose}
                disabled={saving || generating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary compact"
                disabled={!canSubmit}
              >
                {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                Create agent
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { apiAuthFetch } from '../lib/apiBase';
import { Plus, Calendar, MessageSquare, Cpu, Link2, AlertTriangle, FileText, Wrench, ClipboardList } from 'lucide-react';
import type { WorkspaceEntry } from '../types';

const COLUMNS = [
    { id: 'assigned', title: 'ASSIGNED', dot: 'bg-blue-400' },
    { id: 'active', title: 'IN PROGRESS', dot: 'bg-emerald-500' },
    { id: 'review', title: 'ATTENTION', dot: 'bg-amber-500' },
    { id: 'done', title: 'DONE', dot: 'bg-green-500' }
];

export function TasksScreen({ plans = [] }: { plans?: WorkspaceEntry[] }) {
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState('');
    const [detailsTask, setDetailsTask] = useState<any>(null);
    const [detailsActionLoading, setDetailsActionLoading] = useState(false);
    const [detailsActionError, setDetailsActionError] = useState('');
    const [detailsActionNote, setDetailsActionNote] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [newPriority, setNewPriority] = useState(3);
    const [selectedPlanPath, setSelectedPlanPath] = useState('');
    const [assignee, setAssignee] = useState('Main');

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(() => {
            fetchTasks();
            apiAuthFetch('/api/heartbeat', { method: 'POST' }).catch(() => { /* ignore */ });
        }, 5_000);
        return () => clearInterval(interval);
    }, []);


    const fetchTasks = async () => {
        try {
            const response = await apiAuthFetch(`/api/tasks?includeNarrative=false&includeLog=false&limit=800&t=${Date.now()}`);
            if (response.ok) {
                const data = await response.json();
                setTasks(data.jobs || []);
            }
        } catch (error) {
            console.error('Failed to fetch tasks:', error);
        } finally {
            setLoading(false);
        }
    };

    const getTaskStatus = (task: any) => {
        return task?.metadata?.status || task?.status || '';
    };

    const formatStatusLabel = (status: string) => {
        const normalized = String(status || '').replace(/_/g, ' ').trim();
        return normalized ? normalized.replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Unknown';
    };

    const getStatusTone = (status: string) => {
        switch (status) {
        case 'completed':
            return 'bg-emerald-50 text-emerald-700 border-emerald-100';
        case 'in_progress':
        case 'picked_up':
            return 'bg-blue-50 text-blue-700 border-blue-100';
        case 'assigned':
            return 'bg-sky-50 text-sky-700 border-sky-100';
        case 'awaiting_connection':
        case 'awaiting_approval':
        case 'blocked':
        case 'failed':
            return 'bg-amber-50 text-amber-700 border-amber-100';
        case 'triage':
            return 'bg-slate-100 text-slate-700 border-slate-200';
        default:
            return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    };

    const summarizeTaskNote = (task: any) => {
        return task?.metadata?.lastDecision?.reason
            || task?.metadata?.lastRun?.summary
            || task?.metadata?.manager?.reason
            || task?.metadata?.message
            || 'No notes yet.';
    };

    const formatDetailTimestamp = (value: any) => {
        if (!value) return '—';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime())
            ? String(value)
            : parsed.toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
    };

    const buildTaskComments = (task: any) => {
        const narrative = Array.isArray(task?.metadata?.narrative) ? task.metadata.narrative : [];
        return narrative
            .filter((entry: any) => entry && typeof entry === 'object' && String(entry.text || '').trim())
            .map((entry: any, index: number) => ({
                id: `${entry.agentId || 'agent'}-${entry.ts || index}-${index}`,
                agentId: entry.agentId || 'system',
                text: String(entry.text || '').trim(),
                ts: entry.ts || null,
                role: entry.role || 'assistant',
                kind: entry.role === 'agent_message'
                    ? 'coordination'
                    : entry.agentId === (task?.metadata?.managerAgentId || 'main')
                        ? 'manager'
                        : 'worker'
            }));
    };

    const extractEvidenceUrls = (task: any) => {
        const evidence = Array.isArray(task?.metadata?.lastRun?.evidence) ? task.metadata.lastRun.evidence : [];
        return evidence
            .flatMap((entry: any) => String(entry || '').match(/https?:\/\/[^\s)"'`]+/g) || [])
            .filter(Boolean);
    };

    const renderCommentTone = (comment: any) => {
        if (comment.kind === 'coordination') {
            return {
                wrapper: 'border-amber-100 bg-amber-50/70',
                badge: 'bg-amber-100 text-amber-700',
                icon: 'text-amber-600'
            };
        }
        if (comment.kind === 'manager') {
            return {
                wrapper: 'border-blue-100 bg-blue-50/70',
                badge: 'bg-blue-100 text-blue-700',
                icon: 'text-blue-600'
            };
        }
        return {
            wrapper: 'border-slate-200 bg-white',
            badge: 'bg-slate-100 text-slate-700',
            icon: 'text-slate-600'
        };
    };

    const getColumnTasks = (columnId: string) => {
        const known = new Set(['completed', 'failed', 'review', 'picked_up', 'assigned', 'run_requested', 'scheduled', 'disabled', 'triage', 'in_progress', 'awaiting_connection', 'awaiting_approval', 'blocked']);
        
        const filteredTasks = tasks.filter(t => {
            const name = String(t.name || '').toUpperCase();
            return !name.startsWith('BROADCAST:') && !name.startsWith('CHAT:');
        });
        
        const byStatus = (status: string) => filteredTasks.filter(t => getTaskStatus(t) === status);

        if (columnId === 'done') return byStatus('completed');
        if (columnId === 'review') return byStatus('blocked').concat(byStatus('awaiting_connection')).concat(byStatus('awaiting_approval')).concat(byStatus('failed')).concat(byStatus('review'));
        if (columnId === 'active') return byStatus('in_progress').concat(byStatus('picked_up'));
        if (columnId === 'assigned') return byStatus('assigned').concat(byStatus('run_requested')).concat(byStatus('scheduled'));
        if (columnId === 'inbox') {
            return filteredTasks.filter((t) => {
                const s = String(getTaskStatus(t) || '').trim();
                if (!s || s === 'triage') return true;
                if (s === 'disabled') return true;
                return !known.has(s);
            });
        }
        return [];
    };

    const handleCreateTask = async () => {
        const message = String(newMessage || '').trim();
        if (!message) return;
        const priority = Math.max(1, Math.min(5, Number(newPriority) || 3));
        setSaving(true);
        try {
            await apiAuthFetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    priority,
                    source: 'kanban',
                    planPath: selectedPlanPath || undefined,
                    assignee: assignee.trim() || 'Main',
                    name: `Task: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`
                })
            });
            setCreateOpen(false);
            setNewMessage('');
            setNewPriority(3);
            setSelectedPlanPath('');
            setAssignee('Main');
            fetchTasks();
        } catch (error) {
            console.error('Failed to create task:', error);
        } finally {
            setSaving(false);
        }
    };

    const openDetails = async (task: any) => {
        if (!task?.id) return;
        setDetailsOpen(true);
        setDetailsLoading(true);
        setDetailsError('');
        setDetailsActionError('');
        setDetailsActionNote('');
        setDetailsTask(null);
        try {
            const res = await apiAuthFetch(`/api/tasks?ids=${encodeURIComponent(String(task.id))}&includeNarrative=true&includeLog=true&limit=1&t=${Date.now()}`);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Failed to load details: ${res.status} ${text}`);
            }
            const data = await res.json();
            const full = Array.isArray(data?.jobs) ? data.jobs[0] : null;
            setDetailsTask(full || task);
        } catch (err: any) {
            setDetailsError(err?.message || 'Failed to load details');
            setDetailsTask(task);
        } finally {
            setDetailsLoading(false);
        }
    };

    const closeDetails = () => {
        setDetailsOpen(false);
        setDetailsError('');
        setDetailsLoading(false);
        setDetailsActionLoading(false);
        setDetailsActionError('');
        setDetailsActionNote('');
        setDetailsTask(null);
    };

    const handleTaskAction = async (action: string) => {
        if (!detailsTask?.id) return;
        setDetailsActionLoading(true);
        setDetailsActionError('');
        try {
            const response = await apiAuthFetch(`/api/tasks/${encodeURIComponent(String(detailsTask.id))}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    note: String(detailsActionNote || '').trim()
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.error || `Task action failed: ${response.status}`);
            }
            setDetailsActionNote('');
            await fetchTasks();
            await openDetails(detailsTask);
        } catch (error: any) {
            setDetailsActionError(error?.message || 'Task action failed');
        } finally {
            setDetailsActionLoading(false);
        }
    };

    const actionableStatus = detailsTask ? getTaskStatus(detailsTask) : '';
    const currentOperatorGuidance = String(detailsTask?.metadata?.operatorGuidance || '').trim();
    const actionInputLabel = actionableStatus === 'awaiting_approval'
        ? 'Approval context'
        : actionableStatus === 'awaiting_connection'
            ? 'Resolution input'
            : actionableStatus === 'blocked'
                ? 'Resolution input'
                : actionableStatus === 'failed'
                    ? 'Retry guidance'
                    : 'Operator note';
    const actionInputPlaceholder = actionableStatus === 'awaiting_approval'
        ? 'Optional context for the approving agent. Example: Approved after reviewing the draft.'
        : actionableStatus === 'awaiting_connection'
            ? 'Optional update for the next run. Example: Gmail is connected now. Retry with the same recipient.'
            : actionableStatus === 'blocked'
                ? 'Describe what changed so the task can move again. Example: Use agent-2 instead. Slack is no longer required.'
                : actionableStatus === 'failed'
                    ? 'Optional guidance for the retry. Example: Use the CSV attached in Notion and skip email.'
                    : 'Optional note for the task log.';
    const retryActionLabel = actionableStatus === 'blocked'
        ? 'Resolve And Retry'
        : actionableStatus === 'awaiting_connection'
            ? 'Retry After Connect'
            : actionableStatus === 'failed'
                ? 'Retry With Guidance'
                : 'Retry Task';
    const blockedRetryNeedsInput = actionableStatus === 'blocked' && !String(detailsActionNote || '').trim();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <section className="tasks-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}>
            <div className="tasks-hero" style={{ padding: '24px 20px', background: 'transparent', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div className="tasks-hero-text">
                    <p className="layer-badge" style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="layer-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--ink)' }} />
                        Layer · Tasks
                    </p>
                    <h1 style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: 'var(--ink)' }}>Task <em>Kanban</em></h1>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setCreateOpen(true)}
                        disabled={saving}
                        className="button button-primary compact"
                    >
                        <Plus size={14} />
                        {saving ? 'Deploying…' : 'New Mission'}
                    </button>
                </div>
            </div>

            {createOpen && (
                <div className="detail-modal-overlay" onClick={() => !saving && setCreateOpen(false)}>
                    <div className="detail-modal-card" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
                        <header className="detail-modal-head">
                            <div className="detail-modal-head-left">
                                <span className="detail-modal-icon"><Plus size={15} /></span>
                                <div>
                                    <p className="detail-modal-eyebrow">Create Task</p>
                                    <h2>New Mission</h2>
                                </div>
                            </div>
                            <button className="detail-modal-close" onClick={() => setCreateOpen(false)}><X size={16} /></button>
                        </header>
                        
                        <div className="detail-modal-body" style={{ padding: '24px' }}>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>Select Plan</label>
                                <select
                                    value={selectedPlanPath}
                                    onChange={(e) => setSelectedPlanPath(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
                                    disabled={saving}
                                >
                                    <option value="">No Plan (General Task)</option>
                                    {plans.map(plan => (
                                        <option key={plan.path} value={plan.path}>{plan.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>Assignee</label>
                                <input
                                    type="text"
                                    value={assignee}
                                    onChange={(e) => setAssignee(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
                                    placeholder="e.g. Main, Manager, fury…"
                                    disabled={saving}
                                />
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>Task Instructions</label>
                                <textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    style={{ width: '100%', height: '120px', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', background: 'var(--surface)', color: 'var(--ink)', resize: 'none', outline: 'none' }}
                                    placeholder="Describe the task…"
                                    disabled={saving}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>Priority</label>
                                <select
                                    value={newPriority}
                                    onChange={(e) => setNewPriority(Number(e.target.value) || 3)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
                                    disabled={saving}
                                >
                                    <option value={5}>5 (highest)</option>
                                    <option value={4}>4</option>
                                    <option value={3}>3 (normal)</option>
                                    <option value={2}>2</option>
                                    <option value={1}>1 (lowest)</option>
                                </select>
                            </div>
                        </div>

                        <footer className="detail-modal-footer">
                            <button className="button button-ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</button>
                            <button className="button button-primary" onClick={handleCreateTask} disabled={saving || !newMessage.trim()}>
                                {saving ? 'Creating…' : 'Create Task'}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            <div className="kanban-scroller" style={{ flex: 1, width: '100%', overflowX: 'auto', overflowY: 'hidden', padding: '0 20px 20px', background: 'transparent', minWidth: 0 }}>
                <div className="kanban-container" style={{ display: 'flex', gap: '16px', height: '100%', width: '100%' }}>
                    {COLUMNS.map(column => {
                        const columnTasks = getColumnTasks(column.id);

                        return (
                            <div key={column.id} className="kanban-column" style={{ flex: '1 1 0', minWidth: '280px', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-soft)', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                <div className="column-header" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div className={`column-dot ${column.dot}`} style={{ width: '8px', height: '8px', borderRadius: '50%' }} />
                                        <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.05em', margin: 0 }}>{column.title}</h3>
                                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-500)', background: 'var(--surface-soft)', padding: '2px 6px', borderRadius: '10px' }}>{columnTasks.length}</span>
                                    </div>
                                </div>

                                <div className="column-body" style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {columnTasks.map(task => (
                                        <div
                                            key={task.id}
                                            onClick={() => openDetails(task)}
                                            className="kanban-card"
                                            style={{ background: 'var(--surface)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}
                                        >
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: task.agentId?.toLowerCase().includes('fury') ? '#fca5a5' : '#93c5fd' }} />
                                            
                                            <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4 }}>{task.name}</h4>
                                            <p style={{ margin: '0 0 16px', fontSize: '11px', color: 'var(--gray-500)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{summarizeTaskNote(task)}</p>

                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <div style={{ width: '18px', height: '18px', borderRadius: '4px', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: 'var(--ink)' }}>{(task.agentId || 'J').charAt(0).toUpperCase()}</div>
                                                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--ink)' }}>{task.metadata?.assignedAgentId || task.agentId || 'Manager'}</span>
                                                </div>
                                                <span style={{ fontSize: '9px', color: 'var(--gray-500)' }}>{task.metadata?.createdAt ? new Date(task.metadata.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}</span>
                                            </div>

                                            <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                <span className={`status-badge ${getTaskStatus(task)}`} style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', background: 'var(--surface-soft)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                                                    {formatStatusLabel(getTaskStatus(task))}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {detailsOpen && (
                <div className="detail-modal-overlay" onClick={() => !detailsLoading && closeDetails()}>
                    <div className="detail-modal-card detail-modal-large" onClick={(e) => e.stopPropagation()}>
                        <header className="detail-modal-head">
                            <div className="detail-modal-head-left">
                                <span className="detail-modal-icon"><FileText size={15} /></span>
                                <div>
                                    <p className="detail-modal-eyebrow">Task Details</p>
                                    <h2>{detailsTask?.name || 'Loading mission…'}</h2>
                                </div>
                            </div>
                            <button className="detail-modal-close" onClick={closeDetails}><X size={16} /></button>
                        </header>

                        <div className="detail-modal-body" style={{ padding: '24px' }}>
                            {detailsLoading ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#91847d', fontSize: '14px' }}>
                                    <Loader2 size={16} className="spin" />
                                    Fetching full task logs…
                                </div>
                            ) : detailsError ? (
                                <div style={{ color: '#dc2626', background: '#fee2e2', padding: '12px', borderRadius: '8px', fontSize: '14px' }}>{detailsError}</div>
                            ) : detailsTask && (
                                <div className="task-details-grid" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    <div className="task-request-section" style={{ background: '#fcfcfb', padding: '20px', borderRadius: '12px', border: '1px solid #e5e5e0' }}>
                                        <h3 style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#91847d', margin: '0 0 12px' }}>Request</h3>
                                        <p style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: '#2a2826', lineHeight: 1.5 }}>{detailsTask?.payload?.message || detailsTask?.metadata?.message || '—'}</p>
                                    </div>

                                    <div className="task-meta-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                                        <div className="meta-box" style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e5e5e0' }}>
                                            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#91847d', textTransform: 'uppercase', marginBottom: '4px' }}>Status</span>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#2a2826' }}>{formatStatusLabel(getTaskStatus(detailsTask))}</span>
                                        </div>
                                        <div className="meta-box" style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e5e5e0' }}>
                                            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#91847d', textTransform: 'uppercase', marginBottom: '4px' }}>Assigned To</span>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#2a2826' }}>{detailsTask?.metadata?.assignedAgentId || detailsTask.agentId || '—'}</span>
                                        </div>
                                        <div className="meta-box" style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e5e5e0' }}>
                                            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#91847d', textTransform: 'uppercase', marginBottom: '4px' }}>Priority</span>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#2a2826' }}>P{detailsTask?.metadata?.priority || 3}</span>
                                        </div>
                                        <div className="meta-box" style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e5e5e0' }}>
                                            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#91847d', textTransform: 'uppercase', marginBottom: '4px' }}>Last Updated</span>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#2a2826' }}>{formatDetailTimestamp(detailsTask?.metadata?.updatedAt || detailsTask?.updatedAt)}</span>
                                        </div>
                                    </div>

                                    {/* Action section for blocked tasks */}
                                    {['awaiting_approval', 'awaiting_connection', 'blocked', 'failed'].includes(getTaskStatus(detailsTask)) && (
                                        <div className="task-action-box" style={{ background: '#fff9f0', padding: '20px', borderRadius: '12px', border: '1px solid #ffedd5' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                                <AlertTriangle size={16} className="text-amber-600" />
                                                <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#9a3412', margin: 0 }}>Action Required</h3>
                                            </div>
                                            <p style={{ fontSize: '13px', color: '#9a3412', margin: '0 0 16px', lineHeight: 1.5 }}>
                                                {getTaskStatus(detailsTask) === 'awaiting_approval' && 'This task requires your approval before the agent can proceed.'}
                                                {getTaskStatus(detailsTask) === 'awaiting_connection' && 'A required connector is not connected. Retry after connecting it.'}
                                                {getTaskStatus(detailsTask) === 'blocked' && 'The agent encountered a blocker. Provide resolution guidance.'}
                                                {getTaskStatus(detailsTask) === 'failed' && 'The last run failed. Provide retry guidance.'}
                                            </p>
                                            
                                            <textarea
                                                value={detailsActionNote}
                                                onChange={(e) => setDetailsActionNote(e.target.value)}
                                                placeholder={actionInputPlaceholder}
                                                style={{ width: '100%', height: '80px', padding: '10px', borderRadius: '8px', border: '1px solid #ffedd5', fontSize: '13px', background: '#fff', outline: 'none', marginBottom: '12px' }}
                                            />

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {getTaskStatus(detailsTask) === 'awaiting_approval' ? (
                                                    <>
                                                        <button onClick={() => handleTaskAction('approve')} disabled={detailsActionLoading} className="button button-primary compact" style={{ background: '#10b981', borderColor: '#10b981' }}>Approve</button>
                                                        <button onClick={() => handleTaskAction('reject')} disabled={detailsActionLoading} className="button button-ghost compact">Reject</button>
                                                    </>
                                                ) : (
                                                    <button onClick={() => handleTaskAction('retry')} disabled={detailsActionLoading || blockedRetryNeedsInput} className="button button-primary compact">{retryActionLabel}</button>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Timeline / Narrative */}
                                    <div className="task-timeline">
                                        <h3 style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#91847d', margin: '0 0 16px' }}>Agent Narrative</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {buildTaskComments(detailsTask).length > 0 ? buildTaskComments(detailsTask).map((comment: any) => (
                                                <div key={comment.id} style={{ background: comment.kind === 'manager' ? '#eff6ff' : '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e5e5e0' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#e5e5e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>{comment.agentId.charAt(0).toUpperCase()}</div>
                                                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#2a2826' }}>{comment.agentId}</span>
                                                            <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', background: comment.kind === 'manager' ? '#dbeafe' : '#f4f4f0', color: comment.kind === 'manager' ? '#1e40af' : '#91847d', padding: '2px 6px', borderRadius: '4px' }}>{comment.kind}</span>
                                                        </div>
                                                        <span style={{ fontSize: '10px', color: '#91847d' }}>{formatDetailTimestamp(comment.ts)}</span>
                                                    </div>
                                                    <p style={{ margin: 0, fontSize: '13px', color: '#2a2826', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{comment.text}</p>
                                                </div>
                                            )) : (
                                                <div style={{ padding: '32px', textAlign: 'center', color: '#91847d', border: '2px dashed #e5e5e0', borderRadius: '12px' }}>
                                                    <MessageSquare size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                                                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>No narrative logs yet.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <footer className="detail-modal-footer">
                            <button className="button button-ghost" onClick={closeDetails}>Close</button>
                        </footer>
                    </div>
                </div>
            )}

            <style>{`
                .kanban-scroller::-webkit-scrollbar { height: 8px; }
                .kanban-scroller::-webkit-scrollbar-track { background: transparent; }
                .kanban-scroller::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
                .kanban-scroller::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
                
                .kanban-column::-webkit-scrollbar { width: 4px; }
                .kanban-column::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.05); border-radius: 10px; }
                .column-body::-webkit-scrollbar { width: 4px; }
                .column-body::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.05); border-radius: 10px; }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .detail-modal-large { width: 90%; max-width: 900px; height: 90vh; display: flex; flexDirection: column; }
                .detail-modal-body { flex: 1; overflowY: auto; }
            `}</style>
        </section>
    );
}

function Loader2({ size, className }: { size: number, className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}

function X({ size }: { size: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}

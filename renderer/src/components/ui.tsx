import React from "react";
import { CheckCircle2, ChevronRight, Minus, Square, X } from "lucide-react";

export function WindowControls() {
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    window.aios?.window?.onMaximizedChanged?.((m: boolean) => setMaximized(m));
  }, []);

  const handleMinimize = () => window.aios?.window?.minimize?.();
  const handleMaximize = () => window.aios?.window?.maximize?.();
  const handleClose = () => window.aios?.window?.close?.();

  return (
    <div className="window-controls">
      <button className="window-btn" onClick={handleClose} aria-label="Close window" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4.5" fill="#ff5f57" stroke="#e0443e" strokeWidth="0.5"/>
        </svg>
      </button>
      <button className="window-btn" onClick={handleMinimize} aria-label="Minimize window" title="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4.5" fill="#febc2e" stroke="#e0a500" strokeWidth="0.5"/>
        </svg>
      </button>
      <button className="window-btn" onClick={handleMaximize} aria-label="Maximize window" title={maximized ? "Restore" : "Maximize"}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4.5" fill="#28c840" stroke="#1aab29" strokeWidth="0.5"/>
        </svg>
      </button>
    </div>
  );
}

export function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function StatusBadge({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: "success" | "warning" | "danger" | "neutral" | "info";
}) {
  return (
    <span className={`status-badge ${tone}`}>
      <i />
      {label}
    </span>
  );
}

export function Surface({
  className = "",
  children,
  glass = false
}: {
  className?: string;
  children: React.ReactNode;
  glass?: boolean;
}) {
  return <section className={`${glass ? "glass-surface" : "surface"} ${className}`.trim()}>{children}</section>;
}

export function PanelHeader({
  eyebrow,
  title,
  detail,
  action
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        {eyebrow ? <p className="section-label">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {detail ? <p className="panel-detail">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "neutral";
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function FileRow({
  title,
  subtitle,
  body,
  active = false,
  onClick,
  action
}: {
  title: string;
  subtitle?: string;
  body?: string;
  active?: boolean;
  onClick?: () => void;
  action?: React.ReactNode;
}) {
  const content = (
    <>
      <div className="file-row-copy">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
        {body ? <p>{body}</p> : null}
      </div>
      {action ?? (onClick ? <ChevronRight /> : null)}
    </>
  );

  if (!onClick) {
    return <div className={`file-row ${active ? "active" : ""}`}>{content}</div>;
  }

  return (
    <button className={`file-row ${active ? "active" : ""}`} onClick={onClick}>
      {content}
    </button>
  );
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span className="toast-icon">
            <CheckCircle2 size={16} />
          </span>
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => toast.onDismiss?.()}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  onDismiss?: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false
}: {
  open: boolean;
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        <p>{message}</p>
        <div className="confirm-modal-actions">
          <button className="button button-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            className={`button ${danger ? "button-danger" : "button-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

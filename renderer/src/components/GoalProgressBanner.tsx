import React from "react";
import { Target, X, RotateCw } from "lucide-react";
import type { ActiveGoal } from "../types";

interface GoalProgressBannerProps {
  goal: ActiveGoal | null | undefined;
  onAbort: () => void;
  onResume?: () => void;
  onDismiss: () => void;
}

export function GoalProgressBanner({ goal, onAbort, onResume, onDismiss }: GoalProgressBannerProps) {
  if (!goal) return null;
  const status = goal.status;
  const tokens = formatTokens(goal.tokensSpent);
  const cost = goal.costUsd ? `~$${goal.costUsd.toFixed(2)}` : null;
  const turnsLabel = `${goal.turn} / ${goal.maxTurns} turns`;

  return (
    <div className={`aios-goal-banner status-${status}`} data-testid="goal-banner">
      <div className="aios-goal-banner-icon">
        {status === "active" ? (
          <span className="aios-goal-pulse" aria-hidden="true" />
        ) : (
          <Target size={14} />
        )}
      </div>
      <div className="aios-goal-banner-body">
        <div className="aios-goal-banner-line1">
          <span className="aios-goal-banner-eyebrow">{statusLabel(status)}</span>
          <span className="aios-goal-banner-condition" title={goal.condition}>
            {goal.condition}
          </span>
        </div>
        <div className="aios-goal-banner-line2">
          <span>{turnsLabel}</span>
          <span>·</span>
          <span>{tokens} tokens</span>
          {cost ? (
            <>
              <span>·</span>
              <span>{cost}</span>
            </>
          ) : null}
          {goal.lastReason ? (
            <>
              <span>·</span>
              <span className="aios-goal-banner-reason" title={goal.lastReason}>
                {goal.lastReason}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="aios-goal-banner-actions">
        {status === "active" ? (
          <button
            type="button"
            className="aios-goal-banner-button"
            onClick={onAbort}
            title="Stop the goal"
          >
            Stop
          </button>
        ) : (status === "aborted" || status === "exhausted") && onResume ? (
          <button
            type="button"
            className="aios-goal-banner-button primary"
            onClick={onResume}
            title="Resume the goal from where it left off"
          >
            <RotateCw size={12} />
            <span>Resume</span>
          </button>
        ) : null}
        <button
          type="button"
          className="aios-goal-banner-close"
          onClick={onDismiss}
          title="Dismiss banner"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function statusLabel(status: ActiveGoal["status"]): string {
  switch (status) {
    case "active":
      return "Goal active";
    case "met":
      return "Goal met";
    case "aborted":
      return "Goal stopped";
    case "exhausted":
      return "Goal exhausted";
    default:
      return "Goal";
  }
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

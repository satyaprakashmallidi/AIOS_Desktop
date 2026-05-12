export type Screen = "command" | "context" | "imports" | "outputs" | "plans" | "tasks" | "agents" | "auto-tasks" | "modules" | "briefs" | "connectors" | "history" | "settings" | "onboarding";

export interface OnboardingState {
  currentStep: number;
  answers: Record<string, string>;
  completedAt: string | null;
}

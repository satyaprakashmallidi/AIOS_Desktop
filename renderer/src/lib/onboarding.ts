export interface OnboardingQuestion {
  id: string;
  layer: string;
  question: string;
}

export const onboardingQuestions: OnboardingQuestion[] = [
  { id: "role", layer: "Identity", question: "What do you do, who do you work with, and how should AIOS understand your role?" },
  { id: "six_month_goal", layer: "Identity", question: "What would make the next 6 months meaningfully better for you?" },
  { id: "offer", layer: "Business Model", question: "What does your business sell, who is it for, and why do they choose you?" },
  { id: "revenue_model", layer: "Business Model", question: "How do customers find you, pay you, and what tools run the business today?" },
  { id: "north_star_metric", layer: "Priorities", question: "What goal or metric matters most over the next 90 days?" },
  { id: "hidden_blocker", layer: "Priorities", question: "What blocker, decision, or risk is most likely to slow you down?" },
  { id: "payments", layer: "Data", question: "Where does important business data live today: payments, CRM, meetings, chat, content, docs?" },
  { id: "extra_context", layer: "Data", question: "What else should AIOS remember before the first real session?" }
];

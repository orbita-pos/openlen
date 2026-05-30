// Quick-prompt presets — shared by the homepage hero input and the /new
// AI brief panel so the two stay in sync. Each chip shows `label`; clicking
// fills the composer with the detailed `prompt`.

export interface QuickPrompt {
  label: string;
  prompt: string;
}

export const QUICK_PROMPTS: QuickPrompt[] = [
  {
    label: "SaaS launch",
    prompt:
      "Landing page for FlowDeck, a Kanban tool for designers that uses AI to prioritize tasks. Features: AI prioritization, real-time sync, Slack integration. Pricing tiers: Free, Pro $29/mo, Team $99/mo.",
  },
  {
    label: "Portfolio",
    prompt:
      "Personal portfolio for a freelance UI/UX designer based in Mexico City named Sofia. She specializes in fintech and SaaS. Wants to showcase 6 projects and have a contact section.",
  },
  {
    label: "Coffee subscription",
    prompt:
      "Landing page for 'Volcánica', a single-origin coffee subscription from Mexican volcanoes. Hero: bag of coffee on volcanic stone. Subscription tiers: $19 monthly, $49 quarterly. Mission: support Mexican farmers.",
  },
  {
    label: "Event",
    prompt:
      "Landing page for 'Solo Founder Summit 2026', a 1-day virtual conference for indie hackers. October 15. Speakers: Pieter Levels, Justin Welsh, Marc Lou. Tickets $99 early bird.",
  },
];

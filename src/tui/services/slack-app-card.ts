/**
 * The "Take PostHog to Slack" card the Connect Slack screen shows, after a
 * program's run and in `wizard slack`. Every string is presentation copy shown
 * to the user, never sent to the agent. Connecting Slack is a manual OAuth
 * step in the PostHog app, so the card links out to `setupUrl`.
 */
export interface SlackAppCard {
  headline: string;
  /** One-line hook covering both analysis and shipping. */
  pitch: string;
  /** posthog.com/slack — "learn more". */
  learnMoreUrl: string;
  /** integrations/slack — where the user connects Slack. */
  setupUrl: string;
  /** The Slack agent's two capabilities (code/PR + data) — fixed, not role-tailored. */
  capabilities: string[];
}

const SLACK_APP: SlackAppCard = {
  learnMoreUrl: 'https://posthog.com/slack',
  setupUrl: 'https://app.posthog.com/integrations/slack',
  headline: '@PostHog in Slack',
  pitch:
    'Ask about your product data, debug issues, and generate PRs without leaving the thread.',
  capabilities: [
    'Tag @PostHog with a bug, edit, or a feature idea. It will spin up a sandboxed environment, plan, edit files, run tests, and open a draft PR.',
    "Tag @PostHog with any data question. It's the same SQL-writing, statistically-minded assistant as PostHog AI, but it responds where you send work memes.",
  ],
};

/**
 * Resolve the "Take PostHog to Slack" card. Role-independent — the Slack
 * agent's two capabilities (code/PR + data) describe the product itself,
 * not role-specific examples.
 */
export function getSlackAppCard(): SlackAppCard {
  return { ...SLACK_APP, capabilities: [...SLACK_APP.capabilities] };
}

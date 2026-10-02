import { SLACK_APP } from '@tui/tools/mcp/services/mcp-role-prompts';

/**
 * The "Take PostHog to Slack" card surfaced at the end of the MCP flow
 * (Goodbye phase + dedicated Connect-Slack step). `useCases` is resolved
 * per role; the rest is static. Every string here is presentation copy
 * shown to the user — none of it is sent to the agent, so the picker's
 * read/persistence prompt-scope rule does not apply.
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

/**
 * Resolve the "Take PostHog to Slack" card. Role-independent — the Slack
 * agent's two capabilities (code/PR + data) describe the product itself,
 * not role-specific examples.
 */
export function getSlackAppCard(): SlackAppCard {
  return {
    headline: SLACK_APP.headline,
    pitch: SLACK_APP.pitch,
    learnMoreUrl: SLACK_APP.learnMoreUrl,
    setupUrl: SLACK_APP.setupUrl,
    capabilities: SLACK_APP.capabilities,
  };
}

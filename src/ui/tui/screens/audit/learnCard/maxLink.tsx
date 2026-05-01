import { Text } from 'ink';

/**
 * Build a deep-link that opens PostHog Max in the cloud app with the given
 * prompt pre-filled in the side panel.
 *
 * Format: `https://app.posthog.com/#panel=max:!"<encoded prompt>"`
 *   - `max:` selects the Max panel
 *   - `!"…"` is the panel-shortcut Max uses for "open with this question"
 */
export const buildMaxUrl = (prompt: string): string =>
  `https://app.posthog.com/#panel=max:!%22${encodeURIComponent(prompt)}%22`;

/**
 * Visual affordance — cyan underlined "Open in PostHog AI ↗" — that marks a
 * slide as having a Max deep-link. The link itself rides on the slide's
 * `link` property and is opened by the `O` key handler in `AuditLearnCard`.
 */
export const OpenInMaxLink = () => (
  <Text color="cyan" bold underline>
    Open in PostHog AI ↗
  </Text>
);

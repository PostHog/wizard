import { Text } from 'ink';

/**
 * Build a deep-link that opens PostHog Max in the cloud app with the given
 * prompt pre-filled in the side panel.
 *
 * Format: `https://app.posthog.com/#panel=max:!"<encoded prompt>"`
 *   - `max:` selects the Max panel
 *   - `!"…"` is the panel-shortcut Max uses for "open with this question"
 *
 * The slide's `link` property carries this URL; the `O` key handler in
 * `AuditLearnCard` opens it in the user's default browser. (Ink renders
 * OSC 8 hyperlinks unreliably across line wraps via wrap-ansi, so links
 * are surfaced via keypress rather than inline-clickable text.)
 */
export const buildMaxUrl = (prompt: string): string =>
  `https://app.posthog.com/#panel=max:!%22${encodeURIComponent(prompt)}%22`;

/**
 * Cyan "Try it [↗ press O]" affordance for slides with a Max prompt.
 * Plain (no underline) — underline would suggest hover/click in some
 * terminals, which doesn't apply here since the link opens via keypress.
 */
export const TryItLabel = () => (
  <Text color="cyan" bold>
    Try it [↗ press O]
  </Text>
);

/** Cyan "Learn more [↗ press O]" affordance for slides with a docs URL. */
export const LearnMoreLabel = () => (
  <Text color="cyan" bold>
    Learn more [↗ press O]
  </Text>
);

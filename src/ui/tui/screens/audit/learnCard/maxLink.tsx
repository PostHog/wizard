import { Text } from 'ink';
import type { ReactNode } from 'react';

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
 * Wraps content in an OSC 8 hyperlink so URL-aware terminals (iTerm2,
 * Ghostty, Warp, Wezterm, Apple Terminal, etc.) render the children as a
 * clickable link without showing the raw URL inline. Same affordance the
 * OAuth screen relies on for `session.loginUrl`, applied to label-style
 * links inside the learn cards.
 */
export const TerminalLink = ({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) => (
  <Text>
    {`]8;;${url}\\`}
    {children}
    {`]8;;\\`}
  </Text>
);

/**
 * Visual affordance — cyan underlined "Open in PostHog AI ↗" — that marks a
 * slide as having a Max deep-link. Clickable via OSC 8, plus the `O` key
 * fallback handled in `AuditLearnCard`.
 */
export const OpenInMaxLink = ({ url }: { url: string }) => (
  <TerminalLink url={url}>
    <Text color="cyan" bold underline>
      Open in PostHog AI ↗
    </Text>
  </TerminalLink>
);

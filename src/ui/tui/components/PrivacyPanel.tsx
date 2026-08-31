/**
 * PrivacyPanel — Shared disclosure component.
 *
 * Single source of truth for the wizard's privacy disclosure, rendered
 * identically from the intro screen (the `PRIVACY_PANEL_LABEL` menu option)
 * and as an overlay from the auth screen ([I] keystroke).
 *
 * Must fit in a default-sized macOS Terminal (~24 rows). Two condensed
 * paragraphs carry the top-level disclosure; the link footer follows.
 * Users who want the full legal text follow the Terms / Privacy URLs to
 * their browser.
 *
 * The scan paragraph is opt-in per caller. It ends by pointing at a control,
 * so it may only render on a screen that puts one below the panel — three of
 * the four callers show `Back` and nothing else, and would be promising a
 * choice that is not there.
 */

import { useEffect } from 'react';
import { Box, Text } from 'ink';
import {
  POSTHOG_ORG_AI_SETTINGS_URL,
  POSTHOG_PRIVACY_URL,
  POSTHOG_TERMS_URL,
} from '@lib/constants';
import { analytics } from '@utils/analytics';

/**
 * The panel's name everywhere it is referenced: intro menu, screen titles, and
 * the auth screen's [I] hint. One constant so the five spellings this replaced
 * cannot come back.
 */
export const PRIVACY_PANEL_LABEL = 'Privacy & data';

interface PrivacyPanelProps {
  /**
   * True only on a screen that renders the sharing choice below the panel.
   * Gates the scan paragraph, whose last sentence sends the reader to a
   * control that exists on one screen.
   */
  canOptOut?: boolean;
}

export const PrivacyPanel = ({ canOptOut = false }: PrivacyPanelProps = {}) => {
  // Rendered from the intro menu and the auth-screen [I] overlay; either way,
  // count the impression once per mount.
  useEffect(() => {
    analytics.wizardCapture('privacy panel shown');
  }, []);

  return (
    <Box flexDirection="column" width={64} flexShrink={0}>
      <Text>
        We use Anthropic and OpenAI models via the PostHog LLM gateway to read
        your source files as AI context. .env* file contents, secrets, and
        anything matched by the security scanner stay on your machine.
      </Text>

      <Box marginTop={1}>
        <Text>
          To use the wizard, AI features must be enabled in your organization's
          settings.
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>
          Terms: <Text color="cyan">{POSTHOG_TERMS_URL}</Text>
        </Text>
        <Text>
          Privacy: <Text color="cyan">{POSTHOG_PRIVACY_URL}</Text>
        </Text>
        <Text>
          AI settings: <Text color="cyan">{POSTHOG_ORG_AI_SETTINGS_URL}</Text>
        </Text>
      </Box>

      {canOptOut && (
        <Box marginTop={1}>
          <Text>
            We also read dependency files and .env variable names to discover
            tools we can connect to and integrate with. We share that list with
            PostHog to suggest features. You can opt out of sharing below.
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * PrivacyPanel — Shared disclosure component.
 *
 * Single source of truth for the wizard's privacy disclosure, rendered
 * identically from the intro screen ("Privacy & data usage" menu option)
 * and as an overlay from the auth screen ([I] keystroke).
 *
 * Must fit in a default-sized macOS Terminal (~24 rows). Two condensed
 * paragraphs carry the top-level disclosure; the link footer follows.
 * Users who want the full legal text follow the Terms / Privacy URLs to
 * their browser.
 */

import { useEffect } from 'react';
import { Box, Text } from 'ink';
import {
  POSTHOG_ORG_AI_SETTINGS_URL,
  POSTHOG_PRIVACY_URL,
  POSTHOG_TERMS_URL,
} from '@lib/constants';
import { analytics } from '@utils/analytics';

export const PrivacyPanel = () => {
  // Rendered from the intro menu and the auth-screen [I] overlay; either way,
  // count the impression once per mount.
  useEffect(() => {
    analytics.wizardCapture('privacy panel shown');
  }, []);

  return (
    <Box flexDirection="column" width={64} flexShrink={0}>
      <Text>
        We use Anthropic's Claude via the PostHog LLM gateway to read your
        source files as AI context. .env* file contents, secrets, and anything
        matched by the security scanner stay on your machine. Some flows also
        check dependency files and .env variable names to identify tools you
        already use, and share what they find with PostHog to suggest features
        and understand what our users are building.
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
    </Box>
  );
};

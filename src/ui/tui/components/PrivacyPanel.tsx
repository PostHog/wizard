/**
 * PrivacyPanel — Shared disclosure component.
 *
 * Single source of truth for the wizard's privacy disclosure, rendered
 * identically from the intro screen ("Privacy & data usage" menu option)
 * and as an overlay from the auth screen ([I] keystroke).
 *
 * Must fit in a default-sized macOS Terminal (~24 rows). One condensed
 * paragraph carries the top-level disclosure; the dynamic skill block
 * and link footer follow. Users who want the full legal text follow
 * the Terms / Privacy URLs to their browser.
 */

import { Box, Text } from 'ink';
import {
  POSTHOG_PRIVACY_URL,
  POSTHOG_TERMS_URL,
  POSTHOG_WIZARD_REPO_URL,
  WIZARD_CONTACT_EMAIL,
} from '@lib/constants';
import { useSkillEntry } from '@ui/tui/screens/SkillSourceInfo';

interface PrivacyPanelProps {
  /** Reflects session.noTelemetry — controls the telemetry status line. */
  noTelemetry: boolean;
  /** Program's skill id, for the BYOAI escape-hatch section. */
  skillId: string | null;
  /** Session's localMcp flag — picks remote vs local skill base URL. */
  localMcp: boolean;
}

export const PrivacyPanel = ({
  noTelemetry: _noTelemetry,
  skillId,
  localMcp,
}: PrivacyPanelProps) => {
  const { skillEntry, fetchFailed } = useSkillEntry(skillId, localMcp);

  return (
    <Box flexDirection="column" width={64} flexShrink={0}>
      <Text>
        We use Anthropic's Claude via the PostHog LLM gateway to read your
        source files as AI context. .env* files, secrets, and anything matched
        by the security scanner stay on your machine. The wizard is open source:{' '}
        <Text color="cyan">{POSTHOG_WIZARD_REPO_URL}</Text>.
      </Text>

      <Box marginTop={1}>
        <Text>
          We collect anonymous usage metrics (run count, errors, cost) — never
          your source code or prompts, and nothing is used for AI training. Pass{' '}
          <Text color="green">--no-telemetry</Text> to opt out.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          Prefer your own AI? Download the skill and run it in your own agent:{' '}
          <Text color="cyan">
            {skillEntry?.downloadUrl ??
              (fetchFailed ? 'unavailable' : 'Loading...')}
          </Text>
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Terms: <Text color="cyan">{POSTHOG_TERMS_URL}</Text>
        </Text>
        <Text dimColor>
          Privacy: <Text color="cyan">{POSTHOG_PRIVACY_URL}</Text>
        </Text>
        <Text dimColor>
          Contact: <Text color="cyan">{WIZARD_CONTACT_EMAIL}</Text>
        </Text>
      </Box>
    </Box>
  );
};

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
import {
  SkillSourceInfo,
  useSkillEntry,
} from '@ui/tui/screens/SkillSourceInfo';

interface PrivacyPanelProps {
  /** Reflects session.noTelemetry — controls the telemetry status line. */
  noTelemetry: boolean;
  /** Program's skill id, for the BYOAI escape-hatch section. */
  skillId: string | null;
  /** Session's localMcp flag — picks remote vs local skill base URL. */
  localMcp: boolean;
}

export const PrivacyPanel = ({
  noTelemetry,
  skillId,
  localMcp,
}: PrivacyPanelProps) => {
  const { skillEntry, fetchFailed } = useSkillEntry(skillId, localMcp);

  return (
    <Box flexDirection="column" width={64} flexShrink={0}>
      <Text>
        We use <Text bold>Anthropic Claude</Text> to read your source files as
        AI context. <Text bold>.env*</Text> files, secrets, and anything matched
        by the security scanner stay on your machine. Telemetry is{' '}
        {noTelemetry ? (
          <Text color="green">DISABLED</Text>
        ) : (
          <Text color="yellow">ENABLED</Text>
        )}{' '}
        — pass <Text color="cyan">--no-telemetry</Text>
        {noTelemetry ? '' : ' to disable'}. The wizard is open source (
        <Text color="cyan">{POSTHOG_WIZARD_REPO_URL}</Text>); prefer your own
        AI? Download the skill below and run it in your own agent.
      </Text>

      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
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

/**
 * PrivacyPanel — Shared disclosure component.
 *
 * Single source of truth for the wizard's privacy disclosure, rendered
 * identically from the intro screen ("Privacy & data usage" menu option)
 * and as an overlay from the auth screen ([I] keystroke).
 *
 * Must fit in a default-sized macOS Terminal (~24 rows) with no
 * scrolling. Compact paragraph form is preferred over multi-section
 * bullet layouts — users who want the full legal text follow the Terms
 * / Privacy links to their browser.
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
        Wizard is open source —{' '}
        <Text color="cyan">{POSTHOG_WIZARD_REPO_URL}</Text>
      </Text>

      <Box marginTop={1}>
        <Text>
          We use <Text bold>Anthropic Claude</Text> to read your source files as
          AI context. <Text bold>.env*</Text> files, secrets, and anything
          matched by the security scanner stay on your machine.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          <Text bold>Telemetry:</Text>{' '}
          {noTelemetry ? (
            <>
              <Text color="green">DISABLED</Text> (via --no-telemetry)
            </>
          ) : (
            <>
              <Text color="yellow">ENABLED</Text> — run with{' '}
              <Text color="cyan">--no-telemetry</Text> to disable
            </>
          )}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Prefer your own AI? Download the skill:</Text>
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text color="cyan">{POSTHOG_TERMS_URL}</Text> ·{' '}
          <Text color="cyan">{POSTHOG_PRIVACY_URL}</Text> ·{' '}
          <Text color="cyan">{WIZARD_CONTACT_EMAIL}</Text>
        </Text>
      </Box>
    </Box>
  );
};

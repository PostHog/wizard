/**
 * PrivacyPanel — Shared disclosure component.
 *
 * Single source of truth for the wizard's privacy disclosure, rendered
 * identically from the intro screen ("Privacy & data usage" menu option)
 * and as an overlay from the auth screen ([I] keystroke).
 *
 * Sections:
 *   - Open source         (trust signal)
 *   - Leaves your machine (source files → Claude, run metadata → telemetry)
 *   - Stays on your machine (.env*, secrets, anything matched by YARA)
 *   - Telemetry status    (reflects session.noTelemetry)
 *   - BYOAI escape        (SkillSourceInfo — the strongest privacy out)
 *   - Terms / Privacy / Contact
 */

import type { ReactNode } from 'react';
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
      <Section title="Open source">
        <Text>
          The wizard's code is open:{' '}
          <Text color="cyan">{POSTHOG_WIZARD_REPO_URL}</Text>
        </Text>
      </Section>

      <Section title="Leaves your machine">
        <Bullet>Source files → Anthropic Claude (AI context)</Bullet>
        <Bullet>Run metadata → PostHog telemetry</Bullet>
      </Section>

      <Section title="Stays on your machine">
        <Bullet>.env* files and secrets</Bullet>
        <Bullet>Anything matched by the security scanner</Bullet>
      </Section>

      <Section title="Telemetry">
        {noTelemetry ? (
          <Text>
            <Text color="green">DISABLED</Text> (via --no-telemetry)
          </Text>
        ) : (
          <Text>
            <Text color="yellow">ENABLED</Text> — run with{' '}
            <Text color="cyan">--no-telemetry</Text> to disable
          </Text>
        )}
      </Section>

      <Section title="Prefer your own AI?">
        <Text>Download the skill and run it in your own agent:</Text>
        <Box marginTop={1}>
          <SkillSourceInfo
            skillId={skillId}
            skillEntry={skillEntry}
            fetchFailed={fetchFailed}
          />
        </Box>
      </Section>

      <Section title="More info">
        <Text>
          Terms: <Text color="cyan">{POSTHOG_TERMS_URL}</Text>
        </Text>
        <Text>
          Privacy: <Text color="cyan">{POSTHOG_PRIVACY_URL}</Text>
        </Text>
        <Text>
          Contact: <Text color="cyan">{WIZARD_CONTACT_EMAIL}</Text>
        </Text>
      </Section>
    </Box>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold>{title}</Text>
    <Box flexDirection="column" marginTop={0}>
      {children}
    </Box>
  </Box>
);

const Bullet = ({ children }: { children: ReactNode }) => (
  <Text>
    {'•'} {children}
  </Text>
);

/**
 * PrivacyPanel — Shared disclosure component.
 *
 * Single source of truth for the wizard's privacy disclosure, rendered
 * identically from the intro screen ("Privacy & data usage" menu option)
 * and as an overlay from the auth screen ([I] keystroke).
 *
 * Compact layout — must fit in a default-sized macOS Terminal (~24
 * rows) without scrolling. Sections are visually grouped with bold
 * headers and a single blank line between them; no nested margin boxes.
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
import { Divider } from '@ui/tui/primitives/index';

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

      <Section title="Leaves your machine">
        <Bullet>Source files → Anthropic Claude (AI context)</Bullet>
        <Bullet>Run metadata → PostHog telemetry</Bullet>
      </Section>

      <Section title="Stays on your machine">
        <Bullet>.env* files and secrets</Bullet>
        <Bullet>Anything matched by the security scanner</Bullet>
      </Section>

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

      <Section title="Prefer your own AI?">
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Section>

      <Box marginTop={1}>
        <Text dimColor>
          Terms: <Text color="cyan">{POSTHOG_TERMS_URL}</Text> · Privacy:{' '}
          <Text color="cyan">{POSTHOG_PRIVACY_URL}</Text>
        </Text>
      </Box>
      <Text dimColor>
        Contact: <Text color="cyan">{WIZARD_CONTACT_EMAIL}</Text>
      </Text>

      <Box marginTop={1}>
        <Divider />
      </Box>
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
    {children}
  </Box>
);

const Bullet = ({ children }: { children: ReactNode }) => (
  <Text>
    {'•'} {children}
  </Text>
);

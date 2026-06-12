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
  CONTEXT_MILL_RELEASES_URL,
  POSTHOG_PRIVACY_URL,
  POSTHOG_TERMS_URL,
  POSTHOG_WIZARD_REPO_URL,
  WIZARD_CONTACT_EMAIL,
} from '@lib/constants';
import { useSkillEntry } from '@ui/tui/screens/SkillSourceInfo';

interface PrivacyPanelProps {
  /** Program's skill id, for the BYOAI escape-hatch section. */
  skillId: string | null;
  /** Session's localMcp flag — picks remote vs local skill base URL. */
  localMcp: boolean;
}

export const PrivacyPanel = ({ skillId, localMcp }: PrivacyPanelProps) => {
  const { skillEntry } = useSkillEntry(skillId, localMcp);

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

      {/* Always link the release PAGE, never the direct asset URL — asset
          URLs are ~89 chars and hard-wrap inside this 64-col panel, which
          corrupts copy/paste with a mid-URL line break. The resolved skill
          entry names the exact asset to grab; when the lookup can't pin one
          (ambiguous framework variants, menu fetch failure) the sentence
          stays generic. */}
      <Box marginTop={1} flexDirection="column">
        <Text>
          Prefer your own AI? Download{' '}
          {skillEntry ? (
            <>
              the <Text bold>{skillEntry.id}</Text> skill
            </>
          ) : (
            'the skill for your framework'
          )}{' '}
          and run it in your own agent:
        </Text>
        <Text color="cyan">{CONTEXT_MILL_RELEASES_URL}</Text>
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

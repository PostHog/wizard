/**
 * AiOptInRequiredScreen — Renders when the wizard authenticates against an
 * org whose `is_ai_data_processing_approved` is not `true`. Mirrors Max's
 * strict reading: `null`, `undefined`, and `false` all block.
 *
 * Two variants selected from `apiUser.organization.membership_level`:
 *   - Admin (>= 8): can fix it themselves — [O] opens settings in browser.
 *   - Non-admin: needs to escalate — settings URL is displayed prominently
 *     to copy and share with the admin.
 *
 * Both variants offer [S] (show skill source for BYOAI), [R] (retry —
 * re-fetches user data and re-evaluates the gate without restarting), and
 * [E] (exit).
 */

import opn from 'opn';
import { Box, Text } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { useKeyBindings } from '@ui/tui/hooks/useKeyBindings';
import { Colors } from '@ui/tui/styles';
import {
  SkillSourceInfo,
  useSkillEntry,
} from '@ui/tui/screens/SkillSourceInfo';
import { fetchUserData } from '@lib/api';
import { getCloudUrlFromRegion } from '@utils/urls';
import { analytics } from '@utils/analytics';
import { LoadingBox } from '@ui/tui/primitives/index';

const ORG_ADMIN_LEVEL = 8;
const SETTINGS_ANCHOR = 'organization-ai-consent';

interface AiOptInRequiredScreenProps {
  store: WizardStore;
}

export const AiOptInRequiredScreen = ({
  store,
}: AiOptInRequiredScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const org = session.apiUser?.organization;
  const isAdmin = (org?.membership_level ?? 0) >= ORG_ADMIN_LEVEL;
  const variant: 'admin' | 'non-admin' = isAdmin ? 'admin' : 'non-admin';

  const region = session.region ?? 'us';
  const settingsUrl = `${getCloudUrlFromRegion(
    region,
  )}/settings/${SETTINGS_ANCHOR}`;

  const [showSkill, setShowSkill] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const { skillEntry, fetchFailed } = useSkillEntry(
    session.skillId,
    session.localMcp,
  );

  // Fire the "shown" event once per variant transition.
  useEffect(() => {
    analytics.wizardCapture('ai opt-in shown', { variant });
  }, [variant]);

  const handleOpenSettings = () => {
    analytics.wizardCapture('ai opt-in action', {
      variant,
      action: 'open_settings',
    });
    opn(settingsUrl, { wait: false }).catch(() => {
      // Best-effort — if the browser doesn't open, the URL is still
      // visible in the screen for manual navigation.
    });
  };

  const handleShowSkill = () => {
    analytics.wizardCapture('ai opt-in action', {
      variant,
      action: 'show_skill',
    });
    setShowSkill(true);
  };

  const handleRetry = () => {
    analytics.wizardCapture('ai opt-in action', { variant, action: 'retry' });
    const accessToken = session.credentials?.accessToken;
    if (!accessToken) {
      setRetryError('Missing credentials — cannot retry.');
      return;
    }
    setRetrying(true);
    setRetryError(null);
    void fetchUserData(accessToken, getCloudUrlFromRegion(region))
      .then((user) => {
        store.setApiUser(user);
      })
      .catch((err: unknown) => {
        setRetryError(err instanceof Error ? err.message : 'Retry failed.');
      })
      .finally(() => {
        setRetrying(false);
      });
  };

  const handleExit = () => {
    analytics.wizardCapture('ai opt-in action', { variant, action: 'exit' });
    process.exit(0);
  };

  useKeyBindings('ai-opt-in', [
    ...(isAdmin
      ? [
          {
            match: ['o', 'O'],
            label: 'O',
            action: 'open settings',
            handler: handleOpenSettings,
          },
        ]
      : []),
    {
      match: ['s', 'S'],
      label: 'S',
      action: 'show skill',
      handler: handleShowSkill,
    },
    {
      match: ['r', 'R'],
      label: 'R',
      action: 'retry',
      handler: handleRetry,
    },
    {
      match: ['e', 'E'],
      label: 'E',
      action: 'exit',
      handler: handleExit,
    },
  ]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Setup Wizard
        </Text>
        {session.apiUser?.email && (
          <Text>
            <Text color="green">{'✔'} </Text>
            <Text>Authenticated as {session.apiUser.email}</Text>
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow" bold>
          ⚠ PostHog AI services are disabled for your organization
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} width={68}>
        {isAdmin ? (
          <Text>
            The wizard uses Anthropic Claude. To proceed, enable{' '}
            <Text italic>
              "Enable PostHog features that use third-party AI services"
            </Text>{' '}
            in your organization settings.
          </Text>
        ) : (
          <>
            <Text>
              The wizard uses Anthropic Claude. Your organization admin needs to
              enable{' '}
              <Text italic>
                "Enable PostHog features that use third-party AI services"
              </Text>{' '}
              in organization settings.
            </Text>
            <Box marginTop={1}>
              <Text dimColor>Share this link with your admin:</Text>
            </Box>
          </>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text color="cyan">{settingsUrl}</Text>
      </Box>

      {showSkill && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>Prefer your own AI? Download the skill:</Text>
          <Box marginTop={1}>
            <SkillSourceInfo
              skillId={session.skillId}
              skillEntry={skillEntry}
              fetchFailed={fetchFailed}
            />
          </Box>
        </Box>
      )}

      {retrying && (
        <Box marginBottom={1}>
          <LoadingBox message="Re-checking organization settings..." />
        </Box>
      )}

      {retryError && (
        <Box marginBottom={1}>
          <Text color="red">{retryError}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {isAdmin && (
          <Text>
            <Text color={Colors.accent}>[O]</Text> Open settings in browser
          </Text>
        )}
        <Text>
          <Text color={Colors.accent}>[S]</Text> Show how to use your own AI
        </Text>
        <Text>
          <Text color={Colors.accent}>[R]</Text> Retry (after the toggle is
          enabled)
        </Text>
        <Text>
          <Text color={Colors.accent}>[E]</Text> Exit
        </Text>
      </Box>
    </Box>
  );
};

/**
 * HealthCheckScreen — Program screen between Intro and Auth.
 *
 * Three states:
 *   1. Checking: spinner while health check runs
 *   2. Healthy: isComplete returns true, router auto-advances to Auth
 *   3. Blocking outage: shows affected services with Continue/Exit
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import {
  ConfirmationInput,
  LoadingBox,
  ModalOverlay,
} from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import { ServiceHealthList } from '@ui/tui/components/ServiceHealthList';
import { getBlockingServiceKeys } from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import { wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@lib/errors';
import { fetchSkillMenu, downloadSkill } from '@lib/wizard-tools';
import { getSkillsBaseUrl } from '@lib/constants';
import { useDismissOnAnyKey } from '@ui/tui/hooks/useDismissOnAnyKey';

interface HealthCheckScreenProps {
  store: WizardStore;
}

const EXAMPLE_PROMPT =
  'Integrate PostHog into this project using the skill files in .posthog/skills/. Read SKILL.md first, then follow the numbered program files in order.';

const SkillsDownloadedScreen = () => {
  useDismissOnAnyKey(() => process.exit(0));

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text color="green" bold>
        {Icons.check} Skills downloaded to .posthog/skills/
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          You can continue setup with another agent using this prompt:
        </Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text color="cyan">{EXAMPLE_PROMPT}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to exit</Text>
      </Box>
    </Box>
  );
};

export const HealthCheckScreen = ({ store }: HealthCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const result = store.session.readinessResult;

  if (downloaded) {
    return <SkillsDownloadedScreen />;
  }

  // Still checking — show spinner
  if (!result) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <LoadingBox message="Checking skill downloads..." />
      </Box>
    );
  }

  const blockingKeys = getBlockingServiceKeys(result.health);
  if (blockingKeys.length === 0) return null;

  const isSkillsOriginDown = blockingKeys.includes('skillsOrigin');
  const canDownloadSkills =
    result.health.skillsOrigin.status === ServiceHealthStatus.Healthy;
  const integration = store.session.integration;
  const canOfferDownload = canDownloadSkills && Boolean(integration);
  const allNoConnection = blockingKeys.every(
    (key) => result.health[key]?.status === ServiceHealthStatus.NoConnection,
  );
  const title = allNoConnection
    ? isSkillsOriginDown
      ? 'Could not connect to skill downloads'
      : 'Could not connect to the AI gateway'
    : isSkillsOriginDown
    ? 'Skill downloads unavailable'
    : 'AI gateway unavailable';

  const docsUrl = store.session.frameworkConfig?.metadata.docsUrl;
  const description = isSkillsOriginDown
    ? 'The Wizard could not download the skills it needs from any configured source. Check your connection and try again.'
    : allNoConnection
    ? 'The Wizard could not connect to the PostHog AI gateway from this machine. Check your connection and try again.'
    : 'The PostHog AI gateway is currently unavailable. You can try continuing, or exit and try again later.';

  const handleDownloadAndExit = async () => {
    if (downloading || !integration) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      // Use the same source as the run; release downloads fail over themselves.
      const menu = await fetchSkillMenu(getSkillsBaseUrl());
      if (!menu) throw new Error('Could not load the integration skills.');
      const prefix = `integration-${integration}`;
      const skills = (menu.categories['integration'] ?? []).filter((s) =>
        s.id.startsWith(prefix),
      );
      if (skills.length === 0) {
        throw new Error('No integration skills were found for this project.');
      }
      for (const skill of skills) {
        // The gateway is unavailable, so a flagged skill must fail closed.
        const installed = await downloadSkill(skill, store.session.installDir, {
          skillsRoot: '.posthog/skills',
          triage: undefined,
        });
        if (!installed.success) {
          throw new Error(
            'The integration skills could not be downloaded safely.',
          );
        }
      }
      setDownloaded(true);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : 'Could not download the integration skills.',
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleCancel =
    canOfferDownload && !isSkillsOriginDown && !downloadError
      ? () => void handleDownloadAndExit()
      : () =>
          void wizardAbort({
            code: ErrorCodes.EnvServiceOutage,
            message: 'Exited due to service outage.',
          });

  const cancelLabel =
    canOfferDownload && !isSkillsOriginDown && !downloadError
      ? downloading
        ? 'Downloading...'
        : 'Download skills & Exit [Esc]'
      : 'Exit [Esc]';

  return (
    <ModalOverlay
      borderColor={allNoConnection ? 'yellow' : 'red'}
      title={title}
      width={72}
      footer={
        isSkillsOriginDown ? (
          <ConfirmationInput
            message=""
            confirmLabel=""
            cancelLabel="Exit [Esc]"
            onConfirm={() =>
              void wizardAbort({
                code: ErrorCodes.EnvServiceOutage,
                message: 'Exited due to service outage.',
              })
            }
            onCancel={() =>
              void wizardAbort({
                code: ErrorCodes.EnvServiceOutage,
                message: 'Exited due to service outage.',
              })
            }
          />
        ) : (
          <ConfirmationInput
            message="Continue anyway?"
            confirmLabel="Continue [Enter]"
            cancelLabel={cancelLabel}
            onConfirm={() => store.dismissOutage()}
            onCancel={handleCancel}
          />
        )
      }
    >
      <Box flexDirection="column" marginBottom={1}>
        <ServiceHealthList
          health={result.health}
          filterKeys={blockingKeys}
          showHealthy={false}
        />
      </Box>

      <Text dimColor>{description}</Text>

      {isSkillsOriginDown && docsUrl && (
        <Box marginTop={1}>
          <Text>
            Set up manually: <Text color="cyan">{docsUrl}</Text>
          </Text>
        </Box>
      )}

      {downloadError && (
        <Box marginTop={1}>
          <Text color="red">{downloadError}</Text>
        </Box>
      )}

      {canOfferDownload && !isSkillsOriginDown && !downloadError && (
        <Box marginTop={1}>
          <Text>
            You can still download the PostHog integration skills and continue
            with another agent.
          </Text>
        </Box>
      )}
    </ModalOverlay>
  );
};

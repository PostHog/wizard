/**
 * HealthCheckScreen — Flow screen between Intro and Auth.
 *
 * Three states:
 *   1. Checking: spinner while health check runs
 *   2. Healthy: isComplete returns true, router auto-advances to Auth
 *   3. Blocking outage: shows affected services with Continue/Exit
 */

import { Box, Text, useInput } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import {
  ConfirmationInput,
  LoadingBox,
  ModalOverlay,
} from '../../primitives/index.js';
import { Colors, Icons } from '../../styles.js';
import { ServiceHealthList } from '../../components/ServiceHealthList.js';
import { getBlockingServiceKeys } from '../../../../lib/health-checks/readiness.js';
import { ServiceHealthStatus } from '../../../../lib/health-checks/types.js';
import { wizardAbort } from '../../../../utils/wizard-abort.js';
import { fetchSkillMenu, downloadSkill } from '../../../../lib/wizard-tools.js';

interface HealthCheckScreenProps {
  store: WizardStore;
}

const EXAMPLE_PROMPT =
  'Integrate PostHog into this project using the skill files in .posthog/skills/. Read SKILL.md first, then follow the numbered workflow files in order.';

const SkillsDownloadedScreen = () => {
  useInput(() => {
    process.exit(0);
  });

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
        <LoadingBox message="Checking service status..." />
      </Box>
    );
  }

  // Healthy or warnings — isComplete returns true, router skips past.
  // This branch only renders for a single frame before advancing.
  const blockingKeys = getBlockingServiceKeys(result.health);
  if (blockingKeys.length === 0) return null;

  const isGithubReleasesDown = blockingKeys.includes('githubReleases');
  const canDownloadSkills =
    result.health.githubReleases.status === ServiceHealthStatus.Healthy;
  const integration = store.session.integration;

  const title = `Ongoing service disruptions`;

  const docsUrl = store.session.frameworkConfig?.metadata.docsUrl;
  const description = isGithubReleasesDown
    ? "The Wizard can't download necessary skills from GitHub Releases right now."
    : 'The Wizard may not work reliably while services are affected.';

  const handleDownloadAndExit = async () => {
    if (downloading) return;
    setDownloading(true);
    const skillsBaseUrl =
      'https://github.com/PostHog/context-mill/releases/latest/download';
    const menu = await fetchSkillMenu(skillsBaseUrl);
    if (menu) {
      const prefix = `integration-${integration}`;
      const skills = (menu.categories['integration'] ?? []).filter((s) =>
        s.id.startsWith(prefix),
      );
      for (const skill of skills) {
        downloadSkill(skill, store.session.installDir, '.posthog/skills');
      }
    }
    setDownloaded(true);
  };

  const handleCancel =
    canDownloadSkills && !isGithubReleasesDown
      ? () => void handleDownloadAndExit()
      : () => void wizardAbort({ message: 'Exited due to service outage.' });

  const cancelLabel =
    canDownloadSkills && !isGithubReleasesDown
      ? downloading
        ? 'Downloading...'
        : 'Download skills & Exit [Esc]'
      : 'Exit [Esc]';

  // Blocking outage — show service list with Continue/Exit
  return (
    <ModalOverlay
      borderColor="red"
      title={title}
      width={72}
      footer={
        isGithubReleasesDown ? (
          <ConfirmationInput
            message=""
            confirmLabel=""
            cancelLabel="Exit [Esc]"
            onConfirm={() =>
              void wizardAbort({ message: 'Exited due to service outage.' })
            }
            onCancel={() =>
              void wizardAbort({ message: 'Exited due to service outage.' })
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
        <Box marginBottom={1}>
          <Text>
            <Text color="red">{Icons.squareFilled}</Text>
            <Text dimColor> Down </Text>
            <Text color="#DC9300">{Icons.squareFilled}</Text>
            <Text dimColor> Degraded</Text>
          </Text>
        </Box>

        <ServiceHealthList
          health={result.health}
          filterKeys={blockingKeys}
          showHealthy={false}
        />
      </Box>

      <Text dimColor>{description}</Text>

      {isGithubReleasesDown && docsUrl && (
        <Box marginTop={1}>
          <Text>
            Set up manually: <Text color="cyan">{docsUrl}</Text>
          </Text>
        </Box>
      )}

      {canDownloadSkills && !isGithubReleasesDown && (
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

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
import {
  getBlockingServiceKeys,
  SIGNUP_WIZARD_READINESS_CONFIG,
} from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import { wizardAbort } from '@utils/wizard-abort';
import { fetchSkillMenu, downloadSkill } from '@lib/wizard-tools';
import { REMOTE_SKILLS_BASE_URL } from '@lib/constants';
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

  const isSignup = store.session.signup;
  const blockingKeys = getBlockingServiceKeys(
    result.health,
    isSignup ? SIGNUP_WIZARD_READINESS_CONFIG : undefined,
  );

  // Signup has a narrower block list (only posthog + llm-gateway), so
  // services like Anthropic can be degraded without blocking. Surface
  // those as dismissable warnings instead of silently proceeding.
  const warningKeys = isSignup
    ? getBlockingServiceKeys(result.health).filter(
        (k) => !blockingKeys.includes(k),
      )
    : [];

  const hasHardBlock = blockingKeys.length > 0;
  const displayKeys = hasHardBlock ? blockingKeys : warningKeys;
  if (displayKeys.length === 0) return null;

  const isGithubReleasesDown =
    hasHardBlock && blockingKeys.includes('githubReleases');
  const canDownloadSkills =
    result.health.githubReleases.status === ServiceHealthStatus.Healthy;
  const integration = store.session.integration;

  // If every blocking row is `NoConnection` (probe failed, no status-page
  // corroboration), reframe the screen to point at the user's network
  // instead of accusing PostHog of an outage. Mixed Down + NoConnection
  // falls through to the confirmed-outage framing because there's still
  // a real incident underneath.
  const allBlockingHaveNoConnection =
    hasHardBlock &&
    displayKeys.every(
      (k) => result.health[k].status === ServiceHealthStatus.NoConnection,
    );

  const title = isGithubReleasesDown
    ? 'Ongoing service disruptions'
    : allBlockingHaveNoConnection
    ? "Couldn't reach PostHog"
    : hasHardBlock
    ? 'Ongoing service disruptions'
    : 'Service disruption detected';

  const docsUrl = store.session.frameworkConfig?.metadata.docsUrl;
  const description = isGithubReleasesDown
    ? "The Wizard can't download necessary skills from GitHub Releases right now."
    : allBlockingHaveNoConnection
    ? "We couldn't reach these services from this machine. PostHog's status page shows no incidents, so this is most likely a network issue — VPN, firewall, captive portal, or flaky Wi-Fi."
    : hasHardBlock
    ? 'The Wizard cannot start while these services are down.'
    : 'Some services are degraded. You can continue, but parts of the wizard may not work reliably.';

  const handleDownloadAndExit = async () => {
    if (downloading) return;
    setDownloading(true);
    const menu = await fetchSkillMenu(REMOTE_SKILLS_BASE_URL);
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

  return (
    <ModalOverlay
      borderColor={
        hasHardBlock && !allBlockingHaveNoConnection ? 'red' : 'yellow'
      }
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
            <Text dimColor> Degraded </Text>
            <Text color="gray">{Icons.squareFilled}</Text>
            <Text dimColor> No connection</Text>
          </Text>
        </Box>

        <ServiceHealthList
          health={result.health}
          filterKeys={displayKeys}
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

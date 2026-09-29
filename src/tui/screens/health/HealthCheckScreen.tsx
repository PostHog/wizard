/**
 * HealthCheckScreen — Program screen between Intro and Auth.
 *
 * Three states:
 *   1. Checking: spinner while health check runs
 *   2. Healthy: isComplete returns true, router auto-advances to Auth
 *   3. Blocking outage: shows affected services with Continue/Exit
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@tui/store';
import {
  ConfirmationInput,
  LoadingBox,
  ModalOverlay,
} from '@tui/primitives/index';
import { Icons } from '@tui/styles';
import { ServiceHealthList } from '@tui/components/ServiceHealthList';
import {
  getBlockingServiceKeys,
  SIGNUP_WIZARD_READINESS_CONFIG,
} from '@shared/health-checks/readiness';
import { ServiceHealthStatus } from '@shared/health-checks/types';
import { abortOnScreens } from '@tui/abort';
import { ErrorCodes } from '@shared/errors';

interface HealthCheckScreenProps {
  store: WizardStore;
}

export const HealthCheckScreen = ({ store }: HealthCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const result = store.session.readinessResult;

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

  const isSkillsOriginDown =
    hasHardBlock && blockingKeys.includes('skillsOrigin');

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

  const title = isSkillsOriginDown
    ? 'Ongoing service disruptions'
    : allBlockingHaveNoConnection
    ? "Couldn't reach PostHog"
    : hasHardBlock
    ? 'Ongoing service disruptions'
    : 'Service disruption detected';

  const docsUrl = store.session.frameworkConfig?.metadata.docsUrl;
  const description = isSkillsOriginDown
    ? "The Wizard can't download the skills it needs — neither GitHub Releases nor PostHog's mirror is reachable right now."
    : allBlockingHaveNoConnection
    ? "We couldn't reach these services from this machine. PostHog's status page shows no incidents, so this is most likely a network issue — VPN, firewall, captive portal, or flaky Wi-Fi."
    : hasHardBlock
    ? 'The Wizard cannot start while these services are down.'
    : 'Some services are degraded. You can continue, but parts of the wizard may not work reliably.';

  const exitForOutage = () =>
    void abortOnScreens(store, {
      code: ErrorCodes.EnvServiceOutage,
      message: 'Exited due to service outage.',
    });

  return (
    <ModalOverlay
      borderColor={
        hasHardBlock && !allBlockingHaveNoConnection ? 'red' : 'yellow'
      }
      title={title}
      width={72}
      footer={
        isSkillsOriginDown ? (
          <ConfirmationInput
            message=""
            confirmLabel=""
            cancelLabel="Exit [Esc]"
            onConfirm={exitForOutage}
            onCancel={exitForOutage}
          />
        ) : (
          <ConfirmationInput
            message="Continue anyway?"
            confirmLabel="Continue [Enter]"
            cancelLabel="Exit [Esc]"
            onConfirm={() => store.dismissOutage()}
            onCancel={exitForOutage}
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

      {isSkillsOriginDown && docsUrl && (
        <Box marginTop={1}>
          <Text>
            Set up manually: <Text color="cyan">{docsUrl}</Text>
          </Text>
        </Box>
      )}
    </ModalOverlay>
  );
};

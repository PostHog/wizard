/**
 * SelfDrivingEventsCheckScreen — shown only when PostHog is already present.
 * Probes the project's event definitions server-side (so events captured
 * from other repos or the snippet count too): custom events found → resolves
 * silently and the flow proceeds; only default events (or none) → proposes
 * setting up product analytics, which routes into the same integrate path
 * the no-PostHog flow uses (the standard integration program is the
 * analytics setup).
 *
 * Runs after auth — the probe needs credentials. Fails open: a probe error
 * counts as "has custom events" so a flaky API never nags the user.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import { analytics, sessionProperties } from '@utils/analytics';
import { fetchHasCustomEvents } from '@lib/api';
import { SELF_DRIVING_CUSTOM_EVENTS_KEY } from '@lib/programs/self-driving/detect';

interface SelfDrivingEventsCheckScreenProps {
  store: WizardStore;
}

export const SelfDrivingEventsCheckScreen = ({
  store,
}: SelfDrivingEventsCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { credentials, frameworkContext } = store.session;
  const hasCustomEvents = frameworkContext[SELF_DRIVING_CUSTOM_EVENTS_KEY];
  const started = useRef(false);

  // Probe once, after auth. The result lands in frameworkContext — `true`
  // completes the step (nothing to propose), `false` renders the proposal.
  useEffect(() => {
    if (!credentials || started.current || hasCustomEvents !== undefined) {
      return;
    }
    started.current = true;
    void (async () => {
      // Fail open — an unreachable or unreadable endpoint must not nag a
      // user whose events may be perfectly fine.
      let result = true;
      try {
        result = await fetchHasCustomEvents(
          credentials.accessToken,
          credentials.projectId,
          credentials.host.apiHost,
        );
      } catch {
        /* fail open */
      }
      analytics.wizardCapture('self-driving events check', {
        self_driving_has_custom_events: result,
        ...sessionProperties(store.session),
      });
      store.setFrameworkContext(SELF_DRIVING_CUSTOM_EVENTS_KEY, result);
    })();
  }, [credentials, hasCustomEvents, store]);

  if (hasCustomEvents !== false) {
    return <LoadingBox message="Checking your event tracking..." />;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Only default events found
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          This project isn&apos;t capturing any custom events yet — just
          PostHog&apos;s built-in ones (pageviews, autocapture). Product
          analytics events track what users actually do in your product, and
          give Self-driving real behavior to watch.
        </Text>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[
            { label: 'Set up product analytics', value: 'yes' },
            { label: 'Skip for now — continue to Self-driving', value: 'no' },
          ]}
          onSelect={(value) => {
            const v = Array.isArray(value) ? value[0] : value;
            store.setIntegrate(v === 'yes', { via: 'default-events-only' });
          }}
        />
      </Box>
    </Box>
  );
};

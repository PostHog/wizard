/**
 * WarehouseOfferScreen — offers to connect the data warehouse sources detected
 * in the project as part of the default setup flow.
 *
 * Shown only when detection actually found sources, so a project with nothing
 * to connect never sees it. Answering sets `session.warehouseOptIn`, which
 * splices the warehouse agent run in after the integration run.
 *
 * Deliberately placed before auth: the answer decides which run is the last one
 * of the invocation, and the last run owns the outro. See
 * POSTHOG_INTEGRATION_PROGRAM.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import { getDetectedWarehouseSources } from '@lib/programs/warehouse-source/detect';

interface WarehouseOfferScreenProps {
  store: WizardStore;
}

export const WarehouseOfferScreen = ({ store }: WarehouseOfferScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const detected = getDetectedWarehouseSources(store.session);
  const needsCredentials = detected.some((s) => s.mode === 'in-cli');

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        We found data you can query in PostHog
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Detected in this project:</Text>
        {detected.map((s) => (
          <Text key={s.kind} dimColor>
            {'  •'} {s.label}
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>
          PostHog can import these into its data warehouse, so you can query
          them alongside your product data.
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            {needsCredentials
              ? 'This happens after your PostHog setup finishes, and the agent will ask you for connection details. Adds about 5 minutes.'
              : 'This happens after your PostHog setup finishes. Adds about 5 minutes.'}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[
            { label: 'Connect them [Enter]', value: 'connect' },
            { label: 'Skip for now', value: 'skip' },
          ]}
          onSelect={(value) => store.setWarehouseOptIn(value === 'connect')}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          You can always do this later with{' '}
          <Text bold>npx @posthog/wizard warehouse</Text>
        </Text>
      </Box>
    </Box>
  );
};

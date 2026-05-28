/**
 * WarehouseOfferScreen — post-run soft prompt in the main integration flow.
 *
 * Shown only when the detect step found a data warehouse source (see the
 * `warehouse-offer` step in posthog-integration/steps.ts). Surfaces the
 * detected sources and offers to open PostHog's new-source setup in the
 * browser (pre-filled with the source kind when there's a single match),
 * or skip. The full in-CLI flow lives behind `npx @posthog/wizard warehouse`.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { getUiHostFromHost } from '@utils/urls';
import { openUrl } from '@utils/open-url';
import type { DetectedSource } from '@lib/warehouse-sources/types';

interface WarehouseOfferScreenProps {
  store: WizardStore;
}

export const WarehouseOfferScreen = ({ store }: WarehouseOfferScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const detected =
    (session.frameworkContext.detectedWarehouseSources as
      | DetectedSource[]
      | undefined) ?? [];
  const credentials = session.credentials;

  const newSourceUrl = (): string | null => {
    if (!credentials) return null;
    const base = `${getUiHostFromHost(credentials.host)}/project/${
      credentials.projectId
    }/data-warehouse/new-source`;
    // Pre-fill the kind only when there's a single unambiguous match.
    return detected.length === 1 ? `${base}?kind=${detected[0].kind}` : base;
  };

  const url = newSourceUrl();

  const labels = detected.map((s) => s.label).join(', ');

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text color="cyan" bold>
        Connect your data warehouse?
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          We noticed this project uses <Text bold>{labels}</Text>. You can
          import it into PostHog's data warehouse and query it alongside product
          data.
        </Text>
      </Box>

      {url && (
        <Box marginTop={1}>
          <Text dimColor>Setup: {url}</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Or run <Text bold>npx @posthog/wizard warehouse</Text> to set sources
          up from the terminal.
        </Text>
      </Box>

      <Box marginTop={1} width={32}>
        <PickerMenu
          options={[
            { label: 'Open setup in browser', value: 'open' },
            { label: 'Skip', value: 'skip' },
          ]}
          onSelect={(value) => {
            const choice = Array.isArray(value) ? value[0] : value;
            if (choice === 'open' && url) {
              openUrl(url);
            }
            store.setWarehouseOfferDismissed();
          }}
        />
      </Box>
    </Box>
  );
};

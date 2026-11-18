/**
 * Welcome screen for the warehouse export flow. Asks which warehouse the user
 * runs, with the ones detection found listed first, and records the pick in
 * frameworkContext for the run's prompt.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@tui/store';
import { PickerMenu, type PickerOption } from '@tui/primitives/index';
import { IntroScreenLayout } from '@tui/screens/IntroScreenLayout';
import {
  applySharingChoice,
  isSharing,
  resolveSharingOnContinue,
  sharingOptions,
} from '@tui/components/sharing-options';
import {
  CHOSEN_WAREHOUSE_DESTINATION_KEY,
  getDetectedWarehouseDestinations,
  WAREHOUSE_DESTINATION_TYPES,
  type WarehouseDestinationDetectError,
  type WarehouseDestinationType,
} from '@programs/warehouse-destination';

const DESTINATION_LABELS: Record<WarehouseDestinationType, string> = {
  BigQuery: 'BigQuery',
  Snowflake: 'Snowflake',
  Redshift: 'Redshift',
  Databricks: 'Databricks',
  Postgres: 'PostgreSQL',
  S3: 'S3 or S3-compatible storage',
  AzureBlob: 'Azure Blob Storage',
};

const NO_WAREHOUSE = 'no-warehouse';
const CHOOSE = 'choose';
const MORE_INFO = 'more-info';
const BACK = 'back';

type View = 'main' | 'choose' | 'more-info';

function isDestinationType(value: string): value is WarehouseDestinationType {
  return (WAREHOUSE_DESTINATION_TYPES as readonly string[]).includes(value);
}

/** The first menu: the detected warehouses, then a way to pick any other. */
export function mainOptions(
  detected: readonly WarehouseDestinationType[],
): PickerOption<string>[] {
  return [
    ...detected.map((type) => ({
      label: DESTINATION_LABELS[type],
      value: type,
      hint: 'detected',
    })),
    {
      label:
        detected.length > 0 ? 'A different warehouse' : 'Choose a warehouse',
      value: CHOOSE,
    },
    { label: "I don't run a warehouse", value: NO_WAREHOUSE },
    { label: 'More info', value: MORE_INFO },
  ];
}

/** Every warehouse type PostHog exports to. Kept under the picker's filter threshold. */
export function allDestinationOptions(): PickerOption<string>[] {
  return [
    ...WAREHOUSE_DESTINATION_TYPES.map((type) => ({
      label: DESTINATION_LABELS[type],
      value: type,
    })),
    { label: 'Back', value: BACK },
  ];
}

interface WarehouseDestinationIntroScreenProps {
  store: WizardStore;
}

export const WarehouseDestinationIntroScreen = ({
  store,
}: WarehouseDestinationIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [view, setView] = useState<View>('main');
  const showingMoreInfo = view === 'more-info';

  const { session } = store;
  const detectError = session.frameworkContext.detectError as
    | WarehouseDestinationDetectError
    | undefined;
  const detected = getDetectedWarehouseDestinations(session);

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56} flexShrink={0}>
      <Text>
        PostHog exports your events to your warehouse on a schedule. You save
        the warehouse credentials in PostHog, in your browser. They never pass
        through the terminal or the agent.
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          Exports are billed by rows exported. See{' '}
          <Text color="cyan">https://posthog.com/docs/cdp/batch-exports</Text>.
        </Text>
      </Box>
    </Box>
  ) : (
    // Detected warehouses show as menu rows: a separate list overflows the intro's height.
    <Box flexDirection="column" alignItems="center">
      <Text>Let's send your PostHog data to your own warehouse.</Text>
      <Text dimColor>Which warehouse do you run?</Text>
    </Box>
  );

  const errorView = detectError ? (
    <>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red" bold>
          {'✘'} Invalid project directory
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            This path{' '}
            {
              {
                missing: 'does not exist',
                'not-dir': 'is not a directory',
                unreadable: 'could not be accessed',
              }[detectError.reason]
            }
            :
          </Text>
          <Text dimColor>
            {'  '}
            {detectError.path}
          </Text>
        </Box>
      </Box>
      <PickerMenu
        options={[{ label: 'Exit', value: 'exit' }]}
        onSelect={() => store.requestExit(0)}
      />
    </>
  ) : undefined;

  const menuOptions =
    view === 'more-info'
      ? [{ label: 'Back', value: BACK }]
      : view === 'choose'
      ? allDestinationOptions()
      : mainOptions(detected.map((d) => d.type));

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={store.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      privacyOptions={sharingOptions(isSharing(store))}
      errorView={errorView}
      onSelect={(value) => {
        if (applySharingChoice(store, value)) return;
        if (value === NO_WAREHOUSE) {
          store.requestExit(0);
        } else if (value === MORE_INFO) {
          setView('more-info');
        } else if (value === CHOOSE) {
          setView('choose');
        } else if (value === BACK) {
          setView('main');
        } else if (isDestinationType(value)) {
          store.setFrameworkContext(CHOSEN_WAREHOUSE_DESTINATION_KEY, value);
          resolveSharingOnContinue(store);
          store.completeSetup();
        }
      }}
    />
  );
};

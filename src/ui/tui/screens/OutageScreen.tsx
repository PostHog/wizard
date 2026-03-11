/**
 * OutageScreen — Shown when services are degraded or health check blocks.
 *
 * Two cases:
 *   1. readinessOutage — Health check blocked (critical services down).
 *      Shows Legend, affected services list, options: Continue anyway, Exit.
 *      Does NOT install skills.
 *   2. serviceStatus — Claude/Anthropic services degraded.
 *      Shows status and options: Continue anyway, Exit.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { ReadinessOutageInfo } from '../../../lib/wizard-session.js';
import type { WizardStore } from '../store.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Icons } from '../styles.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

interface OutageScreenProps {
  store: WizardStore;
}

function getDetailsForService(
  componentDetails: ReadinessOutageInfo['componentDetails'],
  serviceLabel: string,
) {
  return componentDetails?.find((g) => g.serviceLabel === serviceLabel);
}

function getAffectedServices(
  services: ReadinessOutageInfo['services'],
  componentDetails: ReadinessOutageInfo['componentDetails'],
) {
  const list = services ?? [];
  const details = componentDetails ?? [];
  return list
    .filter((s) => s.status !== 'healthy')
    .map((s) => {
      const d = getDetailsForService(details, s.label);
      return {
        label: s.label,
        status: s.status as 'degraded' | 'down',
        items: d?.items ?? [],
      };
    });
}

const SQUARE = '\u25FC';
const STATUS_COLORS = {
  healthy: 'greenBright' as const,
  degraded: 'yellowBright' as const,
  down: 'redBright' as const,
};

function StatusSquare({ status }: { status: 'healthy' | 'degraded' | 'down' }) {
  return <Text color={STATUS_COLORS[status]}>{SQUARE}</Text>;
}

function Legend() {
  return (
    <Text>
      <Text color={STATUS_COLORS.healthy}>{SQUARE} healthy</Text>
      <Text> </Text>
      <Text color={STATUS_COLORS.degraded}>{SQUARE} degraded</Text>
      <Text> </Text>
      <Text color={STATUS_COLORS.down}>{SQUARE} down</Text>
    </Text>
  );
}

const MAX_ITEMS_PER_SERVICE = 3;
const AFFECTED_BOX_WIDTH = 64;

function AffectedServiceList({
  affected,
}: {
  affected: Array<{
    label: string;
    status: 'degraded' | 'down';
    items: Array<{ name: string; status: string }>;
  }>;
}) {
  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      {affected.map(({ label, status, items }, i) => (
        <Box key={i} flexDirection="column">
          <Text dimColor>
            <StatusSquare status={status} />
            <Text> </Text>
            <Text>{label}</Text>
          </Text>
          {items.slice(0, MAX_ITEMS_PER_SERVICE).map((item, ii) => (
            <Box key={ii} marginLeft={2}>
              <Text>
                <StatusSquare
                  status={
                    (item.status as 'healthy' | 'degraded' | 'down') ||
                    'degraded'
                  }
                />
                <Text dimColor> {item.name}</Text>
              </Text>
            </Box>
          ))}
          {items.length > MAX_ITEMS_PER_SERVICE && (
            <Box marginLeft={2}>
              <Text dimColor>
                {'  '}... and {items.length - MAX_ITEMS_PER_SERVICE} more
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

export const OutageScreen = ({ store }: OutageScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const readinessOutage = store.session.readinessOutage;
  const serviceStatus = store.session.serviceStatus;

  const [columns] = useStdoutDimensions();
  const boxWidth = Math.max(AFFECTED_BOX_WIDTH, Math.min(columns - 4, 100));

  if (readinessOutage) {
    const services = readinessOutage.services ?? [];
    const componentDetails = readinessOutage.componentDetails ?? [];
    const affected = getAffectedServices(services, componentDetails);

    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" paddingX={3} paddingY={1} width={boxWidth}>
          <Box justifyContent="center" marginBottom={1}>
            <Text color="red" bold>
              {Icons.warning} Services down or degraded
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Legend />
          </Box>
          <Text>
            Some services the Wizard depends on are experiencing issues:
          </Text>
          {affected.length > 0 ? (
            <AffectedServiceList affected={affected} />
          ) : (
            <Box marginY={1} paddingLeft={2}>
              <Text dimColor>
                {Icons.warning} Required services are down or degraded
              </Text>
            </Box>
          )}
          <Box marginY={1}>
            <Text dimColor>{'─'.repeat(boxWidth - 8)}</Text>
          </Box>

          <Box marginTop={2}>
            <ConfirmationInput
              message="What would you like to do?"
              confirmLabel="Continue anyway [Enter]"
              cancelLabel="Exit [Esc]"
              onConfirm={() => store.dismissOutageOverlay()}
              onCancel={() => process.exit(0)}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  if (serviceStatus) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" paddingX={3} paddingY={1} width={boxWidth}>
          <Box justifyContent="center" marginBottom={1}>
            <Text color="red" bold>
              {Icons.warning} Claude/Anthropic services are experiencing issues
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text>
              <Text color="yellow">Status:</Text> {serviceStatus.description}
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text>
              <Text color="yellow">Status page:</Text>{' '}
              <Text color="cyan">{serviceStatus.statusPageUrl}</Text>
            </Text>
          </Box>
          <Box marginTop={2}>
            <ConfirmationInput
              message="The Wizard may not work while these services are affected."
              confirmLabel="Continue anyway [Enter]"
              cancelLabel="Exit [Esc]"
              onConfirm={() => store.dismissOutageOverlay()}
              onCancel={() => process.exit(0)}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return null;
};

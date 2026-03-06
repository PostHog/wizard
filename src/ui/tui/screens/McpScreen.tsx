/**
 * McpScreen — MCP server install/remove flow.
 *
 * Uses an McpInstaller service (passed via props) instead of
 * importing business logic directly. Testable, no dynamic imports.
 *
 * Supports two modes via the `mode` prop:
 *   - 'install': detect clients → confirm → install
 *   - 'remove': detect installed clients → confirm → remove
 *
 * When done, calls store.setMcpComplete(). The router resolves to outro.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { type WizardStore, McpOutcome } from '../store.js';
import { ConfirmationInput, PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import type { McpInstaller, McpClientInfo } from '../services/mcp-installer.js';

export type McpMode = 'install' | 'remove';

interface McpScreenProps {
  store: WizardStore;
  installer: McpInstaller;
  mode?: McpMode;
  /** When true, exit the process after completion instead of routing to outro. */
  standalone?: boolean;
}

enum Phase {
  Detecting = 'detecting',
  Ask = 'ask',
  Pick = 'pick',
  Working = 'working',
  Done = 'done',
  None = 'none',
}

const markDone = (
  store: WizardStore,
  outcome: McpOutcome,
  clients: string[] = [],
  standalone = false,
) => {
  store.setMcpComplete(outcome, clients);
  if (standalone) {
    process.exit(0);
  }
};

export const McpScreen = ({
  store,
  installer,
  mode = 'install',
  standalone = false,
}: McpScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const isRemove = mode === 'remove';

  const [phase, setPhase] = useState<Phase>(Phase.Detecting);
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [resultClients, setResultClients] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const detected = await installer.detectClients();
        if (detected.length === 0) {
          setPhase(Phase.None);
          setTimeout(
            () => markDone(store, McpOutcome.NoClients, [], standalone),
            1500,
          );
        } else {
          setClients(detected);
          setPhase(Phase.Ask);
        }
      } catch {
        setPhase(Phase.None);
        setTimeout(
          () => markDone(store, McpOutcome.Failed, [], standalone),
          1500,
        );
      }
    })();
  }, [installer]); // eslint-disable-line

  const handleConfirm = () => {
    if (isRemove) {
      void doRemove();
    } else if (clients.length === 1) {
      void doInstall(clients.map((c) => c.name));
    } else {
      setPhase(Phase.Pick);
    }
  };

  const handleSkip = () => {
    markDone(store, McpOutcome.Skipped, [], standalone);
  };

  const doInstall = async (names: string[]) => {
    setPhase(Phase.Working);
    let result: string[] = [];
    try {
      result = await installer.install(names);
      setResultClients(result);
    } catch {
      setResultClients([]);
    }
    setPhase(Phase.Done);
    const outcome =
      result.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    setTimeout(() => markDone(store, outcome, result, standalone), 2000);
  };

  const doRemove = async () => {
    setPhase(Phase.Working);
    let result: string[] = [];
    try {
      result = await installer.remove();
      setResultClients(result);
    } catch {
      setResultClients([]);
    }
    setPhase(Phase.Done);
    const outcome =
      result.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    setTimeout(() => markDone(store, outcome, result, standalone), 2000);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        MCP Server {isRemove ? 'Removal' : 'Setup'}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Detecting && (
          <Text dimColor>Detecting supported editors...</Text>
        )}

        {phase === Phase.None && (
          <Text dimColor>
            No {isRemove ? 'installed' : 'supported'} MCP clients detected.
            Skipping...
          </Text>
        )}

        {phase === Phase.Ask && (
          <>
            <Text dimColor>
              Detected: {clients.map((c) => c.name).join(', ')}
            </Text>
            <Box marginTop={1}>
              <ConfirmationInput
                message={
                  isRemove
                    ? 'Remove the PostHog MCP server from your editor?'
                    : 'Install the PostHog MCP server to your editor?'
                }
                confirmLabel={isRemove ? 'Remove MCP' : 'Install MCP'}
                cancelLabel="No thanks"
                onConfirm={handleConfirm}
                onCancel={handleSkip}
              />
            </Box>
          </>
        )}

        {phase === Phase.Pick && (
          <PickerMenu
            message="Select editor to install MCP server"
            options={clients.map((c) => ({
              label: c.name,
              value: c.name,
            }))}
            mode="multi"
            onSelect={(selected) => {
              const names = Array.isArray(selected) ? selected : [selected];
              void doInstall(names);
            }}
          />
        )}

        {phase === Phase.Working && (
          <Text dimColor>
            {isRemove ? 'Removing' : 'Installing'} MCP server...
          </Text>
        )}

        {phase === Phase.Done && (
          <Box flexDirection="column">
            {resultClients.length > 0 ? (
              <>
                <Text color="green" bold>
                  {'\u2714'} MCP server{' '}
                  {isRemove ? 'removed from' : 'installed for'}:
                </Text>
                {resultClients.map((name, i) => (
                  <Text key={i}>
                    {' '}
                    {'\u2022'} {name}
                  </Text>
                ))}
              </>
            ) : (
              <Text dimColor>
                {isRemove ? 'Removal' : 'Installation'} skipped.
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

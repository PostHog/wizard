/**
 * McpScreen — MCP server installation flow.
 * Self-contained: detects supported clients, lets user pick, then installs.
 * Calls lower-level MCP functions directly — no store-driven prompts.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput, PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';

interface McpScreenProps {
  store: WizardStore;
}

interface DetectedClient {
  name: string;
  install: (region?: string) => Promise<void>;
}

type Phase = 'detecting' | 'ask' | 'pick' | 'installing' | 'done' | 'none';

export const McpScreen = ({ store }: McpScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>('detecting');
  const [clients, setClients] = useState<DetectedClient[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);

  // Detect supported clients on mount
  useEffect(() => {
    void (async () => {
      try {
        const { getSupportedClients } = await import(
          '../../../steps/add-mcp-server-to-clients/index.js'
        );
        const supported = await getSupportedClients();
        if (supported.length === 0) {
          setPhase('none');
        } else {
          const { ALL_FEATURE_VALUES } = await import(
            '../../../steps/add-mcp-server-to-clients/defaults.js'
          );
          const features = [...ALL_FEATURE_VALUES];
          setClients(
            supported.map(
              (c: {
                name: string;
                addServer: (...args: unknown[]) => Promise<void>;
              }) => ({
                name: c.name,
                install: async (region?: string) => {
                  await c.addServer(undefined, features, false, region);
                },
              }),
            ),
          );
          setPhase('ask');
        }
      } catch {
        setPhase('none');
      }
    })();
  }, []);

  const handleConfirm = () => {
    if (clients.length === 1) {
      // Only one client — install directly
      void installClients(clients);
    } else {
      setPhase('pick');
    }
  };

  const handleSkip = () => {
    store.pushScreen('outro');
  };

  const installClients = async (toInstall: DetectedClient[]) => {
    setPhase('installing');
    const names: string[] = [];
    for (const client of toInstall) {
      try {
        await client.install(store.cloudRegion ?? undefined);
        names.push(client.name);
      } catch {
        // Skip failed clients
      }
    }
    setInstalled(names);
    setPhase('done');
    setTimeout(() => store.pushScreen('outro'), 2000);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        MCP Server Setup
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === 'detecting' && (
          <Text dimColor>Detecting supported editors...</Text>
        )}

        {phase === 'none' && (
          <Text dimColor>No supported MCP clients detected. Skipping...</Text>
        )}

        {phase === 'ask' && (
          <>
            <Text dimColor>
              Detected: {clients.map((c) => c.name).join(', ')}
            </Text>
            <Box marginTop={1}>
              <ConfirmationInput
                message="Install the PostHog MCP server to your editor?"
                onConfirm={handleConfirm}
                onCancel={handleSkip}
              />
            </Box>
          </>
        )}

        {phase === 'pick' && (
          <PickerMenu
            message="Select editor to install MCP server"
            options={clients.map((c) => ({
              label: c.name,
              value: c.name,
            }))}
            mode="multi"
            onSelect={(selected) => {
              const names = Array.isArray(selected) ? selected : [selected];
              const toInstall = clients.filter((c) => names.includes(c.name));
              void installClients(toInstall);
            }}
          />
        )}

        {phase === 'installing' && (
          <Text dimColor>Installing MCP server...</Text>
        )}

        {phase === 'done' && (
          <Box flexDirection="column">
            {installed.length > 0 ? (
              <>
                <Text color="green" bold>
                  {'\u2714'} MCP server installed for:
                </Text>
                {installed.map((name, i) => (
                  <Text key={i}>
                    {' '}
                    {'\u2022'} {name}
                  </Text>
                ))}
              </>
            ) : (
              <Text dimColor>Installation skipped.</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

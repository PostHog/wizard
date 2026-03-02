/**
 * McpScreen — MCP server installation flow.
 *
 * Uses an McpInstaller service (passed via props) instead of
 * importing business logic directly. Testable, no dynamic imports.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { ConfirmationInput, PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import type { McpInstaller, McpClientInfo } from '../services/mcp-installer.js';

interface McpScreenProps {
  store: WizardStore;
  installer: McpInstaller;
}

type Phase = 'detecting' | 'ask' | 'pick' | 'installing' | 'done' | 'none';

export const McpScreen = ({ store, installer }: McpScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>('detecting');
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const detected = await installer.detectClients();
        if (detected.length === 0) {
          setPhase('none');
          setTimeout(() => store.advance(), 1500);
        } else {
          setClients(detected);
          setPhase('ask');
        }
      } catch {
        setPhase('none');
        setTimeout(() => store.advance(), 1500);
      }
    })();
  }, [installer]); // eslint-disable-line

  const handleConfirm = () => {
    if (clients.length === 1) {
      void doInstall(clients.map((c) => c.name));
    } else {
      setPhase('pick');
    }
  };

  const handleSkip = () => {
    store.advance();
  };

  const doInstall = async (names: string[]) => {
    setPhase('installing');
    try {
      const result = await installer.install(
        names,
        store.session.cloudRegion ?? undefined,
      );
      setInstalled(result);
    } catch {
      setInstalled([]);
    }
    setPhase('done');
    setTimeout(() => store.advance(), 2000);
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
              void doInstall(names);
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

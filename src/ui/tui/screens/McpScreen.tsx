/**
 * McpScreen — MCP server installation flow.
 *
 * Uses an McpInstaller service (passed via props) instead of
 * importing business logic directly. Testable, no dynamic imports.
 *
 * When done, sets session.runPhase = Done. The router resolves to outro.
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

enum Phase {
  Detecting = 'detecting',
  Ask = 'ask',
  Pick = 'pick',
  Installing = 'installing',
  Done = 'done',
  None = 'none',
}

const markDone = (store: WizardStore) => {
  store.setMcpComplete();
};

export const McpScreen = ({ store, installer }: McpScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [phase, setPhase] = useState<Phase>(Phase.Detecting);
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const detected = await installer.detectClients();
        if (detected.length === 0) {
          setPhase(Phase.None);
          setTimeout(() => markDone(store), 1500);
        } else {
          setClients(detected);
          setPhase(Phase.Ask);
        }
      } catch {
        setPhase(Phase.None);
        setTimeout(() => markDone(store), 1500);
      }
    })();
  }, [installer]); // eslint-disable-line

  const handleConfirm = () => {
    if (clients.length === 1) {
      void doInstall(clients.map((c) => c.name));
    } else {
      setPhase(Phase.Pick);
    }
  };

  const handleSkip = () => {
    markDone(store);
  };

  const doInstall = async (names: string[]) => {
    setPhase(Phase.Installing);
    try {
      const result = await installer.install(names);
      setInstalled(result);
    } catch {
      setInstalled([]);
    }
    setPhase(Phase.Done);
    setTimeout(() => markDone(store), 2000);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        MCP Server Setup
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Detecting && (
          <Text dimColor>Detecting supported editors...</Text>
        )}

        {phase === Phase.None && (
          <Text dimColor>No supported MCP clients detected. Skipping...</Text>
        )}

        {phase === Phase.Ask && (
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

        {phase === Phase.Installing && (
          <Text dimColor>Installing MCP server...</Text>
        )}

        {phase === Phase.Done && (
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

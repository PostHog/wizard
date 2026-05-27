/**
 * McpScreen — MCP server install/remove flow.
 *
 * Uses an McpInstaller service (passed via props) instead of
 * importing business logic directly. Testable, no dynamic imports.
 *
 * Supports two modes via the `mode` prop:
 *   - 'install': detect clients → confirm → [pick clients] → pick features → install
 *   - 'remove': detect installed clients → confirm → remove
 *
 * When done, calls store.setMcpComplete(). The router resolves to outro.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { type WizardStore, McpOutcome } from '@ui/tui/store';
import {
  ConfirmationInput,
  PickerMenu,
  GroupedPickerMenu,
} from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import type { McpInstaller, McpClientInfo } from '@ui/tui/services/mcp-installer';
import {
  AVAILABLE_FEATURES,
  ALL_FEATURE_VALUES,
} from '@steps/add-mcp-server-to-clients/defaults';

export type McpMode = 'install' | 'remove';

interface McpScreenProps {
  store: WizardStore;
  installer: McpInstaller;
  mode?: McpMode;
}

enum Phase {
  Detecting = 'detecting',
  Ask = 'ask',
  Pick = 'pick',
  FeatureSelect = 'feature-select',
  Working = 'working',
  Done = 'done',
  None = 'none',
}

const markDone = (
  store: WizardStore,
  outcome: McpOutcome,
  clients: string[] = [],
) => {
  store.setMcpComplete(outcome, clients);
};

export const McpScreen = ({
  store,
  installer,
  mode = 'install',
}: McpScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Keep stdin active from mount so Windows cmd.exe doesn't drop
  // the first keypress when ConfirmationInput appears after detection.
  useInput(() => undefined);

  const isRemove = mode === 'remove';

  const [phase, setPhase] = useState<Phase>(Phase.Detecting);
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [selectedClientNames, setSelectedClientNames] = useState<string[]>([]);
  const [resultClients, setResultClients] = useState<string[]>([]);
  const [pluginClients, setPluginClients] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const detected = await installer.detectClients();
        if (detected.length === 0) {
          setPhase(Phase.None);
          setTimeout(() => markDone(store, McpOutcome.NoClients), 1500);
        } else {
          setClients(detected);
          setPhase(Phase.Ask);
        }
      } catch {
        setPhase(Phase.None);
        setTimeout(() => markDone(store, McpOutcome.Failed), 1500);
      }
    })();
  }, [installer]); // eslint-disable-line

  const proceedToFeatureSelectOrInstall = (clientNames: string[]) => {
    setSelectedClientNames(clientNames);
    // Skip feature picker if CLI already specified features
    if (store.session.mcpFeatures) {
      void doInstall(clientNames, store.session.mcpFeatures);
    } else {
      setPhase(Phase.FeatureSelect);
    }
  };

  const handleConfirm = () => {
    if (isRemove) {
      void doRemove();
    } else if (clients.length === 1) {
      proceedToFeatureSelectOrInstall(clients.map((c) => c.name));
    } else {
      setPhase(Phase.Pick);
    }
  };

  const handleSkip = () => {
    markDone(store, McpOutcome.Skipped);
  };

  const doInstall = async (names: string[], features?: string[]) => {
    setPhase(Phase.Working);
    let mcpResult: string[] = [];
    let pluginResult: string[] = [];
    try {
      mcpResult = await installer.install(
        names,
        features,
        store.session.apiKey,
      );
    } catch {
      // mcpResult stays []
    }
    try {
      pluginResult = await installer.installPlugins(names);
    } catch {
      // best-effort — plugin failure does not affect MCP outcome
    }
    setResultClients(mcpResult);
    setPluginClients(pluginResult);
    setPhase(Phase.Done);
    const outcome =
      mcpResult.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    setTimeout(() => markDone(store, outcome, mcpResult), 2000);
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
    setTimeout(() => markDone(store, outcome, result), 2000);
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
                message={`${
                  isRemove ? 'Remove' : 'Install'
                } the PostHog MCP server${
                  clients.some((c) => c.supportsPlugin) ? ' and plugin' : ''
                }?`}
                confirmLabel={isRemove ? 'Remove' : 'Install'}
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
              proceedToFeatureSelectOrInstall(names);
            }}
          />
        )}

        {phase === Phase.FeatureSelect && (
          <GroupedPickerMenu
            message="Select features to enable"
            groups={AVAILABLE_FEATURES}
            initialSelected={[...ALL_FEATURE_VALUES]}
            onSelect={(features) => {
              void doInstall(selectedClientNames, features);
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
                  {'\u2714'} MCP server
                  {!isRemove && pluginClients.length > 0 ? ' and plugin' : ''}{' '}
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

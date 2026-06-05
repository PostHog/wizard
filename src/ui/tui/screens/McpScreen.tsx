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
import type {
  McpInstaller,
  McpClientInfo,
} from '@ui/tui/services/mcp-installer';
import {
  AVAILABLE_FEATURES,
  ALL_FEATURE_VALUES,
  isAllFeaturesSelected,
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
  featuresSelected?: 'all' | string[],
) => {
  store.setMcpComplete(outcome, clients, featuresSelected);
};

const reportFeatures = (features: string[]): 'all' | string[] =>
  isAllFeaturesSelected(features) ? 'all' : features;

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
  const [installMode, setInstallMode] = useState<'all' | 'custom'>('custom');

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

  const proceedAfterClientPick = (
    clientNames: string[],
    chosenMode: 'all' | 'custom',
  ) => {
    setSelectedClientNames(clientNames);
    if (chosenMode === 'all') {
      void doInstall(clientNames, [...ALL_FEATURE_VALUES]);
    } else if (store.session.mcpFeatures) {
      void doInstall(clientNames, store.session.mcpFeatures);
      return;
    }
    // Skip the feature picker when no selected client consumes features —
    // browser connectors (e.g. Claude Desktop/Web) configure features online,
    // not through CLI-written config.
    const anyNeedsFeatures = clientNames.some((name) => {
      const info = clients.find((c) => c.name === name);
      return !info?.finish;
    });
    if (!anyNeedsFeatures) {
      void doInstall(clientNames, []);
      return;
    }
    setPhase(Phase.FeatureSelect);
  };

  const handleConfirm = () => {
    if (isRemove) {
      void doRemove();
    } else if (clients.length === 1) {
      proceedAfterClientPick([clients[0]!.name], 'custom');
    } else {
      setPhase(Phase.Pick);
    }
  };

  const handleTriStateChoice = (choice: 'all' | 'custom' | 'skip') => {
    if (choice === 'skip') {
      handleSkip();
      return;
    }
    setInstallMode(choice);
    if (clients.length === 1) {
      proceedAfterClientPick([clients[0]!.name], choice);
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

    const pluginCapableSet = new Set(
      clients.filter((c) => c.supportsPlugin).map((c) => c.name),
    );
    const pluginCapableNames = names.filter((n) => pluginCapableSet.has(n));
    const directNames = names.filter((n) => !pluginCapableSet.has(n));

    if (installMode === 'all') {
      // Plugin-capable clients get the plugin (which bundles MCP).
      // Non-plugin-capable clients get a direct MCP config write.
      try {
        mcpResult = await installer.install(
          directNames,
          features,
          store.session.apiKey,
        );
      } catch {
        // mcpResult stays []
      }
      try {
        pluginResult = await installer.installPlugins(pluginCapableNames);
      } catch {
        // best-effort
      }
    } else {
      // 'custom' — MCP-only for every selected client. Plugin install is
      // skipped so the user's feature selection is actually respected.
      try {
        mcpResult = await installer.install(
          names,
          features,
          store.session.apiKey,
        );
      } catch {
        // mcpResult stays []
      }
    }

    setResultClients(mcpResult);
    setPluginClients(pluginResult);
    setPhase(Phase.Done);
    const succeeded = mcpResult.length + pluginResult.length > 0;
    const outcome = succeeded ? McpOutcome.Installed : McpOutcome.Failed;
    const featuresReport = reportFeatures(features ?? [...ALL_FEATURE_VALUES]);
    setTimeout(
      () =>
        markDone(
          store,
          outcome,
          [...mcpResult, ...pluginResult],
          featuresReport,
        ),
      2000,
    );
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

  // The "what you get" preview shown above the install confirmation —
  // installed users have no idea what "MCP" means; lead with the value.
  const installValueBullets = [
    'Ask your agent: "List my feature flags" — and it does.',
    'Run SQL, build dashboards, ship flags, all from your IDE.',
    'No copy-pasting tokens or context. Your agent has the keys.',
  ];

  // Clients connected via a browser page (e.g. Claude Desktop/Web) aren't truly
  // "installed" — the user finishes in the browser. Split them out of the
  // "installed for" list and render the finish instructions separately.
  const finishNotes = clients.flatMap((c) =>
    c.finish && resultClients.includes(c.name)
      ? [{ name: c.name, url: c.finish.url, instruction: c.finish.instruction }]
      : [],
  );
  const installedNow = resultClients.filter(
    (name) => !finishNotes.some((n) => n.name === name),
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        {isRemove
          ? 'Remove the PostHog MCP'
          : 'Install the MCP so you can chat to your data'}
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
            {!isRemove && (
              <Box flexDirection="column" marginBottom={1}>
                {installValueBullets.map((bullet) => (
                  <Text key={bullet} dimColor>
                    {'•'} {bullet}
                  </Text>
                ))}
              </Box>
            )}
            <Text dimColor>
              Detected: {clients.map((c) => c.name).join(', ')}
            </Text>
            <Box marginTop={1}>
              {!isRemove && !store.session.mcpFeatures ? (
                <PickerMenu
                  message={`Install the PostHog MCP server${
                    clients.some((c) => c.supportsPlugin) ? ' and plugin' : ''
                  }?`}
                  options={[
                    {
                      label: 'Install with all features',
                      value: 'all',
                      hint: 'recommended',
                    },
                    {
                      label: 'Customize features',
                      value: 'custom',
                      hint: 'MCP only',
                    },
                    { label: 'No thanks', value: 'skip' },
                  ]}
                  mode="single"
                  onSelect={(choice) =>
                    handleTriStateChoice(choice as 'all' | 'custom' | 'skip')
                  }
                />
              ) : (
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
              )}
            </Box>
          </>
        )}

        {phase === Phase.Pick && (
          <PickerMenu
            message={
              installMode === 'all'
                ? 'Select editor to install'
                : 'Select editor to install MCP server'
            }
            options={clients.map((c) => ({
              label: c.name,
              value: c.name,
              hint:
                installMode === 'all'
                  ? c.supportsPlugin
                    ? 'plugin'
                    : 'MCP'
                  : undefined,
            }))}
            mode="multi"
            onSelect={(selected) => {
              const names = Array.isArray(selected) ? selected : [selected];
              proceedAfterClientPick(names, installMode);
            }}
          />
        )}

        {phase === Phase.FeatureSelect && (
          <GroupedPickerMenu
            message="Select features to enable"
            groups={AVAILABLE_FEATURES}
            initialSelected={[]}
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
            {installedNow.length + pluginClients.length + finishNotes.length ===
            0 ? (
              <Text dimColor>
                {isRemove ? 'Removal' : 'Installation'} skipped.
              </Text>
            ) : (
              <>
                {pluginClients.length > 0 && (
                  <>
                    <Text color="green" bold>
                      {'\u2714'} Plugin installed for:
                    </Text>
                    {pluginClients.map((name, i) => (
                      <Text key={`p-${i}`}>
                        {' '}
                        {'\u2022'} {name}
                      </Text>
                    ))}
                  </>
                )}
                {installedNow.length > 0 && (
                  <>
                    <Text color="green" bold>
                      {'\u2714'} MCP server{' '}
                      {isRemove ? 'removed from' : 'installed for'}:
                    </Text>
                    {installedNow.map((name, i) => (
                      <Text key={`m-${i}`}>
                        {' '}
                        {'\u2022'} {name}
                      </Text>
                    ))}
                  </>
                )}
                {finishNotes.map((note) => (
                  <Box key={note.name} flexDirection="column" marginTop={1}>
                    <Text color="green" bold>
                      {note.name} \u2014 finish in your browser:
                    </Text>
                    <Text>
                      {'  '}Opened <Text color="cyan">{note.url}</Text>
                    </Text>
                    <Text dimColor>
                      {'  '}
                      {note.instruction}
                    </Text>
                    <Text dimColor>
                      {'  '}(If it didn&apos;t open, paste the URL above.)
                    </Text>
                  </Box>
                ))}
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

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
import { Colors, Icons } from '@ui/tui/styles';
import type {
  McpInstaller,
  McpClientInfo,
  McpClientResult,
} from '@ui/tui/services/mcp-installer';
import {
  McpClientStatus,
  namesWithStatus,
  isOk,
  summarizeFailure,
} from '@steps/add-mcp-server-to-clients/results';
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
  Connector = 'connector',
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

const errorText = (err: unknown): string =>
  summarizeFailure(err instanceof Error ? err.message : String(err)) ??
  'unknown error';

/**
 * One "✔ <title>" / "✖ <title>" block with a bullet per client, plus an optional
 * dim explanation underneath. Rendered only when it has something to say.
 */
const ResultGroup = ({
  title,
  items,
  color,
  icon,
  note,
}: {
  title: string;
  items: string[];
  color: string;
  icon: string;
  note?: string;
}) => {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text color={color} bold>
        {icon} {title}
      </Text>
      {items.map((item, i) => (
        <Text key={`${title}-${i}`}>
          {' '}
          {'•'} {item}
        </Text>
      ))}
      {note && <Text dimColor> {note}</Text>}
    </Box>
  );
};

/**
 * Connector step prompt — Enter continues (opens the connector page). There's
 * no skip: picking the connector commits to opening it.
 */
const ConnectorContinue = ({ onContinue }: { onContinue: () => void }) => {
  useInput((_input, key) => {
    if (key.return) {
      onContinue();
    }
  });
  return (
    <Text color={Colors.primary}>
      Press enter to continue {Icons.triangleRight}
    </Text>
  );
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
  const [mcpResults, setMcpResults] = useState<McpClientResult[]>([]);
  const [pluginResults, setPluginResults] = useState<McpClientResult[]>([]);
  const [installMode, setInstallMode] = useState<'all' | 'custom'>('custom');
  // Detection and the install/remove call can both blow up. Keep the reason so
  // a crash reads as a crash instead of as "you have nothing installed" or
  // "you selected nothing".
  const [detectError, setDetectError] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

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
      } catch (err) {
        setDetectError(errorText(err));
        setPhase(Phase.None);
        setTimeout(() => markDone(store, McpOutcome.Failed), 3000);
      }
    })();
  }, [installer]); // eslint-disable-line

  const proceedAfterClientPick = (
    clientNames: string[],
    chosenMode: 'all' | 'custom',
  ) => {
    setSelectedClientNames(clientNames);

    // Recommended flow: install everything straight away. Browser connectors
    // (e.g. Claude Desktop/Web) just open their connector page here, same as
    // before — no extra screen.
    if (chosenMode === 'all') {
      void doInstall(clientNames, [...ALL_FEATURE_VALUES], chosenMode);
      return;
    }
    if (store.session.mcpFeatures) {
      void doInstall(clientNames, store.session.mcpFeatures, chosenMode);
      return;
    }

    // Customize flow: a browser connector configures its tools and features in
    // Claude's UI, not through the wizard's feature picker. The picker keeps it
    // mutually exclusive from local editors, so a connector selection is
    // connector-only — show its own screen instead of the feature picker.
    const isConnector = clientNames.some(
      (name) => clients.find((c) => c.name === name)?.finish,
    );
    if (isConnector) {
      setPhase(Phase.Connector);
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

  /**
   * `chosenMode` is passed in rather than read from `installMode`: the tri-state
   * picker sets that state and installs in the same tick when a single client
   * is detected, so the closure would still hold the previous value and a
   * one-editor machine would silently get the MCP-only path.
   */
  const doInstall = async (
    names: string[],
    features?: string[],
    chosenMode: 'all' | 'custom' = installMode,
  ) => {
    setPhase(Phase.Working);
    let mcpResult: McpClientResult[] = [];
    let pluginResult: McpClientResult[] = [];

    const pluginCapableSet = new Set(
      clients.filter((c) => c.supportsPlugin).map((c) => c.name),
    );
    const pluginCapableNames = names.filter((n) => pluginCapableSet.has(n));
    const directNames = names.filter((n) => !pluginCapableSet.has(n));

    if (chosenMode === 'all') {
      // Plugin-capable clients get the plugin (which bundles MCP).
      // Non-plugin-capable clients get a direct MCP config write.
      try {
        mcpResult = await installer.install(
          directNames,
          features,
          store.session.apiKey,
        );
      } catch (err) {
        setFlowError(errorText(err));
      }
      try {
        pluginResult = await installer.installPlugins(pluginCapableNames);
      } catch (err) {
        // Best-effort, but still say so rather than showing an empty screen.
        setFlowError(errorText(err));
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
      } catch (err) {
        setFlowError(errorText(err));
      }
    }

    setMcpResults(mcpResult);
    setPluginResults(pluginResult);
    setPhase(Phase.Done);
    // Already-installed counts as installed: the user ends up with a working
    // MCP either way, so the follow-on steps (Slack, tutorial) still apply.
    const ready = [...mcpResult, ...pluginResult].filter(isOk);
    const outcome =
      ready.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    const featuresReport = reportFeatures(features ?? [...ALL_FEATURE_VALUES]);
    setTimeout(
      () =>
        markDone(
          store,
          outcome,
          ready.map((r) => r.name),
          featuresReport,
        ),
      2000,
    );
  };

  const doRemove = async () => {
    setPhase(Phase.Working);
    let result: McpClientResult[] = [];
    try {
      result = await installer.remove(store.session.localMcp);
    } catch (err) {
      setFlowError(errorText(err));
    }
    setMcpResults(result);
    setPhase(Phase.Done);
    const removed = result.filter(isOk);
    const outcome =
      removed.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    setTimeout(
      () =>
        markDone(
          store,
          outcome,
          removed.map((r) => r.name),
        ),
      2000,
    );
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
  const okMcpNames = mcpResults.filter(isOk).map((r) => r.name);
  const finishNotes = clients.flatMap((c) =>
    c.finish && okMcpNames.includes(c.name)
      ? [{ name: c.name, url: c.finish.url, instruction: c.finish.instruction }]
      : [],
  );
  const isConnectorName = (name: string) =>
    finishNotes.some((n) => n.name === name);

  const installedNow = namesWithStatus(
    mcpResults,
    McpClientStatus.Changed,
  ).filter((name) => !isConnectorName(name));
  const alreadyInstalled = namesWithStatus(
    mcpResults,
    McpClientStatus.Unchanged,
  ).filter((name) => !isConnectorName(name));
  const pluginInstalled = namesWithStatus(
    pluginResults,
    McpClientStatus.Changed,
  );
  const pluginAlreadyInstalled = namesWithStatus(
    pluginResults,
    McpClientStatus.Unchanged,
  );
  // A failure the user can act on — the name alone says nothing, so carry the
  // reason the underlying CLI or file write gave us.
  const failures = [...mcpResults, ...pluginResults]
    .filter((r) => r.status === McpClientStatus.Failed)
    .map((r) => (r.detail ? `${r.name} — ${r.detail}` : r.name));

  const hasAnyResult =
    installedNow.length +
      alreadyInstalled.length +
      pluginInstalled.length +
      pluginAlreadyInstalled.length +
      failures.length +
      finishNotes.length >
    0;

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

        {phase === Phase.None &&
          (detectError ? (
            <Box flexDirection="column">
              <Text color="red" bold>
                {'\u2716'} Couldn&apos;t check which editors are installed
              </Text>
              <Text dimColor> {detectError}</Text>
              <Text dimColor>
                {' '}
                Run with --debug for the full output, or report it at
                github.com/PostHog/wizard/issues.
              </Text>
            </Box>
          ) : (
            <Text dimColor>
              No {isRemove ? 'installed' : 'supported'} MCP clients detected.
              Skipping...
            </Text>
          ))}

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
              // Browser connectors can't be installed alongside local editors
              // and are configured on their own screen, not the feature picker.
              exclusive: Boolean(c.finish),
              // Hints only show in the recommended flow; the customize flow
              // keeps the list clean.
              hint:
                installMode === 'all'
                  ? c.finish
                    ? 'connector'
                    : c.supportsPlugin
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
            message="Select the PostHog areas your agent can reach"
            groups={AVAILABLE_FEATURES}
            initialSelected={[]}
            onSelect={(features) => {
              void doInstall(selectedClientNames, features);
            }}
          />
        )}

        {phase === Phase.Connector && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>
                You&apos;ll choose which PostHog areas to enable in
                Claude&apos;s UI after connecting.
              </Text>
            </Box>
            <ConnectorContinue
              onContinue={() => void doInstall(selectedClientNames, [])}
            />
          </Box>
        )}

        {phase === Phase.Working && (
          <Text dimColor>
            {isRemove ? 'Removing' : 'Installing'} MCP server...
          </Text>
        )}

        {phase === Phase.Done && (
          <Box flexDirection="column">
            {!hasAnyResult ? (
              flowError ? (
                <Box flexDirection="column">
                  <Text color="red" bold>
                    {'\u2716'} {isRemove ? 'Removal' : 'Installation'} failed
                  </Text>
                  <Text dimColor> {flowError}</Text>
                  <Text dimColor>
                    {' '}
                    Run with --debug for the full output, or report it at
                    github.com/PostHog/wizard/issues.
                  </Text>
                </Box>
              ) : (
                <Text dimColor>
                  {isRemove
                    ? "Nothing to remove \u2014 the PostHog MCP server wasn't configured for any editor."
                    : 'Nothing to install \u2014 no editor was selected.'}
                </Text>
              )
            ) : (
              <>
                <ResultGroup
                  title="Plugin installed for:"
                  items={pluginInstalled}
                  color="green"
                  icon={'\u2714'}
                />
                <ResultGroup
                  title="Plugin was already installed for:"
                  items={pluginAlreadyInstalled}
                  color="green"
                  icon={'\u2714'}
                  note="It was already set up, so nothing changed. You are good to go."
                />
                <ResultGroup
                  title={`MCP server ${
                    isRemove ? 'removed from' : 'installed for'
                  }:`}
                  items={installedNow}
                  color="green"
                  icon={'\u2714'}
                />
                <ResultGroup
                  title={
                    isRemove
                      ? 'No PostHog entry left to remove for:'
                      : 'MCP server was already installed for:'
                  }
                  items={alreadyInstalled}
                  color="green"
                  icon={'\u2714'}
                  note={
                    isRemove
                      ? 'It was already gone, so nothing was changed.'
                      : 'Left as-is. To change which PostHog areas it can reach, run `wizard mcp remove` first, then `wizard mcp add`.'
                  }
                />
                <ResultGroup
                  title={`Couldn't ${isRemove ? 'remove from' : 'install for'}:`}
                  items={failures}
                  color="red"
                  icon={'\u2716'}
                  note="Run with --debug for the full output, or report it at github.com/PostHog/wizard/issues."
                />
                {finishNotes.map((note) => (
                  <Box key={note.name} flexDirection="column" marginTop={1}>
                    <Text color="green" bold>
                      {'\u2714'} {note.name} {'\u2014'} installs a PostHog
                      connector:
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

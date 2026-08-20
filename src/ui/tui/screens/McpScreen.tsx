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
import { useState, useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { type WizardStore, McpOutcome } from '@ui/tui/store';
import { ConfirmationInput, PickerMenu } from '@ui/tui/primitives/index';
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
  loginCommands: string[] = [],
) => {
  store.setMcpComplete(outcome, clients, featuresSelected, loginCommands);
};

/**
 * The editor-owned login commands still to run after this install: fresh
 * config entries use the client's own server name, plugin-provided servers
 * their `plugin:` name. One entry per client — a client that just got a direct
 * entry doesn't also list its plugin command.
 */
const pendingLoginCommands = (
  clients: McpClientInfo[],
  mcpResult: McpClientResult[],
  pluginResult: McpClientResult[],
): Array<{ name: string; command: string }> => {
  const commands = new Map<string, string>();
  for (const r of pluginResult) {
    const command = clients.find((c) => c.name === r.name)?.pluginLoginCommand;
    if (isOk(r) && command) commands.set(r.name, command);
  }
  for (const r of mcpResult) {
    const command = clients.find((c) => c.name === r.name)?.loginCommand;
    if (r.status === McpClientStatus.Changed && command)
      commands.set(r.name, command);
  }
  return [...commands.entries()].map(([name, command]) => ({ name, command }));
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
    <Box flexDirection="column" marginBottom={1}>
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

/**
 * Done-phase prompt — Enter dismisses the results screen and moves the flow on.
 * Explicit acknowledgement instead of a timeout: the previous 2s auto-dismiss
 * whipped past too fast to read on a normal install, especially when several
 * result groups were stacked.
 */
const DoneContinue = ({ onContinue }: { onContinue: () => void }) => {
  useInput((_input, key) => {
    if (key.return) {
      onContinue();
    }
  });
  return (
    <Box marginTop={1}>
      <Text color={Colors.primary}>
        Press enter to continue {Icons.triangleRight}
      </Text>
    </Box>
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
  // Detection and the install/remove call can both blow up. Keep the reason so
  // a crash reads as a crash instead of as "you have nothing installed" or
  // "you selected nothing".
  const [detectError, setDetectError] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  // The action that finishes the screen once the user has read the results.
  // Held in a ref so the useInput handler inside DoneContinue can invoke the
  // freshest closure without re-registering listeners on every render.
  const finishFlow = useRef<null | (() => void)>(null);

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
        // Long error text — wait for enter instead of a 3s auto-dismiss the
        // user can't finish reading.
        finishFlow.current = () => markDone(store, McpOutcome.Failed);
        setPhase(Phase.None);
      }
    })();
  }, [installer]); // eslint-disable-line

  const proceedAfterClientPick = (clientNames: string[]) => {
    setSelectedClientNames(clientNames);

    // Browser connectors just open their connector page — no extra screen.
    // Which PostHog areas the agent can reach is decided at the OAuth consent
    // screen, not in the wizard, so there is nothing else to ask here.
    const isConnector = clientNames.some(
      (name) => clients.find((c) => c.name === name)?.finish,
    );
    if (isConnector) {
      setPhase(Phase.Connector);
      return;
    }
    void doInstall(
      clientNames,
      store.session.mcpFeatures ?? [...ALL_FEATURE_VALUES],
    );
  };

  const handleConfirm = () => {
    if (isRemove) {
      void doRemove();
    } else if (clients.length === 1) {
      proceedAfterClientPick([clients[0]!.name]);
    } else {
      setPhase(Phase.Pick);
    }
  };

  const handleSkip = () => {
    markDone(store, McpOutcome.Skipped);
  };

  const doInstall = async (names: string[], features?: string[]) => {
    setPhase(Phase.Working);
    let mcpResult: McpClientResult[] = [];
    let pluginResult: McpClientResult[] = [];

    const pluginCapableSet = new Set(
      clients.filter((c) => c.supportsPlugin).map((c) => c.name),
    );
    const pluginCapableNames = names.filter((n) => pluginCapableSet.has(n));
    const directNames = names.filter((n) => !pluginCapableSet.has(n));

    // Plugin-capable clients get the plugin (which bundles MCP); the rest get
    // a direct MCP config write. A `--features` flag narrows the toolset, so
    // those runs write a direct entry everywhere instead of the plugin.
    const narrowed = Boolean(store.session.mcpFeatures);
    try {
      mcpResult = await installer.install(
        narrowed ? names : directNames,
        features,
      );
    } catch (err) {
      setFlowError(errorText(err));
    }
    if (!narrowed) {
      try {
        pluginResult = await installer.installPlugins(pluginCapableNames);
      } catch (err) {
        // Best-effort, but still say so rather than showing an empty screen.
        setFlowError(errorText(err));
      }
    }

    setMcpResults(mcpResult);
    setPluginResults(pluginResult);
    // Already-installed counts as installed: the user ends up with a working
    // MCP either way, so the follow-on steps (Slack, tutorial) still apply.
    const ready = [...mcpResult, ...pluginResult].filter(isOk);
    const outcome = ready.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    const featuresReport = reportFeatures(features ?? [...ALL_FEATURE_VALUES]);
    const logins = pendingLoginCommands(clients, mcpResult, pluginResult);
    finishFlow.current = () =>
      markDone(
        store,
        outcome,
        ready.map((r) => r.name),
        featuresReport,
        logins.map((l) => l.command),
      );
    setPhase(Phase.Done);
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
    const removed = result.filter(isOk);
    const outcome =
      removed.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    finishFlow.current = () =>
      markDone(
        store,
        outcome,
        removed.map((r) => r.name),
      );
    setPhase(Phase.Done);
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
              <DoneContinue onContinue={() => finishFlow.current?.()} />
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
            message="Select editor to install"
            options={clients.map((c) => ({
              label: c.name,
              value: c.name,
              // Browser connectors can't be installed alongside local editors
              // and are configured on their own screen.
              exclusive: Boolean(c.finish),
              hint: c.finish
                ? 'connector'
                : c.supportsPlugin
                ? 'plugin'
                : 'MCP',
            }))}
            mode="multi"
            onSelect={(selected) => {
              const names = Array.isArray(selected) ? selected : [selected];
              proceedAfterClientPick(names);
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
            {hasAnyResult ? (
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
                  note="It was already set up, so nothing changed. The plugin bundles the PostHog MCP server."
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
                      : 'It already matched this exact setup, so nothing changed — including any login your editor already holds.'
                  }
                />
                <ResultGroup
                  title={`Couldn't ${
                    isRemove ? 'remove from' : 'install for'
                  }:`}
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
            ) : flowError ? (
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
            )}
            <DoneContinue onContinue={() => finishFlow.current?.()} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

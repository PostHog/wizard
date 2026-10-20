/**
 * McpScreen — MCP server install/remove flow.
 *
 * Uses an McpInstaller service (passed via props) instead of
 * importing business logic directly. Testable, no dynamic imports.
 *
 * Supports two modes via the `mode` prop:
 *   - 'install': detect clients → install in every local client (esc skips the rest) → results
 *     → open the connector page of each account client the user picks
 *   - 'remove': detect installed clients → confirm → remove
 *
 * A successful install ends on one screen: a row per client, any login
 * commands, sample prompts and the tutorial command. When done, calls
 * store.setMcpComplete().
 */

import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { useState, useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@tui/store';
import { McpOutcome } from '@shared/run-state';
import { ConfirmationInput, PickerMenu } from '@tui/primitives/index';
import { Colors, Icons } from '@tui/styles';
import { useKeyBindings, KeyMatch } from '@tui/hooks/useKeyBindings';
import { analytics } from '@utils/analytics';
import type {
  McpInstaller,
  McpClientInfo,
  McpClientResult,
} from '@tui/services/mcp-installer';
import {
  McpClientStatus,
  namesWithStatus,
  isOk,
  summarizeFailure,
} from '@shared/mcp-clients/results';
import {
  ALL_FEATURE_VALUES,
  isAllFeaturesSelected,
} from '@shared/mcp-clients/defaults';

export type McpMode = 'install' | 'remove';

interface McpScreenProps {
  store: WizardStore;
  installer: McpInstaller;
  mode?: McpMode;
  /** Prompts to suggest once installed; the MCP tool passes its role-tuned kit. */
  samplePrompts?: string[];
  /** The last menu item, which leaves the screen. `mcp add` says Exit. */
  exitLabel?: string;
}

enum Phase {
  Detecting = 'detecting',
  Ask = 'ask',
  Working = 'working',
  Done = 'done',
  Assistants = 'assistants',
  None = 'none',
}

/** The results menu's leave option; never a client name. */
const CONTINUE = '\u0000continue';

/** Where a client's install has got to. `done` rows read their result. */
enum RowState {
  Waiting = 'waiting',
  Installing = 'installing',
  Done = 'done',
  Skipped = 'skipped',
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

/** Report the outcome as the results show, and complete the step on Enter. */
const doneOnEnter = (
  store: WizardStore,
  outcome: McpOutcome,
  clients: string[] = [],
  featuresSelected?: 'all' | string[],
  loginCommands: string[] = [],
): (() => void) => {
  store.reportMcpOutcome(outcome, clients, featuresSelected);
  return () =>
    markDone(store, outcome, clients, featuresSelected, loginCommands);
};

/**
 * The editor-owned login commands still to run after this install: fresh
 * config entries use the client's own server name, plugin-provided servers
 * their `plugin:` name. One entry per client.
 */
const pendingLoginCommands = (
  clients: McpClientInfo[],
  mcpResult: McpClientResult[],
  pluginResult: McpClientResult[],
): string[] => {
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
  return [...commands.values()];
};

const reportFeatures = (features: string[]): 'all' | string[] =>
  isAllFeaturesSelected(features) ? 'all' : features;

const errorText = (err: unknown): string =>
  summarizeFailure(err instanceof Error ? err.message : String(err)) ??
  'unknown error';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

/** How one client row reads: its icon, status label and color. */
const rowDisplay = (
  state: RowState,
  results: McpClientResult[],
): { icon: string; label: string; color?: string; detail?: string } => {
  if (state === RowState.Waiting) return { icon: '·', label: 'Waiting' };
  if (state === RowState.Skipped) return { icon: '–', label: 'Skipped' };
  if (state === RowState.Installing)
    return { icon: '›', label: 'Installing…', color: Colors.accent };
  const failed = results.filter((r) => r.status === McpClientStatus.Failed);
  if (results.length === 0 || failed.length === results.length)
    return {
      icon: '✖',
      label: "Couldn't install",
      color: 'red',
      detail: failed[0]?.detail,
    };
  if (failed.length > 0)
    return {
      icon: '✖',
      label: 'Partly installed',
      color: 'red',
      detail: failed[0]?.detail,
    };
  const changed = results.some((r) => r.status === McpClientStatus.Changed);
  return {
    icon: '✔',
    label: changed ? 'Installed' : 'Already installed',
    color: 'green',
  };
};

/** One row per client: name, what it gets, and how its install went. */
const ClientRows = ({
  clients,
  rows,
  results,
  pluginNames,
}: {
  clients: McpClientInfo[];
  rows: Record<string, RowState>;
  results: McpClientResult[];
  pluginNames: string[];
}) => {
  const nameWidth = Math.max(...clients.map((c) => c.name.length)) + 3;
  const viaWidth = 16;
  return (
    <Box flexDirection="column">
      {clients.map((c) => {
        const row = rowDisplay(
          rows[c.name] ?? RowState.Waiting,
          results.filter((r) => r.name === c.name),
        );
        const via = pluginNames.includes(c.name) ? 'plugin + MCP' : 'MCP';
        return (
          <Box key={c.name} flexDirection="column">
            <Text>
              {'  '}
              <Text color={row.color} dimColor={!row.color}>
                {row.icon}
              </Text>{' '}
              {c.name.padEnd(nameWidth)}
              <Text dimColor>{via.padEnd(viaWidth)}</Text>
              <Text color={row.color} dimColor={!row.color}>
                {row.label}
              </Text>
            </Text>
            {row.detail && (
              <Text dimColor>
                {' '.repeat(4 + nameWidth + viaWidth)}
                {row.detail}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Done-phase prompt — Enter dismisses the results screen and moves the flow on.
 * Explicit acknowledgement instead of a timeout: the previous 2s auto-dismiss
 * whipped past too fast to read on a normal install, especially when several
 * result groups were stacked.
 */
const DoneContinue = ({
  onContinue,
  label = 'Continue',
}: {
  onContinue: () => void;
  label?: string;
}) => {
  useInput((_input, key) => {
    if (key.return) {
      onContinue();
    }
  });
  return (
    <Box marginTop={1}>
      <Text color={Colors.primary}>
        Press enter to {label.toLowerCase()} {Icons.triangleRight}
      </Text>
    </Box>
  );
};

export const McpScreen = ({
  store,
  installer,
  mode = 'install',
  samplePrompts = [],
  exitLabel = 'Continue',
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
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [mcpResults, setMcpResults] = useState<McpClientResult[]>([]);
  const [pluginResults, setPluginResults] = useState<McpClientResult[]>([]);
  // Detection and the remove call can both blow up. Keep the reason so a crash
  // reads as a crash instead of as "you have nothing installed".
  const [detectError, setDetectError] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [loginCommands, setLoginCommands] = useState<string[]>([]);
  // Esc during the install stops before the next client starts.
  const skipRest = useRef(false);
  // The action that finishes the screen once the user has read the results.
  // Held in a ref so the useInput handler inside DoneContinue can invoke the
  // freshest closure without re-registering listeners on every render.
  const finishFlow = useRef<null | (() => void)>(null);
  // What Step 1 installed, so leaving Step 2 completes the step with both.
  const stepOne = useRef<{
    outcome: McpOutcome;
    ready: string[];
    features: 'all' | string[];
    logins: string[];
  } | null>(null);
  const [opened, setOpened] = useState<McpClientResult[]>([]);

  // An api-key install bakes the key into the client config — no OAuth ever
  // runs, so those flows never get a login command. OAuth flows ask nothing:
  // access is chosen on the OAuth consent screen.
  const oauthFlow = !store.session.apiKey;

  const localClients = clients.filter((c) => c.kind === 'local');
  const accountClients = clients.filter((c) => c.kind === 'account');
  const twoSteps = localClients.length > 0 && accountClients.length > 0;
  // OAuth: plugin-capable clients get the plugin. Api-key installs write
  // key-authed direct entries only — the plugin's server never carries the key.
  const pluginNames = oauthFlow
    ? localClients.filter((c) => c.supportsPlugin).map((c) => c.name)
    : [];

  useEffect(() => {
    void (async () => {
      try {
        const detected = await installer.detectClients();
        const local = detected.filter((c) => c.kind === 'local');
        if (detected.length === 0) {
          setPhase(Phase.None);
          setTimeout(() => markDone(store, McpOutcome.NoClients), 1500);
        } else if (isRemove) {
          setClients(detected);
          setPhase(Phase.Ask);
        } else if (local.length === 0) {
          setClients(detected);
          setPhase(Phase.Assistants);
        } else {
          setClients(detected);
          void installAll(local);
        }
      } catch (err) {
        setDetectError(errorText(err));
        // Long error text — wait for enter instead of a 3s auto-dismiss the
        // user can't finish reading.
        finishFlow.current = doneOnEnter(store, McpOutcome.Failed);
        setPhase(Phase.None);
      }
    })();
  }, [installer]); // eslint-disable-line

  useKeyBindings(
    'mcp-skip',
    phase === Phase.Working && !isRemove
      ? [
          {
            match: KeyMatch.Escape,
            label: 'esc',
            action: 'skip the rest',
            handler: () => {
              skipRest.current = true;
            },
          },
        ]
      : [],
  );

  const setRow = (name: string, state: RowState) =>
    setRows((prev) => ({ ...prev, [name]: state }));

  const installDirect = async (
    name: string,
    features: string[],
  ): Promise<McpClientResult[]> => {
    try {
      return await installer.install([name], features, store.session.apiKey);
    } catch (err) {
      return [{ name, status: McpClientStatus.Failed, detail: errorText(err) }];
    }
  };

  const installPluginsFor = async (
    names: string[],
  ): Promise<McpClientResult[]> => {
    try {
      return await installer.installPlugins(names);
    } catch (err) {
      return names.map((name) => ({
        name,
        status: McpClientStatus.Failed,
        detail: errorText(err),
      }));
    }
  };

  // A direct entry for everyone whose plugin doesn't already ship the MCP
  // server (codex's plugin is skills-only; claude's bundles the server).
  const needsDirect = (client: McpClientInfo) =>
    !oauthFlow || !client.pluginBundlesMcp;

  /** Show the results and arm Enter with what ended up installed. */
  const settle = (
    local: McpClientInfo[],
    mcpResult: McpClientResult[],
    pluginResult: McpClientResult[],
    features: string[],
    attempted: boolean,
  ) => {
    // Already-installed counts as installed: the user ends up with a working
    // MCP either way.
    const ready = [
      ...new Set(
        [...mcpResult, ...pluginResult].filter(isOk).map((r) => r.name),
      ),
    ];
    const outcome =
      ready.length > 0
        ? McpOutcome.Installed
        : attempted
        ? McpOutcome.Failed
        : McpOutcome.Skipped;
    const logins = oauthFlow
      ? pendingLoginCommands(local, mcpResult, pluginResult)
      : [];
    setLoginCommands(logins);
    stepOne.current = {
      outcome,
      ready,
      features: reportFeatures(features),
      logins,
    };
    // Reports once per store, so a retry only updates what Enter completes.
    finishFlow.current = doneOnEnter(
      store,
      outcome,
      ready,
      reportFeatures(features),
      logins,
    );
    setPhase(Phase.Done);
  };

  const installAll = async (local: McpClientInfo[]) => {
    setRows(Object.fromEntries(local.map((c) => [c.name, RowState.Waiting])));
    setPhase(Phase.Working);

    const features = store.mcpFeatures ?? [...ALL_FEATURE_VALUES];
    const plugins = oauthFlow
      ? local.filter((c) => c.supportsPlugin).map((c) => c.name)
      : [];
    const mcpResult: McpClientResult[] = [];
    const pluginResult: McpClientResult[] = [];
    const started = new Set<string>();

    for (const client of local) {
      if (skipRest.current) break;
      if (!needsDirect(client)) continue;
      started.add(client.name);
      setRow(client.name, RowState.Installing);
      mcpResult.push(...(await installDirect(client.name, features)));
      setMcpResults([...mcpResult]);
      // A plugin client still has its plugin to come.
      setRow(
        client.name,
        plugins.includes(client.name) ? RowState.Waiting : RowState.Done,
      );
    }

    // One batch, so `mcp plugins installed` stays one event per run.
    if (plugins.length > 0 && !skipRest.current) {
      plugins.forEach((name) => {
        started.add(name);
        setRow(name, RowState.Installing);
      });
      pluginResult.push(...(await installPluginsFor(plugins)));
      setPluginResults([...pluginResult]);
    }

    setRows(
      Object.fromEntries(
        local.map((c) => [
          c.name,
          started.has(c.name) ? RowState.Done : RowState.Skipped,
        ]),
      ),
    );
    settle(local, mcpResult, pluginResult, features, started.size > 0);
  };

  const retry = async (name: string) => {
    const client = localClients.find((c) => c.name === name);
    if (!client) return;
    const features = store.mcpFeatures ?? [...ALL_FEATURE_VALUES];
    const others = (results: McpClientResult[]) =>
      results.filter((r) => r.name !== name);
    setRow(name, RowState.Installing);
    const mcpResult = needsDirect(client)
      ? [...others(mcpResults), ...(await installDirect(name, features))]
      : mcpResults;
    const pluginResult = pluginNames.includes(name)
      ? [...others(pluginResults), ...(await installPluginsFor([name]))]
      : pluginResults;
    setMcpResults(mcpResult);
    setPluginResults(pluginResult);
    setRow(name, RowState.Done);
    settle(localClients, mcpResult, pluginResult, features, true);
  };

  /** Leave Step 1: on to the AI assistants, or out when there are none. */
  const leaveStepOne = () => {
    if (accountClients.length > 0) setPhase(Phase.Assistants);
    else finishFlow.current?.();
  };

  // A second Enter can land before the list redraws; open each page once.
  const openedNames = useRef(new Set<string>());

  const openAssistant = async (name: string) => {
    if (openedNames.current.has(name)) return;
    openedNames.current.add(name);
    let result: McpClientResult[];
    try {
      result = await installer.install([name]);
    } catch (err) {
      result = [
        { name, status: McpClientStatus.Failed, detail: errorText(err) },
      ];
    }
    analytics.wizardCapture('mcp assistant opened', {
      client: name,
      opened: result.some(isOk),
    });
    setOpened((prev) => [...prev, ...result]);
  };

  /** Complete the step with Step 1's installs plus the assistants opened. */
  const leaveAssistants = () => {
    const openedNames = opened.filter(isOk).map((r) => r.name);
    const one = stepOne.current;
    if (one) {
      markDone(
        store,
        one.outcome === McpOutcome.Installed || openedNames.length === 0
          ? one.outcome
          : McpOutcome.Installed,
        [...one.ready, ...openedNames],
        one.features,
        one.logins,
      );
      return;
    }
    markDone(
      store,
      openedNames.length > 0 ? McpOutcome.Installed : McpOutcome.Skipped,
      openedNames,
    );
  };

  useKeyBindings(
    'mcp-assistants-skip',
    phase === Phase.Assistants
      ? [
          {
            match: KeyMatch.Escape,
            label: 'esc',
            action: 'skip',
            handler: leaveAssistants,
          },
        ]
      : [],
  );

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
    finishFlow.current = doneOnEnter(
      store,
      outcome,
      removed.map((r) => r.name),
    );
    setPhase(Phase.Done);
  };

  // The "what you get" preview shown while installing —
  // installed users have no idea what "MCP" means; lead with the value.
  const installValueLines = [
    'Ask your agent: "List my feature flags" — and it does.',
    'Run SQL, build dashboards, ship flags, all from your coding agent.',
  ];

  const allResults = [...mcpResults, ...pluginResults];
  const readyCount = localClients.filter((c) =>
    allResults.some((r) => r.name === c.name && isOk(r)),
  ).length;
  const installSucceeded = !isRemove && readyCount > 0;
  const failedNames = localClients
    .filter(
      (c) =>
        rows[c.name] === RowState.Done &&
        allResults.some(
          (r) => r.name === c.name && r.status === McpClientStatus.Failed,
        ),
    )
    .map((c) => c.name);
  const retrying = Object.values(rows).includes(RowState.Installing);

  const heading = isRemove
    ? 'Remove the PostHog MCP'
    : phase === Phase.Assistants
    ? 'Connect PostHog to your AI assistants'
    : phase !== Phase.Done
    ? 'Adding the PostHog MCP to your coding agents'
    : readyCount === 0
    ? "Couldn't add the PostHog MCP to your coding agents"
    : readyCount === localClients.length
    ? `The PostHog MCP is ready in ${plural(readyCount, 'coding agent')}`
    : `The PostHog MCP is ready in ${readyCount} of ${plural(
        localClients.length,
        'coding agent',
      )}`;

  const stepLabel = isRemove
    ? null
    : phase === Phase.Assistants
    ? twoSteps
      ? 'Step 2 of 2 · AI assistants'
      : 'AI assistants'
    : twoSteps
    ? 'Step 1 of 2 · Coding agents'
    : null;
  // Step 1 leaves the screen only when no AI assistant step follows.
  const stepOneExit = accountClients.length > 0 ? 'Continue' : exitLabel;
  const assistantOptions = [
    ...accountClients
      .filter((c) => !opened.some((r) => r.name === c.name))
      .map((c) => ({
        label: c.name,
        value: c.name,
        hint: 'opens in your browser',
      })),
    { label: exitLabel, value: CONTINUE },
  ];

  const removedNow = namesWithStatus(mcpResults, McpClientStatus.Changed);
  const alreadyRemoved = namesWithStatus(mcpResults, McpClientStatus.Unchanged);
  // A failure the user can act on — the name alone says nothing, so carry the
  // reason the underlying CLI or file write gave us.
  const removeFailures = mcpResults
    .filter((r) => r.status === McpClientStatus.Failed)
    .map((r) => (r.detail ? `${r.name} — ${r.detail}` : r.name));

  return (
    <Box flexDirection="column" flexGrow={1}>
      {stepLabel && <Text dimColor>{stepLabel}</Text>}
      <Text bold color={Colors.accent}>
        {heading}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Detecting && (
          <Text dimColor>
            {isRemove
              ? 'Detecting supported editors...'
              : 'Looking for coding agents...'}
          </Text>
        )}

        {phase === Phase.None &&
          (detectError ? (
            <Box flexDirection="column">
              <Text color="red" bold>
                {'✖'} Couldn&apos;t check which editors are installed
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
              {isRemove
                ? 'No installed MCP clients detected. Skipping...'
                : 'No supported coding agents detected. Skipping...'}
            </Text>
          ))}

        {phase === Phase.Ask && (
          <>
            <Text dimColor>
              Detected: {clients.map((c) => c.name).join(', ')}
            </Text>
            <Box marginTop={1}>
              <ConfirmationInput
                message={`Remove the PostHog MCP server${
                  clients.some((c) => c.supportsPlugin) ? ' and plugin' : ''
                }?`}
                confirmLabel="Remove"
                cancelLabel="No thanks"
                onConfirm={() => void doRemove()}
                onCancel={() => markDone(store, McpOutcome.Skipped)}
              />
            </Box>
          </>
        )}

        {phase === Phase.Working && isRemove && (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>Removing MCP server...</Text>
            <Spinner />
          </Box>
        )}

        {phase === Phase.Working && !isRemove && (
          <Box flexDirection="column">
            <Box flexDirection="column" marginBottom={1}>
              {installValueLines.map((line) => (
                <Text key={line} dimColor>
                  {line}
                </Text>
              ))}
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>
                Found {plural(localClients.length, 'coding agent')}. Setting
                each one up on this computer.
              </Text>
            </Box>
            <ClientRows
              clients={localClients}
              rows={rows}
              results={allResults}
              pluginNames={pluginNames}
            />
          </Box>
        )}

        {phase === Phase.Done && !isRemove && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <ClientRows
                clients={localClients}
                rows={rows}
                results={allResults}
                pluginNames={pluginNames}
              />
            </Box>
            {loginCommands.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                {/* A step still to do, so not the green of the results. */}
                <Text>Authenticate to finish (opens your browser):</Text>
                {loginCommands.map((command) => (
                  <Text key={command}>
                    {'  '}
                    <Text dimColor>$ </Text>
                    <Text bold color={Colors.primary}>
                      {command}
                    </Text>
                  </Text>
                ))}
              </Box>
            )}
            {installSucceeded && samplePrompts.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                <Text>Open one and try a prompt like:</Text>
                {samplePrompts.map((prompt) => (
                  <Text key={prompt}>
                    {'  '}
                    <Text color={Colors.primary}>
                      {Icons.triangleSmallRight}
                    </Text>{' '}
                    <Text dimColor>{prompt}</Text>
                  </Text>
                ))}
              </Box>
            )}
            {readyCount < localClients.length && (
              <Text dimColor>
                Run with --debug for the full output, or report it at
                github.com/PostHog/wizard/issues.
              </Text>
            )}
            {installSucceeded && (
              <>
                <Text dimColor>
                  Take the guided tour anytime with{' '}
                  <Text bold>npx @posthog/wizard mcp tutorial</Text>.
                </Text>
                <Text dimColor>
                  To remove it, exit and run{' '}
                  <Text bold>npx @posthog/wizard mcp remove</Text>.
                </Text>
              </>
            )}
            {retrying ? null : failedNames.length > 0 ? (
              <Box marginTop={1}>
                <PickerMenu
                  key={failedNames.join(',')}
                  options={[
                    { label: stepOneExit, value: CONTINUE },
                    ...failedNames.map((name) => ({
                      label: `Retry ${name}`,
                      value: name,
                    })),
                  ]}
                  onSelect={(value) => {
                    const picked = Array.isArray(value) ? value[0] : value;
                    if (picked === CONTINUE) leaveStepOne();
                    else if (picked) void retry(picked);
                  }}
                />
              </Box>
            ) : (
              <DoneContinue onContinue={leaveStepOne} label={stepOneExit} />
            )}
          </Box>
        )}

        {phase === Phase.Assistants && (
          <Box flexDirection="column">
            {stepOne.current && (
              <Box marginBottom={1}>
                <Text>
                  <Text color="green">{'\u2714'}</Text>{' '}
                  <Text dimColor>
                    Coding agents done:{' '}
                    {stepOne.current.ready.join(', ') || 'none'}
                  </Text>
                </Text>
              </Box>
            )}
            <Box flexDirection="column" marginBottom={1}>
              <Text>
                These connect through your account, so they work on every device
                you sign in on.
              </Text>
              <Text>
                Pick one, we open its page, you sign in and click Connect.
              </Text>
            </Box>
            {opened.map((r) => {
              const client = accountClients.find((c) => c.name === r.name);
              return isOk(r) ? (
                <Box key={r.name} flexDirection="column" marginBottom={1}>
                  <Text>
                    {'  '}
                    <Text color="green">{'\u2714'}</Text> {r.name}{' '}
                    <Text color="green">Opened in your browser</Text>
                  </Text>
                  {client?.finish && (
                    <>
                      <Text dimColor>
                        {'    '}
                        {client.finish.instruction}
                      </Text>
                      <Text>
                        {'    '}
                        <Text dimColor>Didn&apos;t open? </Text>
                        <Text color="cyan">{client.finish.url}</Text>
                      </Text>
                    </>
                  )}
                </Box>
              ) : (
                <Box key={r.name} flexDirection="column" marginBottom={1}>
                  <Text>
                    {'  '}
                    <Text color="red">{'\u2716'}</Text> {r.name}{' '}
                    <Text color="red">Couldn&apos;t open</Text>
                  </Text>
                  {r.detail && (
                    <Text dimColor>
                      {'    '}
                      {r.detail}
                    </Text>
                  )}
                </Box>
              );
            })}
            <PickerMenu
              key={opened.map((r) => r.name).join(',')}
              options={assistantOptions}
              onSelect={(value) => {
                const picked = Array.isArray(value) ? value[0] : value;
                if (picked === CONTINUE) leaveAssistants();
                else if (picked) void openAssistant(picked);
              }}
            />
          </Box>
        )}

        {phase === Phase.Done && isRemove && (
          <Box flexDirection="column">
            {removedNow.length + alreadyRemoved.length + removeFailures.length >
            0 ? (
              <>
                <ResultGroup
                  title="MCP server removed from:"
                  items={removedNow}
                  color="green"
                  icon={'✔'}
                />
                <ResultGroup
                  title="No PostHog entry left to remove for:"
                  items={alreadyRemoved}
                  color="green"
                  icon={'✔'}
                  note="It was already gone, so nothing was changed."
                />
                <ResultGroup
                  title="Couldn't remove from:"
                  items={removeFailures}
                  color="red"
                  icon={'✖'}
                  note="Run with --debug for the full output, or report it at github.com/PostHog/wizard/issues."
                />
              </>
            ) : flowError ? (
              <Box flexDirection="column">
                <Text color="red" bold>
                  {'✖'} Removal failed
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
                Nothing to remove {'—'} the PostHog MCP server wasn&apos;t
                configured for any editor.
              </Text>
            )}
            <DoneContinue onContinue={() => finishFlow.current?.()} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

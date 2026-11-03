import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import {
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { isAbsolute, join, relative } from 'path';
import type { WizardStore } from '@tui/store';
import { IntroScreenLayout } from '@tui/screens/IntroScreenLayout';
import {
  MCP_SCAN_ERROR_KEY,
  MCP_SCAN_KEY,
  MCP_TARGET_KEY,
  McpDiscoveryHint,
  mcpScan,
  resolveMcpTarget,
  scanMcpAnalyticsProject,
  type McpTarget,
} from '@programs/mcp-analytics';
import { analytics } from '@utils/analytics';

enum View {
  Select,
  Path,
  Review,
  Connect,
}
type SelectionSource = 'suggested' | 'manual' | 'agent_search';

export function McpAnalyticsIntroScreen({
  store,
}: {
  store: WizardStore;
}): ReactElement {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
  const [view, setView] = useState(View.Select);
  const [target, setTarget] = useState<McpTarget | null>(null);
  const [source, setSource] = useState<SelectionSource>('suggested');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const scan = mcpScan(store.session);
  const scanError = store.session.frameworkContext[MCP_SCAN_ERROR_KEY] as
    | string
    | undefined;
  const directory = scan?.directory ?? store.session.installDir;

  useInput((_input, key) => {
    if (key.escape && !submitting.current) {
      setError(null);
      setView(View.Select);
    }
  });

  const completeTarget = (
    selected: McpTarget,
    selectionSource: SelectionSource,
  ): void => {
    if (store.setupConfirmed) return;
    store.setFrameworkContext(MCP_TARGET_KEY, selected);
    analytics.wizardCapture('mcp analytics target selected', {
      selection_source: selectionSource,
      target_kind: selected.entryPoint ? 'file' : 'directory',
      candidate_count: scan?.candidates.length ?? 0,
    });
    store.completeSetup();
  };

  const selectPath = async (
    input: string,
    selectionSource: SelectionSource,
    startSetup = false,
  ): Promise<void> => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const resolved = resolveMcpTarget(
        directory,
        selectionSource === 'manual' ? input : join(directory, input),
      );
      if (selectionSource === 'manual' && !resolved.entryPoint) {
        store.setFrameworkContext(
          MCP_SCAN_KEY,
          await scanMcpAnalyticsProject(resolved.directory),
        );
        store.setFrameworkContext(MCP_SCAN_ERROR_KEY, undefined);
        setView(View.Select);
      } else if (startSetup && projectPath(resolved.directory) !== undefined) {
        completeTarget(resolved, selectionSource);
      } else {
        setTarget(resolved);
        setSource(selectionSource);
        setView(View.Review);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'This path could not be opened.',
      );
      analytics.wizardCapture('mcp analytics target rejected', {
        selection_source: selectionSource,
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const confirm = (): void => {
    if (!target || submitting.current || store.setupConfirmed) return;
    completeTarget(target, source);
  };

  const waiting = !scan && !scanError;
  const candidates = scan?.candidates ?? [];
  const suggestedPath = candidates.length === 1 ? candidates[0] : undefined;
  const candidateLabel = (path: string): string => {
    const name = scan?.packageNames?.[path];
    return name ? (path === '.' ? name : `${name} (${path})`) : path;
  };
  const projectPath = (path: string): string | undefined => {
    const fromScan = relative(directory, path);
    if (fromScan === '') return '.';
    return fromScan.startsWith('..') || isAbsolute(fromScan)
      ? undefined
      : fromScan;
  };
  const menuOptions =
    busy || view === View.Path
      ? null
      : waiting
      ? [{ label: 'Cancel', value: 'cancel' }]
      : view === View.Review
      ? [
          { label: 'Instrument this server', value: 'confirm' },
          { label: 'Choose another location', value: 'back' },
        ]
      : view === View.Connect
      ? [{ label: 'Back', value: 'back' }]
      : [
          ...(suggestedPath
            ? [{ label: 'Set up MCP analytics', value: 'start' }]
            : candidates.map((file) => ({
                label: candidateLabel(file),
                value: `target:${file}`,
              }))),
          ...(!scanError && !suggestedPath
            ? [
                {
                  label: 'Find my server and set up analytics',
                  value: 'search',
                },
              ]
            : []),
          { label: 'Choose another location', value: 'path' },
          { label: 'I want to connect PostHog to my agent', value: 'connect' },
          { label: 'Cancel', value: 'cancel' },
        ];

  return (
    <IntroScreenLayout
      installDir={directory}
      title="Set up MCP analytics"
      showDetection={false}
      showSubtitle={false}
      showPrivacy={view === View.Select}
      menuAlign="left"
      menuOptions={menuOptions}
      onSelect={(value) => {
        if (value === 'start' && suggestedPath)
          void selectPath(suggestedPath, 'suggested', true);
        else if (value.startsWith('target:'))
          void selectPath(value.slice(7), 'suggested');
        else if (value === 'path') {
          setError(null);
          setView(View.Path);
        } else if (value === 'search')
          completeTarget({ directory, agentSearch: true }, 'agent_search');
        else if (value === 'connect') setView(View.Connect);
        else if (value === 'back') {
          setError(null);
          setView(View.Select);
        } else if (value === 'confirm') confirm();
        else if (value === 'cancel') store.requestExit(0);
      }}
      body={
        <Box flexDirection="column" width={64}>
          {view === View.Connect ? (
            <>
              <Text>To use PostHog from your coding agent, run:</Text>
              <Text color="cyan">npx @posthog/wizard@latest mcp add</Text>
              <Text dimColor>
                MCP analytics is for measuring calls to a server you build.
              </Text>
            </>
          ) : view === View.Review && target ? (
            <>
              <Text>
                Directory: {projectPath(target.directory) ?? target.directory}
              </Text>
              {target.entryPoint ? (
                <Text>
                  Server: {relative(target.directory, target.entryPoint)}
                </Text>
              ) : null}
              <Text dimColor>
                {target.entryPoint
                  ? 'The agent will verify this server before changing its code.'
                  : 'The agent will find this app’s entry points and verify the server before changing its code.'}
              </Text>
            </>
          ) : view === View.Path ? (
            <>
              <Text>Enter your server directory or entry-point file.</Text>
              <Text dimColor>Relative paths start from {directory}</Text>
              {!busy && (
                <TextInput
                  placeholder="packages/my-server or src/server.ts"
                  onSubmit={(value) => {
                    void selectPath(value, 'manual');
                  }}
                />
              )}
              <Text dimColor>Enter to check the path. Esc to go back.</Text>
            </>
          ) : (
            <>
              <Text>Add analytics to an existing MCP server you build.</Text>
              <Text dimColor>
                We’ll find the integration and configure it for you.
              </Text>
              <Text>Directory: {directory}</Text>
              {waiting ? (
                <Text>Looking for MCP server entry points...</Text>
              ) : scanError ? (
                <Text color="yellow">{scanError}</Text>
              ) : scan?.discoveryHint === McpDiscoveryHint.Launcher ? (
                <Text>
                  This looks like an MCP launcher. The agent will trace the
                  server’s source before choosing where to install analytics.
                </Text>
              ) : scan?.discoveryHint === McpDiscoveryHint.SharedLibrary ? (
                <Text>
                  Found shared MCP code. The agent will find the app that uses
                  it before choosing where to install analytics.
                </Text>
              ) : suggestedPath ? (
                <Text>Server: {candidateLabel(suggestedPath)}</Text>
              ) : candidates.length ? (
                <Text>
                  Found several possible servers. Choose one to set up:
                </Text>
              ) : (
                <Text>
                  The quick scan didn’t find a server. The agent will search
                  this directory and verify your setup before changing code.
                </Text>
              )}
            </>
          )}
          {busy && <Text>Checking...</Text>}
          {error && <Text color="yellow">{error}</Text>}
        </Box>
      }
    />
  );
}

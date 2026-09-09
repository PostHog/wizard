import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import {
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { relative } from 'path';
import type { WizardStore } from '@ui/tui/store';
import type {
  McpTarget,
  McpServerScan,
  resolveMcpTarget,
} from '@lib/programs/mcp-analytics/detect';
import {
  MCP_SCAN_KEY,
  MCP_SCAN_ERROR_KEY,
  MCP_TARGET_KEY,
} from '@lib/programs/mcp-analytics/setup';
import { analytics } from '@utils/analytics';
import { IntroScreenLayout } from './IntroScreenLayout';

enum View {
  Select,
  Path,
  Review,
  Connect,
}
type SelectionSource = 'suggested' | 'manual' | 'agent_search';

type Props = {
  store: WizardStore;
  services: {
    scan: (directory: string) => Promise<McpServerScan>;
    resolve: typeof resolveMcpTarget;
  };
};

export function McpAnalyticsIntroScreen({
  store,
  services,
}: Props): ReactElement {
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
  const scan = store.session.frameworkContext[MCP_SCAN_KEY] as
    | McpServerScan
    | undefined;
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
    if (store.session.setupConfirmed) return;
    store.setInstallDir(selected.directory);
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
      const resolved = services.resolve(directory, input);
      if (selectionSource === 'manual' && !resolved.entryPoint) {
        store.setFrameworkContext(
          MCP_SCAN_KEY,
          await services.scan(resolved.directory),
        );
        store.setFrameworkContext(MCP_SCAN_ERROR_KEY, undefined);
        setView(View.Select);
      } else if (startSetup) {
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
    if (!target || submitting.current || store.session.setupConfirmed) return;
    completeTarget(target, source);
  };

  const cancel = async (): Promise<void> => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    analytics.wizardCapture('mcp analytics setup cancelled');
    try {
      await analytics.shutdown('cancelled');
    } finally {
      process.exit(0);
    }
  };

  const waiting = !scan && !scanError;
  const candidates = scan?.candidates ?? [];
  const suggestedFile = candidates.length === 1 ? candidates[0] : undefined;
  const menuOptions =
    busy || waiting || view === View.Path
      ? null
      : view === View.Review
      ? [
          { label: 'Instrument this server', value: 'confirm' },
          { label: 'Choose another location', value: 'back' },
        ]
      : view === View.Connect
      ? [{ label: 'Back', value: 'back' }]
      : [
          ...(suggestedFile
            ? [{ label: 'Set up MCP analytics', value: 'start' }]
            : candidates.map((file) => ({
                label: file,
                value: `file:${file}`,
              }))),
          ...(!scanError && !suggestedFile
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
        if (value === 'start' && suggestedFile)
          void selectPath(suggestedFile, 'suggested', true);
        else if (value.startsWith('file:'))
          void selectPath(value.slice(5), 'suggested');
        else if (value === 'path') {
          setError(null);
          setView(View.Path);
        } else if (value === 'search')
          void selectPath('.', 'agent_search', true);
        else if (value === 'connect') setView(View.Connect);
        else if (value === 'back') {
          setError(null);
          setView(View.Select);
        } else if (value === 'confirm') confirm();
        else if (value === 'cancel') void cancel();
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
              <Text>Directory: {target.directory}</Text>
              <Text>
                Server:{' '}
                {target.entryPoint
                  ? relative(target.directory, target.entryPoint)
                  : 'The agent will find the entry point'}
              </Text>
              <Text dimColor>
                The agent will verify this server before changing its code.
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
              ) : suggestedFile ? (
                <Text>Server: {suggestedFile}</Text>
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

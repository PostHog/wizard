import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));

const { events } = vi.hoisted(() => ({
  events: [] as { event: string; properties?: Record<string, unknown> }[],
}));
vi.mock(import('@utils/analytics'), async (actual) => {
  const real = await actual();
  real.analytics.wizardCapture = (event, properties) => {
    events.push({ event, properties });
  };
  return real;
});
vi.mock(import('@programs/mcp-analytics'), async (actual) => {
  const real = await actual();
  return {
    ...real,
    scanMcpAnalyticsProject: vi.fn(async (directory: string) => {
      await new Promise((r) => setTimeout(r, 50));
      return real.scanMcpAnalyticsProject(directory);
    }),
  };
});

import {
  MCP_SCAN_KEY,
  MCP_TARGET_KEY,
  scanMcpAnalyticsProject,
  type McpPackageSuggestions,
} from '@programs/mcp-analytics';
import { Program, buildSession } from '@programs';
import { WizardStore } from '@tui/store';
import { McpAnalyticsIntroScreen } from '../screens/McpAnalyticsIntroScreen';

const ENTER = '\r';
const ESC = '\u001B';
const DOWN = '\u001B[B';
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

let root: string;
let server: string;
let store: WizardStore;
let screen: ReturnType<typeof render>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-onboarding-')));
  server = join(root, 'server');
  mkdirSync(join(server, 'src'), { recursive: true });
  writeFileSync(join(server, 'package.json'), '{}');
  writeFileSync(
    join(server, 'src/index.ts'),
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; new McpServer({});",
  );
  events.length = 0;
  vi.mocked(scanMcpAnalyticsProject).mockClear();
});

afterEach(() => {
  cleanup();
  rmSync(root, { recursive: true, force: true });
});

async function open(
  candidates: string[] = [],
  extras: Partial<McpPackageSuggestions> = {},
): Promise<void> {
  store = new WizardStore(Program.McpAnalytics);
  store.launch(buildSession({ installDir: root }));
  store.setFrameworkContext(MCP_SCAN_KEY, {
    directory: root,
    candidates,
    ...extras,
  });
  screen = render(<McpAnalyticsIntroScreen store={store} />);
  await tick();
}

async function press(...keys: string[]): Promise<void> {
  for (const key of keys) {
    screen.stdin.write(key);
    await tick();
  }
}

async function shows(text: string): Promise<void> {
  await vi.waitFor(() => expect(screen.lastFrame()).toContain(text));
}

async function confirmed(): Promise<void> {
  await vi.waitFor(() => expect(store.setupConfirmed).toBe(true));
}

const target = () => store.session.frameworkContext[MCP_TARGET_KEY];
const lastSelection = () =>
  events.filter(({ event }) => event === 'mcp analytics target selected').at(-1)
    ?.properties;

describe('McpAnalyticsIntroScreen', () => {
  it('keeps an invalid path editable and scans a corrected directory once', async () => {
    await open();
    await shows('The quick scan didn’t find a server');
    await press(DOWN, ENTER);
    await shows('Enter your server directory');
    await press('missing', ENTER);
    await shows('This path could not be opened');
    expect(store.setupConfirmed).toBe(false);

    await press(ESC, DOWN, ENTER, 'server');
    screen.stdin.write(ENTER);
    screen.stdin.write(ENTER);
    await shows('src/index.ts');
    expect(scanMcpAnalyticsProject).toHaveBeenCalledTimes(1);

    await press(ENTER);
    await confirmed();
    expect(target()).toEqual({
      directory: server,
      entryPoint: join(server, 'src/index.ts'),
    });
    await press(ENTER);
    expect(
      events.filter(({ event }) => event === 'mcp analytics target selected'),
    ).toHaveLength(1);
  });

  it('starts setup on a single suggestion with one Enter', async () => {
    await open(['server/src/index.ts']);
    await shows('Server: server/src/index.ts');
    await press(ENTER);
    await confirmed();
    expect(target()).toEqual({
      directory: server,
      entryPoint: join(server, 'src/index.ts'),
    });
  });

  it('reviews a choice among several servers before setup', async () => {
    await open(['server/src/index.ts', 'another.ts']);
    await shows('Found several possible servers');
    await press(ENTER);
    await shows('Instrument this server');
    expect(store.setupConfirmed).toBe(false);
    await press(ENTER);
    await confirmed();
  });

  it('treats a suggested path named ~ as a directory in the project', async () => {
    const tilde = join(root, '~');
    mkdirSync(tilde);
    writeFileSync(join(tilde, 'package.json'), '{}');
    await open(['~']);
    await press(ENTER);
    await confirmed();
    expect(target()).toEqual({ directory: tilde });
  });

  it('reviews a suggested directory by its path in the project', async () => {
    await open(['server', 'another.ts']);
    await press(ENTER);
    await shows('Directory: server');
    expect(screen.lastFrame()).not.toContain('Server:');
    expect(store.setupConfirmed).toBe(false);
  });

  it('offers Cancel while the scan runs', async () => {
    store = new WizardStore(Program.McpAnalytics);
    store.launch(buildSession({ installDir: root }));
    const exit = vi
      .spyOn(store, 'requestExit')
      .mockImplementation(() => undefined);
    screen = render(<McpAnalyticsIntroScreen store={store} />);
    await shows('Looking for MCP server entry points');
    await shows('Cancel');
    await press(DOWN, ENTER);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('names application packages and selects their directory', async () => {
    await open(['server'], { packageNames: { server: 'example-tools' } });
    await shows('example-tools (server)');
    await press(ENTER);
    expect(target()).toEqual({ directory: server });
    await confirmed();
  });

  it.each([
    ['launcher', 'This looks like an MCP launcher'],
    ['shared_library', 'Found shared MCP code'],
  ] as const)(
    'explains a %s scan and hands discovery to the agent',
    async (discoveryHint, message) => {
      await open([], { discoveryHint } as Partial<McpPackageSuggestions>);
      await shows(message);
      await shows('Find my server and set up analytics');
      await press(ENTER);
      await confirmed();
      expect(target()).toEqual({ directory: root, agentSearch: true });
      expect(lastSelection()?.selection_source).toBe('agent_search');
    },
  );

  it('reviews a manually entered file from its project directory', async () => {
    await open();
    await press(DOWN, ENTER, 'server/src/index.ts', ENTER);
    await shows('Server: src/index.ts');
    await press(ENTER);
    expect(target()).toEqual({
      directory: server,
      entryPoint: join(server, 'src/index.ts'),
    });
    expect(lastSelection()?.selection_source).toBe('manual');
  });

  it('points PostHog MCP users elsewhere and keeps paths out of telemetry', async () => {
    await open();
    await press(DOWN, DOWN, ENTER);
    await shows('npx @posthog/wizard@latest mcp add');
    expect(store.setupConfirmed).toBe(false);
    await press(ENTER);
    await shows('The quick scan didn’t find a server');
    await press(ENTER);
    await confirmed();
    expect(target()).toEqual({ directory: root, agentSearch: true });
    expect(JSON.stringify(events)).not.toContain(root);
  });
});

import React from 'react';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { render } from 'ink-testing-library';
import { WizardStore } from '@ui/tui/store';
import { McpAnalyticsIntroScreen } from '@ui/tui/screens/McpAnalyticsIntroScreen';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@lib/host-resolution';
import {
  findMcpServers,
  resolveMcpTarget,
} from '@lib/programs/mcp-analytics/detect';
import {
  MCP_SCAN_KEY,
  MCP_TARGET_KEY,
} from '@lib/programs/mcp-analytics/setup';
import { analytics } from '@utils/analytics';

export async function checkMcpOnboarding(): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-onboarding-')));
  const server = join(root, 'server');
  mkdirSync(join(server, 'src'), { recursive: true });
  writeFileSync(join(server, 'package.json'), '{}');
  writeFileSync(
    join(server, 'src/index.ts'),
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; new McpServer({});",
  );
  const capture = analytics.wizardCapture;
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  analytics.wizardCapture = (event, properties) => {
    events.push({ event, properties });
  };
  const store = new WizardStore('mcp-analytics');
  store.session = buildSession({ installDir: root });
  store.session.credentials = {
    projectId: 42,
    projectApiKey: 'phc_example',
    accessToken: 'example',
    host: HostResolution.fromApiHost('https://eu.i.posthog.com'),
  };
  store.setFrameworkContext(MCP_SCAN_KEY, { directory: root, candidates: [] });
  let scans = 0;
  const screen = render(
    <McpAnalyticsIntroScreen
      store={store}
      services={{
        resolve: resolveMcpTarget,
        scan: async (directory) => {
          scans++;
          await delay(50);
          return findMcpServers(directory);
        },
      }}
    />,
  );
  const press = async (key: string): Promise<void> => {
    screen.stdin.write(key);
    await delay(60);
  };
  const shows = (text: string): void => {
    assert.ok(
      screen.lastFrame()?.includes(text),
      `Missing ${text}\n${screen.lastFrame()}`,
    );
  };
  try {
    await delay(60);
    shows('No recognized entry point');
    await press('\r');
    shows('Enter your server directory');
    await press('missing');
    await press('\r');
    shows('This path could not be opened');
    assert.equal(store.session.setupConfirmed, false);
    await press('\u001b');
    await press('\r');
    await press('server');
    screen.stdin.write('\r');
    screen.stdin.write('\r');
    await delay(200);
    assert.equal(scans, 1, 'Repeated Enter must not duplicate a scan');
    shows('src/index.ts');
    await press('\r');
    shows('Instrument this server');
    assert.equal(store.session.setupConfirmed, false);
    await press('\r');
    assert.equal(store.session.installDir, server);
    assert.deepEqual(store.session.frameworkContext[MCP_TARGET_KEY], {
      directory: server,
      entryPoint: join(server, 'src/index.ts'),
    });
    assert.equal(store.session.credentials?.projectId, 42);
    assert.equal(store.session.setupConfirmed, true);
    await press('\r');
    assert.equal(
      events.filter(({ event }) => event === 'mcp analytics target selected')
        .length,
      1,
    );
    const reset = async (key: string): Promise<void> => {
      store.session = buildSession({ installDir: root });
      store.setFrameworkContext(MCP_SCAN_KEY, {
        directory: root,
        candidates: [],
      });
      screen.rerender(
        <McpAnalyticsIntroScreen
          key={key}
          store={store}
          services={{
            resolve: resolveMcpTarget,
            scan: findMcpServers,
          }}
        />,
      );
      await delay(60);
    };
    await reset('manual-file');
    await press('\r');
    await press('server/src/index.ts');
    await press('\r');
    shows('Server: src/index.ts');
    await press('\r');
    assert.equal(store.session.installDir, server);
    assert.equal(
      events
        .filter(({ event }) => event === 'mcp analytics target selected')
        .at(-1)?.properties?.selection_source,
      'manual',
    );

    await reset('connect');
    await press('\u001b[B');
    await press('\u001b[B');
    await press('\r');
    shows('npx @posthog/wizard@latest mcp add');
    assert.equal(store.session.setupConfirmed, false);
    await press('\r');
    shows('No recognized entry point');
    await press('\u001b[B');
    await press('\r');
    shows('The agent will find the entry point');
    await press('\r');
    assert.equal(store.session.installDir, root);
    assert.deepEqual(store.session.frameworkContext[MCP_TARGET_KEY], {
      directory: root,
    });
    assert.equal(
      events
        .filter(({ event }) => event === 'mcp analytics target selected')
        .at(-1)?.properties?.selection_source,
      'agent_search',
    );
    assert.ok(
      !JSON.stringify(events).includes(root),
      'Selection telemetry must not include local paths',
    );
    console.log(
      '\nMCP onboarding directory/file recovery, custom-server fallback, client guidance and duplicate-submit checks passed',
    );
    console.log(screen.lastFrame());
  } finally {
    screen.unmount();
    analytics.wizardCapture = capture;
    rmSync(root, { recursive: true, force: true });
  }
}

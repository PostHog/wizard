/**
 * The Slack connectivity poll degrades to the nudge copy on any failure, so a
 * user whose network is unreachable — or whose corporate proxy intercepts TLS —
 * loses nothing. Reporting those throws to error tracking bought us nothing
 * either, and buried real wizard bugs under environment noise.
 *
 * Locks the split: user-network failures stay out of error tracking, genuine
 * API failures keep flowing to it.
 */
import { createRequire } from 'module';
import net from 'net';
import React from 'react';
import { render } from 'ink-testing-library';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { captureException, wizardCapture } = vi.hoisted(() => ({
  captureException: vi.fn(),
  wizardCapture: vi.fn(),
}));

vi.mock('@utils/analytics', () => ({
  analytics: { captureException, wizardCapture },
}));

// The suite aliases `ink` to a manual mock globally; this screen needs the real
// reconciler so its effects actually flush.
vi.mock('ink', async () => {
  const require_ = createRequire(import.meta.url);
  return (await import(require_.resolve('ink'))) as typeof import('ink');
});

vi.mock('@utils/links', () => ({
  openTrackedLink: vi.fn(),
  withUtm: (url: string) => url,
}));

import { SlackConnectScreen } from '../SlackConnectScreen';

/** A port nothing listens on — the poll's axios call fails with ECONNREFUSED. */
let deadPort = 0;
/** A server that answers every request with 401 — a real, reportable failure. */
let unauthorized: net.Server;
let unauthorizedPort = 0;

beforeAll(async () => {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, resolve));
  deadPort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const http = await import('http');
  unauthorized = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"detail":"Invalid token"}');
  });
  await new Promise<void>((resolve) => unauthorized.listen(0, () => resolve()));
  unauthorizedPort = (unauthorized.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => unauthorized.close(() => resolve()));
});

function buildStore(port: number) {
  const session = {
    credentials: {
      accessToken: 'token',
      projectId: 1,
      host: { apiHost: `http://127.0.0.1:${port}` },
    },
    slackConnected: null as boolean | null,
    roleAtOrganization: 'engineer',
    loginUrl: null,
  };
  return {
    session,
    subscribe: () => () => undefined,
    getSnapshot: () => 1,
    setSlackConnected: (value: boolean) => {
      session.slackConnected = value;
    },
    setSlackStepDismissed: vi.fn(),
    setLoginUrl: vi.fn(),
    setCredentials: vi.fn(),
    setRoleAtOrganization: vi.fn(),
    setApiUser: vi.fn(),
  };
}

/** One poll tick plus slack — the screen polls immediately on mount. */
async function runOnePoll(port: number) {
  const { unmount } = render(
    React.createElement(SlackConnectScreen, {
      store: buildStore(port) as never,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  unmount();
}

describe('SlackConnectScreen connectivity poll', () => {
  it('keeps an unreachable network out of error tracking', async () => {
    captureException.mockClear();
    await runOnePoll(deadPort);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('still reports a genuine API failure', async () => {
    captureException.mockClear();
    await runOnePoll(unauthorizedPort);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual({
      step: 'slack_connected_check',
    });
  });
});

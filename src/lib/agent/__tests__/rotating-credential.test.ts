import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUTH_STATE_ENV } from '@lib/agent/auth-constants';
import { createAuthState } from '@lib/agent/rotating-credential';

// The built artifact, not the source: it's a separate bundle the agent SDK execs
// standalone. `pnpm test` builds before running, so this exists.
const helper = join(process.cwd(), 'dist/auth-helper.js');

describe('gateway credential helper', () => {
  let server: Server;
  let tokenUrl: string;
  let refreshCalls: Array<Record<string, string>>;

  beforeEach(async () => {
    refreshCalls = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        refreshCalls.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'pha_rotated',
            refresh_token: 'refresh_rotated',
            expires_in: 3600,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    tokenUrl = `http://127.0.0.1:${port}/oauth/token`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Async, not execFileSync: the token endpoint above lives in this process, so
  // blocking the event loop would deadlock the helper's request against it.
  const run = async (statePath: string): Promise<string> =>
    (
      await promisify(execFile)(helper, {
        encoding: 'utf8',
        env: { ...process.env, [AUTH_STATE_ENV]: statePath },
      })
    ).stdout;

  it('rotates a token that is about to expire, and persists the new refresh token', async () => {
    const statePath = createAuthState({
      accessToken: 'pha_original',
      refreshToken: 'refresh_original',
      expiresAt: Date.now() + 60_000, // inside the refresh skew
      tokenUrl,
      clientId: 'client-abc',
    });

    expect(await run(statePath)).toBe('pha_rotated');
    expect(refreshCalls).toEqual([
      {
        grant_type: 'refresh_token',
        refresh_token: 'refresh_original',
        client_id: 'client-abc',
      },
    ]);

    // Reusing a spent refresh token revokes the whole session.
    expect(JSON.parse(readFileSync(statePath, 'utf8')).refreshToken).toBe(
      'refresh_rotated',
    );
    expect(await run(statePath)).toBe('pha_rotated');
    expect(refreshCalls).toHaveLength(1);
  });

  it('leaves a healthy token alone', async () => {
    const statePath = createAuthState({
      accessToken: 'pha_healthy',
      refreshToken: 'refresh_original',
      expiresAt: Date.now() + 60 * 60_000,
      tokenUrl,
      clientId: 'client-abc',
    });

    expect(await run(statePath)).toBe('pha_healthy');
    expect(refreshCalls).toHaveLength(0);
  });
});

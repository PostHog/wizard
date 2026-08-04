import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { createRotatingCredential } from '@lib/agent/rotating-credential';

describe('rotating gateway credential', () => {
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

  // Async, not execFileSync: the token endpoint below lives in this process, so
  // blocking the event loop would deadlock the helper's request against it.
  const run = async (helperPath: string): Promise<string> =>
    (await promisify(execFile)(helperPath, { encoding: 'utf8' })).stdout;

  const statePathFor = (helperPath: string): string =>
    helperPath.replace(/helper\.mjs$/, 'state.json');

  it('rotates a token that is about to expire, and persists the new refresh token', async () => {
    const helperPath = createRotatingCredential({
      accessToken: 'pha_original',
      refreshToken: 'refresh_original',
      expiresAt: Date.now() + 60_000, // inside the refresh skew
      tokenUrl,
      clientId: 'client-abc',
    });

    expect(await run(helperPath)).toBe('pha_rotated');
    expect(refreshCalls).toEqual([
      {
        grant_type: 'refresh_token',
        refresh_token: 'refresh_original',
        client_id: 'client-abc',
      },
    ]);

    // Reusing a spent refresh token revokes the whole session.
    const state = JSON.parse(readFileSync(statePathFor(helperPath), 'utf8'));
    expect(state.refreshToken).toBe('refresh_rotated');
    expect(await run(helperPath)).toBe('pha_rotated');
    expect(refreshCalls).toHaveLength(1);
  });

  it('leaves a healthy token alone', async () => {
    const helperPath = createRotatingCredential({
      accessToken: 'pha_healthy',
      refreshToken: 'refresh_original',
      expiresAt: Date.now() + 60 * 60_000,
      tokenUrl,
      clientId: 'client-abc',
    });

    expect(await run(helperPath)).toBe('pha_healthy');
    expect(refreshCalls).toHaveLength(0);
  });
});

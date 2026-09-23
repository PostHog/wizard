import * as http from 'node:http';
import * as net from 'node:net';
import { startCallbackServer } from '@utils/oauth';
import { logToFile } from '../debug';

vi.mock('../debug', () => ({ logToFile: vi.fn(), setDebugSink: vi.fn() }));

const authUrl = 'https://oauth.example.test/authorize';
const signupUrl = 'https://oauth.example.test/signup';

function request(port: number, path: string, cookie?: string) {
  return new Promise<{
    statusCode: number | undefined;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path,
        agent: false,
        headers: cookie ? { Cookie: cookie } : undefined,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('error', reject);
        res.on('end', () =>
          resolve({ statusCode: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(2000, () =>
      req.destroy(new Error('HTTP request timed out')),
    );
  });
}

function rawRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(payload);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (response += chunk));
    socket.on('error', reject);
    socket.on('close', () => resolve(response));
    socket.setTimeout(2000, () => {
      socket.destroy(new Error('Server did not close the HTTP connection'));
    });
  });
}

describe('OAuth callback HTTP server', () => {
  let callbackServer: Awaited<ReturnType<typeof startCallbackServer>>;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    callbackServer = await startCallbackServer(authUrl, signupUrl, 0);
    port = (callbackServer.server.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    callbackServer.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      callbackServer.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it.each([
    ['/authorize', authUrl],
    ['/authorize?signup=true', signupUrl],
  ])('redirects %s and accepts its callback', async (path, redirectUrl) => {
    const cookie = 'local-dev-session=test-session';
    const callback = callbackServer.waitForCallback();

    const redirect = await request(port, path, cookie);

    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe(redirectUrl);

    const response = await request(port, '/callback?code=test-code', cookie);

    expect(response.statusCode).toBe(200);
    await expect(callback).resolves.toBe('test-code');
  });

  it.each(['/authorize', '/callback?code=private-authorization-code'])(
    'explains oversized headers on %s and allows a retry without logging secrets',
    async (path) => {
      const secretCookie = 'private-cookie-secret';
      const secretCode = 'private-authorization-code';
      const callbackUrl = `http://localhost:${port}${path}`;
      const callback = callbackServer.waitForCallback();
      const onSettled = vi.fn();
      void callback.then(onSettled, onSettled);

      const response = await rawRequest(
        port,
        `GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nCookie: session=${secretCookie}${'x'.repeat(
          http.maxHeaderSize + 1024,
        )}\r\n\r\n`,
      );

      expect(response).toMatch(/^HTTP\/1\.1 431 /);
      expect(response).toMatch(/Connection: close/i);
      expect(response).toMatch(/Content-Type: text\/html/i);
      expect(response).toMatch(/(?:private|incognito).*window/i);
      expect(response).toContain(`${http.maxHeaderSize / 1024} KiB`);
      expect(response).toMatch(/clear cookies for localhost/i);
      expect(response).toMatch(/Cache-Control: no-store/i);
      expect(onSettled).not.toHaveBeenCalled();

      const retry = await request(port, `/callback?code=${secretCode}`);

      expect(retry.statusCode).toBe(200);
      await expect(callback).resolves.toBe(secretCode);
      const logs = JSON.stringify(vi.mocked(logToFile).mock.calls);
      expect(logs).toContain('HPE_HEADER_OVERFLOW');
      expect(logs).not.toContain(secretCookie);
      expect(logs).not.toContain(secretCode);
      expect(logs).not.toContain(callbackUrl);
    },
  );

  it('returns 400 and closes the connection for malformed HTTP', async () => {
    const response = await rawRequest(
      port,
      'INVALID METHOD / HTTP/1.1\r\nHost: localhost\r\n\r\n',
    );

    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(response).toMatch(/Connection: close/i);
    expect(response).not.toMatch(/(?:private|incognito).*window/i);
  });
});

import { EventEmitter } from 'node:events';
import type tls from 'node:tls';
import { checkCertificateChain } from '../tls-check';

type FakeSocket = EventEmitter & {
  destroy: ReturnType<typeof vi.fn>;
  getPeerCertificate: () => unknown;
};

function fakeConnect(socket: FakeSocket) {
  return vi.fn(() => socket) as unknown as typeof tls.connect;
}

function fakeSocket(): FakeSocket {
  const root = {
    fingerprint256: 'root',
    issuer: { O: 'Example Corp Root CA' },
  } as Record<string, unknown>;
  root.issuerCertificate = root;
  const leaf = {
    fingerprint256: 'leaf',
    issuer: { CN: 'Example Corp Intermediate' },
    issuerCertificate: root,
  };
  return Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    getPeerCertificate: () => leaf,
  });
}

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const store = {
  getCACertificates: (type: 'default' | 'system') =>
    type === 'system' ? ['bundled', 'keychain'] : ['bundled'],
};

describe('checkCertificateChain', () => {
  it('reports the top issuer when the system store verifies the chain', async () => {
    const socket = fakeSocket();
    const connect = fakeConnect(socket);

    const result = checkCertificateChain('us.posthog.com', 443, connect, store);
    socket.emit('secureConnect');

    await expect(result).resolves.toEqual({
      issuer: 'Example Corp Root CA',
      systemStoreTrusts: true,
    });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'us.posthog.com',
        port: 443,
        ca: ['bundled', 'keychain'],
        rejectUnauthorized: true,
      }),
    );
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('reports untrusted when the chain fails verification', async () => {
    const socket = fakeSocket();

    const result = checkCertificateChain(
      'us.posthog.com',
      443,
      fakeConnect(socket),
      store,
    );
    socket.emit('error', errorWithCode('SELF_SIGNED_CERT_IN_CHAIN'));

    await expect(result).resolves.toEqual({ systemStoreTrusts: false });
  });

  it('resolves null when the handshake fails for another reason', async () => {
    const socket = fakeSocket();

    const result = checkCertificateChain(
      'us.posthog.com',
      443,
      fakeConnect(socket),
      store,
    );
    socket.emit('error', errorWithCode('ECONNRESET'));

    await expect(result).resolves.toBeNull();
  });

  it('skips the connection when the OS store cannot be read', async () => {
    const connect = vi.fn() as unknown as typeof tls.connect;

    await expect(
      checkCertificateChain('us.posthog.com', 443, connect, {}),
    ).resolves.toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });
});

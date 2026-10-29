import { EventEmitter } from 'node:events';
import type tls from 'node:tls';
import { probeCertificateChain } from '../tls-probe';

type FakeSocket = EventEmitter & {
  authorized: boolean;
  destroy: ReturnType<typeof vi.fn>;
  getPeerCertificate: () => unknown;
};

function fakeConnect(socket: FakeSocket) {
  return vi.fn(() => socket) as unknown as typeof tls.connect;
}

function fakeSocket(authorized: boolean): FakeSocket {
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
    authorized,
    destroy: vi.fn(),
    getPeerCertificate: () => leaf,
  });
}

const store = {
  getCACertificates: (type: 'default' | 'system') =>
    type === 'system' ? ['bundled', 'keychain'] : ['bundled'],
};

describe('probeCertificateChain', () => {
  it('reports the top issuer and whether the system store verifies it', async () => {
    const socket = fakeSocket(true);
    const connect = fakeConnect(socket);

    const result = probeCertificateChain('us.posthog.com', connect, store);
    socket.emit('secureConnect');

    await expect(result).resolves.toEqual({
      issuer: 'Example Corp Root CA',
      systemStoreTrusts: true,
    });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'us.posthog.com',
        ca: ['bundled', 'keychain'],
      }),
    );
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('leaves systemStoreTrusts unknown when the OS store cannot be read', async () => {
    const socket = fakeSocket(false);

    const result = probeCertificateChain(
      'us.posthog.com',
      fakeConnect(socket),
      {},
    );
    socket.emit('secureConnect');

    await expect(result).resolves.toEqual({
      issuer: 'Example Corp Root CA',
      systemStoreTrusts: undefined,
    });
  });

  it('resolves null when the handshake fails', async () => {
    const socket = fakeSocket(false);

    const result = probeCertificateChain(
      'us.posthog.com',
      fakeConnect(socket),
      store,
    );
    socket.emit('error', new Error('ECONNRESET'));

    await expect(result).resolves.toBeNull();
  });
});

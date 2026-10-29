import tls, { type DetailedPeerCertificate } from 'node:tls';

/** What a handshake-only connection learned about a host's certificate chain. */
export type ChainProbe = {
  /** Organization (or common name) of the topmost certificate's issuer. */
  issuer?: string;
  /** Whether Node's defaults plus the OS store verify the chain, as `--use-system-ca` would. */
  systemStoreTrusts?: boolean;
};

/** Node 22.15+ TLS API that the repo's `@types/node` predates. */
type CaStore = { getCACertificates?(type: 'default' | 'system'): string[] };

const PROBE_TIMEOUT_MS = 5000;

function systemTrustedCAs(store: CaStore): string[] | undefined {
  try {
    if (!store.getCACertificates) return undefined;
    const defaults = store.getCACertificates('default');
    const known = new Set(defaults);
    return [
      ...defaults,
      ...store.getCACertificates('system').filter((c) => !known.has(c)),
    ];
  } catch {
    return undefined;
  }
}

function topIssuer(leaf: DetailedPeerCertificate): string | undefined {
  let cert = leaf;
  // A self-signed root points at itself.
  while (
    cert.issuerCertificate &&
    cert.issuerCertificate.fingerprint256 !== cert.fingerprint256
  ) {
    cert = cert.issuerCertificate;
  }
  return cert.issuer?.O || cert.issuer?.CN || undefined;
}

/**
 * Completes one TLS handshake with `host`, sends nothing over it and closes.
 * The OS store is passed only to this connection, so the process's own trust
 * is unchanged. Null when the handshake itself fails.
 */
export function probeCertificateChain(
  host: string,
  connect: typeof tls.connect = tls.connect,
  store: CaStore = tls as unknown as CaStore,
): Promise<ChainProbe | null> {
  const ca = systemTrustedCAs(store);
  return new Promise((resolve) => {
    const socket = connect({
      host,
      port: 443,
      servername: host,
      ca,
      // Read the chain rather than reject it; no request follows.
      rejectUnauthorized: false,
      timeout: PROBE_TIMEOUT_MS,
    });
    const finish = (result: ChainProbe | null) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () =>
      finish({
        issuer: topIssuer(socket.getPeerCertificate(true)),
        systemStoreTrusts: ca ? socket.authorized : undefined,
      }),
    );
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

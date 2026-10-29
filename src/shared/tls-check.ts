import tls, { type DetailedPeerCertificate } from 'node:tls';

/** What a handshake-only connection learned about a host's certificate chain. */
export type ChainCheck = {
  /** Organization (or common name) of the topmost certificate's issuer; known only when the chain verified. */
  issuer?: string;
  /** Whether Node's defaults plus the OS store verify the chain, as `--use-system-ca` would. */
  systemStoreTrusts: boolean;
};

/** Node's codes for a certificate chain it can't verify, as TLS inspection causes. */
export const UNTRUSTED_CERT_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED',
]);

/** Node 22.15+ TLS API that the repo's `@types/node` predates. */
type CaStore = { getCACertificates?(type: 'default' | 'system'): string[] };

const CHECK_TIMEOUT_MS = 5000;

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
 * Completes one verified TLS handshake with `host` against Node's defaults plus
 * the OS store, sends nothing over it and closes. The OS store is passed only to
 * this connection, so the process's own trust is unchanged. Null when the store
 * can't be read or the handshake fails for a reason other than the chain.
 */
export function checkCertificateChain(
  host: string,
  port: number,
  connect: typeof tls.connect = tls.connect,
  store: CaStore = tls as unknown as CaStore,
): Promise<ChainCheck | null> {
  const ca = systemTrustedCAs(store);
  // Without the OS store this would repeat the check that already failed.
  if (!ca) return Promise.resolve(null);
  return new Promise((resolve) => {
    const socket = connect({
      host,
      port,
      servername: host,
      ca,
      rejectUnauthorized: true,
      timeout: CHECK_TIMEOUT_MS,
    });
    const finish = (result: ChainCheck | null) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () =>
      finish({
        issuer: topIssuer(socket.getPeerCertificate(true)),
        systemStoreTrusts: true,
      }),
    );
    socket.once('timeout', () => finish(null));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(
        UNTRUSTED_CERT_CODES.has(error.code ?? '')
          ? { systemStoreTrusts: false }
          : null,
      ),
    );
  });
}

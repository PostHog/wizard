import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';

import {
  isBenignNetworkError,
  isTlsTrustError,
  TLS_TRUST_HINT,
} from '../network-errors';

/** Node/undici attach `code` to an otherwise plain Error. */
function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** undici's opaque wrapper: `TypeError: fetch failed` + the real cause. */
function fetchFailed(cause?: unknown): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause });
}

describe('isTlsTrustError', () => {
  it('matches the exact error the wizard captured in production', () => {
    // Verbatim from error tracking issue 019f9654 (step slack_connected_check,
    // screen slack-connect) — Node >= 22 reports the sentence, not the code.
    const err = new Error(
      'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca',
    );
    expect(isTlsTrustError(err)).toBe(true);
    expect(isBenignNetworkError(err)).toBe(true);
  });

  it.each([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('matches OpenSSL code %s', (code) => {
    expect(isTlsTrustError(withCode('handshake failed', code))).toBe(true);
  });

  it('matches a TLS cause nested behind undici fetch failed', () => {
    const err = fetchFailed(
      withCode(
        'unable to verify the first certificate',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      ),
    );
    expect(isTlsTrustError(err)).toBe(true);
  });

  it('does not match a plain connection refusal', () => {
    expect(isTlsTrustError(withCode('connect', 'ECONNREFUSED'))).toBe(false);
  });
});

describe('isBenignNetworkError', () => {
  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ERR_NETWORK',
    'UND_ERR_CONNECT_TIMEOUT',
  ])('matches transport code %s', (code) => {
    expect(isBenignNetworkError(withCode('boom', code))).toBe(true);
  });

  it.each(['SocketError', 'ConnectTimeoutError', 'HeadersTimeoutError'])(
    'matches undici error named %s',
    (name) => {
      const err = new Error('other side closed');
      err.name = name;
      expect(isBenignNetworkError(err)).toBe(true);
    },
  );

  it('matches a bare undici fetch failure with no usable cause', () => {
    expect(isBenignNetworkError(fetchFailed())).toBe(true);
  });

  it('matches an axios error wrapping a transport code', () => {
    expect(
      isBenignNetworkError(new AxiosError('connect', 'ECONNREFUSED')),
    ).toBe(true);
  });

  // The whole point of the classifier: real problems must keep flowing to
  // error tracking. A response the server actually sent is not "the network".
  it('does not match an HTTP error response', () => {
    const err = new AxiosError('Request failed with status code 401');
    err.response = { status: 401 } as AxiosError['response'];
    expect(isBenignNetworkError(err)).toBe(false);
  });

  it('does not match an ordinary programming error', () => {
    expect(isBenignNetworkError(new TypeError('x is not a function'))).toBe(
      false,
    );
    expect(isBenignNetworkError(new Error('Invalid response format'))).toBe(
      false,
    );
  });

  it('does not match a benign filesystem errno', () => {
    expect(isBenignNetworkError(withCode('no entry', 'ENOENT'))).toBe(false);
  });

  it.each([null, undefined, 'a string', 42])('tolerates %p', (value) => {
    expect(isBenignNetworkError(value)).toBe(false);
    expect(isTlsTrustError(value)).toBe(false);
  });

  it('terminates on a self-referential cause chain', () => {
    const err: Error & { cause?: unknown } = new Error('loop');
    err.cause = err;
    expect(isBenignNetworkError(err)).toBe(false);
  });
});

describe('TLS_TRUST_HINT', () => {
  it('names both remediation routes', () => {
    expect(TLS_TRUST_HINT).toContain('--use-system-ca');
    expect(TLS_TRUST_HINT).toContain('NODE_EXTRA_CA_CERTS');
  });
});

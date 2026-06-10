import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';
import type { AxiosRequestConfig } from 'axios';
import { logToFile } from './debug';

/**
 * Build proxy-aware axios request options for a target URL.
 *
 * Corporate environments route outbound traffic through an HTTP/HTTPS proxy
 * advertised via the `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment
 * variables. axios's built-in proxy resolution interacts badly with
 * follow-redirects when an HTTPS target is reached through an HTTP proxy,
 * surfacing as an `AssertionError: protocol mismatch` that crashes the process.
 *
 * To sidestep that, we resolve the proxy ourselves (honouring NO_PROXY and the
 * usual casing variants via `proxy-from-env`), hand axios an explicit proxy
 * agent, and disable its native proxy handling with `proxy: false`. The agent
 * tunnels via CONNECT so follow-redirects always sees a consistent protocol.
 *
 * Returns an empty object when no proxy applies, leaving axios behaviour
 * unchanged for the common (proxy-less) case.
 */
export function getProxyRequestConfig(targetUrl: string): AxiosRequestConfig {
  const proxyUrl = getProxyForUrl(targetUrl);

  if (!proxyUrl) {
    return {};
  }

  logToFile(`[proxy] routing ${targetUrl} through proxy`);

  const isHttpsTarget = targetUrl.startsWith('https:');
  const agent = isHttpsTarget
    ? new HttpsProxyAgent(proxyUrl)
    : new HttpProxyAgent(proxyUrl);

  return {
    // Let our explicit agent own proxying; disable axios's own resolution so it
    // doesn't reconfigure follow-redirects and trigger the protocol-mismatch
    // assertion.
    proxy: false,
    httpAgent: agent,
    httpsAgent: agent,
  };
}

/**
 * Whether an error is the follow-redirects "protocol mismatch" assertion that
 * axios raises when an HTTPS target is routed through an HTTP proxy (or vice
 * versa) without proxy-aware configuration.
 */
export function isProtocolMismatchError(error: unknown): boolean {
  return error instanceof Error && /protocol mismatch/i.test(error.message);
}

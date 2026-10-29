import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import { satisfies } from 'semver';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

/** Node lines whose `http(s).Agent` takes `proxyEnv` and tunnels https with CONNECT. */
const PROXY_ENV_NODE_RANGE = '^22.22.0 || >=24.5.0';

/** The variables axios reads (through proxy-from-env) for an https proxy, in its order. */
export const HTTPS_PROXY_VARS = [
  'npm_config_https_proxy',
  'https_proxy',
  'HTTPS_PROXY',
  'npm_config_proxy',
  'all_proxy',
  'ALL_PROXY',
];

const HTTP_PROXY_VARS = [
  'npm_config_http_proxy',
  'http_proxy',
  'HTTP_PROXY',
  'npm_config_proxy',
  'all_proxy',
  'ALL_PROXY',
];

const NO_PROXY_VARS = ['npm_config_no_proxy', 'no_proxy', 'NO_PROXY'];

function firstSet(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return undefined;
}

/** Whether the environment names an https proxy. */
export function httpsProxyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return firstSet(env, HTTPS_PROXY_VARS) !== undefined;
}

type ProxyAgentOptions = { proxyEnv: Record<string, string> };

type ProxyClient = Pick<typeof axios, 'defaults' | 'interceptors'>;

/** `scheme://user:pass@` — the userinfo of a URL in free text. */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/** Removes URL credentials from text, such as a proxy URL in Node's tunnel errors. */
export function redactUrlCredentials(text: string): string {
  return text.replace(URL_USERINFO, '$1***@');
}

/**
 * Node tunnels from the agent's internal proxy config; the copy left in its
 * public `options` would put the proxy URL into `JSON.stringify` of an axios
 * error, whose `config` holds the agent.
 */
function withoutPublicProxyEnv<T extends http.Agent>(agent: T): T {
  delete (agent as unknown as { options: Partial<ProxyAgentOptions> }).options
    .proxyEnv;
  return agent;
}

/** Scrubs an error, and each error in its `cause` chain, in place. */
export function redactErrorCredentials(error: unknown, depth = 0): void {
  if (!(error instanceof Error) || depth > 5) return;
  error.message = redactUrlCredentials(error.message);
  if (error.stack) error.stack = redactUrlCredentials(error.stack);
  redactErrorCredentials(error.cause, depth + 1);
}

/** How axios reaches the network, tagged on every event as `env_proxy`. */
export type EnvProxyMode = 'none' | 'tunnel' | 'unsupported_node';

/**
 * axios sends an https request to an http proxy as plain http, bearer token
 * included. When the environment names a proxy, hand axios Node's agents,
 * which tunnel with CONNECT. Node without `proxyEnv` keeps axios's handling,
 * so the request still reaches the proxy. Never logs or tags the proxy URL;
 * it can carry credentials.
 */
export function routeAxiosThroughEnvProxy(
  env: NodeJS.ProcessEnv = process.env,
  nodeVersion: string = process.version,
  client: ProxyClient = axios,
): EnvProxyMode {
  const mode = applyEnvProxy(env, nodeVersion, client);
  analytics.setTag('env_proxy', mode);
  return mode;
}

function applyEnvProxy(
  env: NodeJS.ProcessEnv,
  nodeVersion: string,
  client: ProxyClient,
): EnvProxyMode {
  const httpsProxy = firstSet(env, HTTPS_PROXY_VARS);
  const httpProxy = firstSet(env, HTTP_PROXY_VARS);
  if (!httpsProxy && !httpProxy) return 'none';
  if (!satisfies(nodeVersion, PROXY_ENV_NODE_RANGE)) {
    logToFile(
      `[proxy] Node ${nodeVersion} can't tunnel through the environment's proxy; axios keeps its own handling`,
    );
    return 'unsupported_node';
  }

  const proxyEnv: Record<string, string> = {};
  if (httpsProxy) proxyEnv.HTTPS_PROXY = httpsProxy;
  if (httpProxy) proxyEnv.HTTP_PROXY = httpProxy;
  const noProxy = firstSet(env, NO_PROXY_VARS);
  if (noProxy) proxyEnv.NO_PROXY = noProxy;

  // The repo's `@types/node` predates `proxyEnv`.
  const options: ProxyAgentOptions = { proxyEnv };
  client.defaults.proxy = false;
  // Node's ERR_PROXY_TUNNEL message names the proxy URL, credentials included;
  // scrub it before any caller logs or captures the error.
  client.interceptors.response.use(undefined, (error: unknown) => {
    redactErrorCredentials(error);
    return Promise.reject(error);
  });
  client.defaults.httpsAgent = withoutPublicProxyEnv(
    new https.Agent(options as unknown as https.AgentOptions),
  );
  client.defaults.httpAgent = withoutPublicProxyEnv(
    new http.Agent(options as unknown as http.AgentOptions),
  );
  logToFile("[proxy] axios tunnels through the environment's proxy");
  return 'tunnel';
}

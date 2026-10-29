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
  client: Pick<typeof axios, 'defaults'> = axios,
): EnvProxyMode {
  const mode = applyEnvProxy(env, nodeVersion, client);
  analytics.setTag('env_proxy', mode);
  return mode;
}

function applyEnvProxy(
  env: NodeJS.ProcessEnv,
  nodeVersion: string,
  client: Pick<typeof axios, 'defaults'>,
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
  client.defaults.httpsAgent = new https.Agent(
    options as unknown as https.AgentOptions,
  );
  client.defaults.httpAgent = new http.Agent(
    options as unknown as http.AgentOptions,
  );
  logToFile("[proxy] axios tunnels through the environment's proxy");
  return 'tunnel';
}

#!/usr/bin/env node
// Run the built wizard through a process-local HTTPS proxy that fails only token minting.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, connect } from 'node:net';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const statusArg = args.find((arg) => arg.startsWith('--mint-status='));
const status = Number(statusArg?.split('=')[1] ?? 503);
const check = args.includes('--check');
const wizardArgs = args.filter((arg) => arg !== statusArg && arg !== '--check');
if (![400, 401, 403, 404, 429, 500, 502, 503].includes(status)) {
  console.error('Use --mint-status=403, 429, or 503 (default).');
  process.exit(2);
}
const state = await mkdtemp(path.join(tmpdir(), 'wizard-mint-proxy-'));
const proxyLog = path.join(state, 'requests.log');
let proxy;
let wizard;
let startupError;
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return;
  stopping = true;
  wizard?.kill(signal);
  proxy?.kill('SIGTERM');
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop());

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForProxy(port, certificate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError;
    if (proxy.exitCode !== null)
      throw new Error('The local proxy exited before it was ready.');
    try {
      await access(certificate);
      await new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Timed out starting the local mint proxy.');
}

try {
  await access(path.join(root, 'dist/bin.js'));
  const port = await freePort();
  const addon = path.join(state, 'mint.py');
  await writeFile(
    addon,
    `from mitmproxy import http
import json

TARGET_HOSTS = {"us.posthog.com", "eu.posthog.com", "app.posthog.com", "us.i.posthog.com", "eu.i.posthog.com"}

def request(flow: http.HTTPFlow):
    if flow.request.host in TARGET_HOSTS and flow.request.path.split("?", 1)[0] == "/api/wizard/gateway_token/":
        flow.response = http.Response.make(${status}, json.dumps({"detail": "Local proxy: simulated mint failure", "outcome": "blocked"}), {"Content-Type": "application/json", "Cache-Control": "no-store"})
        with open(${JSON.stringify(proxyLog)}, "a") as log:
            log.write(f"{flow.request.method} {flow.request.host}/api/wizard/gateway_token/ -> ${status} (injected; not forwarded)\\n")
`,
  );
  proxy = spawn(
    'mitmdump',
    [
      '--listen-host',
      '127.0.0.1',
      '--listen-port',
      String(port),
      '--set',
      `confdir=${path.join(state, 'certs')}`,
      '--set',
      'connection_strategy=lazy',
      '--set',
      'flow_detail=0',
      '--set',
      'termlog_verbosity=error',
      '-s',
      addon,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  proxy.once('error', (error) => {
    startupError = error;
  });
  const cert = path.join(state, 'certs', 'mitmproxy-ca-cert.pem');
  await waitForProxy(port, cert);
  if (startupError) throw startupError;
  const preload = path.join(state, 'proxy.mjs');
  await writeFile(
    preload,
    `import { ProxyAgent, setGlobalDispatcher } from ${JSON.stringify(
      pathToFileURL(require.resolve('undici')).href,
    )};
setGlobalDispatcher(new ProxyAgent(${JSON.stringify(
      `http://127.0.0.1:${port}`,
    )}));
`,
  );
  const extraCerts = path.join(state, 'trusted-ca.pem');
  let certificates = await readFile(cert, 'utf8');
  if (process.env.NODE_EXTRA_CA_CERTS)
    certificates +=
      '\n' + (await readFile(process.env.NODE_EXTRA_CA_CERTS, 'utf8'));
  await writeFile(extraCerts, certificates);
  const env = {
    ...process.env,
    NODE_EXTRA_CA_CERTS: extraCerts,
    HTTP_PROXY: `http://127.0.0.1:${port}`,
    HTTPS_PROXY: `http://127.0.0.1:${port}`,
    ALL_PROXY: `http://127.0.0.1:${port}`,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    http_proxy: `http://127.0.0.1:${port}`,
    https_proxy: `http://127.0.0.1:${port}`,
    no_proxy: 'localhost,127.0.0.1,::1',
  };
  console.error(`[mint proxy] Forcing HTTP ${status} for token minting only.`);
  console.error(`[mint proxy] Evidence: ${proxyLog}`);
  let entry = path.join(root, 'dist/bin.js');
  if (check) {
    entry = path.join(state, 'check.mjs');
    await writeFile(
      entry,
      `import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const dist = ${JSON.stringify(path.join(root, 'dist'))};
const file = (await readdir(dist)).filter(f => f.startsWith('gateway-session-') && f.endsWith('.js'));
let gatewayAuth;
for (const f of file) {
  if (!(await readFile(dist + '/' + f, 'utf8')).includes('async function gatewayAuth(')) continue;
  const module = await import(pathToFileURL(dist + '/' + f));
  gatewayAuth = Object.values(module).find(value => typeof value === 'function' && value.name === 'gatewayAuth');
}
if (!gatewayAuth) throw new Error('Could not locate the built mint client. Rebuild the wizard.');
try {
  await gatewayAuth({apiHost:'https://us.i.posthog.com'}, 'repro-dummy-token', 'posthog-integration');
  throw new Error('Expected token minting to fail');
} catch (error) {
  const expected = ${
    status < 500 ? "'PHW_GATEWAY_MINT_REFUSED'" : "'PHW_GATEWAY_MINT_FAILED'"
  };
  if (error.code !== expected || !error.message.includes(${JSON.stringify(
    status < 500 ? 'Local proxy: simulated mint failure' : String(status),
  )})) throw error;
  console.log('Built mint client: ' + error.code + ' — ' + error.message);
}
const response = await fetch('https://posthog.com/robots.txt');
if (!response.ok) throw new Error('Proxy passthrough failed: ' + response.status);
console.log('Non-mint HTTPS passthrough: HTTP ' + response.status);
process.exit(0);
`,
    );
  }
  wizard = spawn(
    process.execPath,
    ['--import', preload, entry, ...wizardArgs],
    { env, stdio: 'inherit' },
  );
  wizard.once('error', (error) => {
    console.error(error.message);
    stop();
  });
  const [code, signal] = await once(wizard, 'exit');
  process.exitCode = signal ? 130 : code ?? 1;
  try {
    console.error((await readFile(proxyLog, 'utf8')).trim());
  } catch {
    /* No mint request was reached. */
  }
} catch (error) {
  console.error(`[mint proxy] ${error.message}`);
  process.exitCode = 1;
} finally {
  stop();
  if (proxy && proxy.exitCode === null && proxy.pid) await once(proxy, 'exit');
  await rm(path.join(state, 'certs'), { recursive: true, force: true });
  await rm(path.join(state, 'trusted-ca.pem'), { force: true });
}

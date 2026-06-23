/**
 * Quick eyeball test of the agent (MCP) route — without a full Claude session.
 *
 * Spawns the wizard-ci MCP server (which boots the real TUI host), drives a few
 * steps over stdio JSON-RPC, and prints the REAL rendered screen that
 * render_screen returns. Pass STEP=run to also kick off the integration.
 *
 *   APP_DIR=/tmp/app POSTHOG_KEY_FILE=/path/phx.txt PROJECT_ID=228144 \
 *     npx tsx scripts/wizard-ci-explore.no-jest.ts
 */
import { spawn } from 'child_process';
import path from 'path';

const srv = spawn(
  path.join(process.cwd(), 'node_modules/.bin/tsx'),
  ['scripts/wizard-ci-mcp.no-jest.ts'],
  { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] },
);

let buf = '';
const pending = new Map<
  number,
  (m: { result: { content: Array<{ text: string }> } }) => void
>();
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  }
});

let idc = 0;
const send = (
  method: string,
  params: unknown,
): Promise<{ result: { content: Array<{ text: string }> } }> =>
  new Promise((r) => {
    const id = ++idc;
    pending.set(id, r);
    srv.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
    );
  });
const notify = (method: string, params?: unknown) =>
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const call = (name: string, args: Record<string, unknown> = {}) =>
  send('tools/call', { name, arguments: args });
const out = (r: { result: { content: Array<{ text: string }> } }) =>
  r.result.content[0].text;
const screen = (r: { result: { content: Array<{ text: string }> } }) => {
  try {
    return JSON.parse(out(r)).currentScreen as string;
  } catch {
    return out(r);
  }
};

async function main() {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'explore', version: '1' },
  });
  notify('notifications/initialized');

  const open = await call('open_app', {
    appDir: process.env.APP_DIR,
    keyFile: process.env.POSTHOG_KEY_FILE,
    projectId: process.env.PROJECT_ID,
    region: process.env.POSTHOG_REGION ?? 'us',
  });
  process.stdout.write(`open_app       → ${screen(open)}\n`);
  process.stdout.write(
    `confirm_setup  → ${screen(
      await call('perform_action', { action: 'confirm_setup' }),
    )}\n`,
  );
  process.stdout.write(
    `read_state     → ${screen(await call('read_state'))}\n`,
  );

  process.stdout.write('\n=== render_screen (the REAL TUI) ===\n');
  process.stdout.write(out(await call('render_screen')));

  srv.kill();
  process.exit(0);
}
main().catch((e) => {
  process.stderr.write(`explore error: ${e?.stack ?? e}\n`);
  srv.kill();
  process.exit(1);
});

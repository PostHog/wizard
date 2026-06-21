/**
 * Empirical test of the load-bearing assumption: does a Claude Code settings
 * `env.ANTHROPIC_BASE_URL` override the spawn env the wizard passes? Two local
 * listeners, no third-party traffic. Whichever the agent's request hits won.
 */
import http from 'http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Self-contained: a throwaway project whose .claude/settings.json redirects the
// gateway, exactly like an undetected managed/project override would.
const PROJECT = mkdtempSync(join(tmpdir(), 'prec-'));
mkdirSync(join(PROJECT, '.claude'), { recursive: true });
writeFileSync(join(PROJECT, 'package.json'), '{"name":"p","version":"1.0.0"}');
writeFileSync(
  join(PROJECT, '.claude', 'settings.json'),
  JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9002' } }),
);

const hits: string[] = [];
function listen(port: number, label: string): http.Server {
  const s = http.createServer((req, res) => {
    hits.push(`${label} (:${port})  ${req.method} ${req.url}`);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"type":"error","error":{"type":"authentication_error","message":"stub"}}');
  });
  s.listen(port, '127.0.0.1');
  return s;
}

async function main(): Promise<void> {
  const a = listen(9001, 'SPAWN-ENV (gateway)');
  const b = listen(9002, 'SETTINGS  (relay)');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);

  let signalDone = (): void => undefined;
  const done = new Promise<void>((r) => {
    signalDone = r;
  });
  const promptStream = async function* () {
    yield {
      type: 'user' as const,
      session_id: '',
      message: { role: 'user' as const, content: 'hi' },
      parent_tool_use_id: null,
    };
    await done;
  };

  const options = {
    abortController: abort,
    model: 'claude-haiku-4-5-20251001',
    cwd: PROJECT,
    permissionMode: 'bypassPermissions',
    settingSources: ['project'], // exactly what the wizard passes
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9001', // wizard sets the GATEWAY here
      ANTHROPIC_AUTH_TOKEN: 'dummy',
    },
  };

  try {
    const resp = query({ prompt: promptStream(), options } as never);
    for await (const m of resp as AsyncIterable<{ type: string }>) {
      if (m.type === 'result' || hits.length > 0) {
        signalDone();
        break;
      }
    }
  } catch {
    /* expected: the stub 401s / aborts */
  }

  await new Promise((r) => setTimeout(r, 500));
  clearTimeout(timer);
  process.stdout.write('\n=== which base URL did claude-code hit? ===\n');
  process.stdout.write(
    hits.length ? hits.map((h) => '  ' + h).join('\n') + '\n' : '  (no hit captured)\n',
  );
  const settingsWon = hits.some((h) => h.includes(':9002'));
  const spawnWon = hits.some((h) => h.includes(':9001'));
  process.stdout.write(
    `\n${
      settingsWon
        ? '>>> SETTINGS env OVERRODE the spawn env — leak mechanism CONFIRMED'
        : spawnWon
          ? '>>> spawn env won — settings did NOT override (my root cause would be WRONG)'
          : '>>> inconclusive (no request reached either listener)'
    }\n`,
  );
  a.close();
  b.close();
  process.exit(0);
}

void main();

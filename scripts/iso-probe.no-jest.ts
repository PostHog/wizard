/**
 * Live credential-isolation probe (Part B of the #744 audit).
 *
 * For each routing/credential knob: spawn the SDK once with the RAW env (gateway
 * routing + the knob) and once through the REAL sanitizeAgentSubprocessEnv, and
 * report whether each reached the gateway. Success is keyed off
 * is_error===false && usage tokens>0 (the SDK reports subtype:"success" even on
 * auth failure). A local listener catches base-URL redirects + token exfil.
 *
 * Run from the wizard repo root:
 *   POSTHOG_KEY_FILE=/Users/vincent/work-code/workbench/test-api-key.txt \
 *     npx tsx scripts/iso-probe.no-jest.ts
 */
import fs from 'fs';
import http from 'http';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { sanitizeAgentSubprocessEnv } from '../src/lib/agent/agent-env-isolation';

const KEY = fs.readFileSync(process.env.POSTHOG_KEY_FILE!, 'utf8').trim();
const GATEWAY = 'https://gateway.us.posthog.com/wizard';
const LISTENER = 'http://127.0.0.1:8787';

// Local listener: logs any inbound request + its Authorization header.
const hits: string[] = [];
const server = http.createServer((req, res) => {
  // Redact the token value — we only need to prove a Bearer was leaked, never
  // print the live key.
  const auth = (req.headers.authorization ?? '(none)').replace(
    /(Bearer\s+\S{4})\S+/i,
    '$1<REDACTED>',
  );
  hits.push(`${req.method} ${req.url} auth=${auth}`);
  res.writeHead(401);
  res.end();
});

const baseEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ANTHROPIC_BASE_URL: GATEWAY,
  ANTHROPIC_AUTH_TOKEN: KEY,
  CLAUDE_CODE_OAUTH_TOKEN: KEY,
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
};

// The wizard's spawn sites inject these AFTER the sanitize spread (the namespace
// nuke strips them from the inherited env). Mirror that exactly, or the
// sanitized run has no routing and 401s ("Not logged in") for every knob.
const GATEWAY_ROUTING: NodeJS.ProcessEnv = {
  ANTHROPIC_BASE_URL: GATEWAY,
  ANTHROPIC_AUTH_TOKEN: KEY,
  CLAUDE_CODE_OAUTH_TOKEN: KEY,
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
};

// Each knob: the env addition that should route OFF the gateway pre-fix.
const KNOBS: { name: string; add: NodeJS.ProcessEnv }[] = [
  { name: 'baseline (no knob)', add: {} },
  {
    name: 'ANTHROPIC_API_KEY (PR original)',
    add: { ANTHROPIC_API_KEY: 'sk-ant-FAKE' },
  },
  {
    name: 'CLAUDE_CODE_USE_BEDROCK (PR original)',
    add: { CLAUDE_CODE_USE_BEDROCK: '1' },
  },
  {
    name: 'CLAUDE_CODE_USE_FOUNDRY (fix)',
    add: { CLAUDE_CODE_USE_FOUNDRY: '1' },
  },
  {
    name: 'CLAUDE_CODE_USE_MANTLE (fix)',
    add: { CLAUDE_CODE_USE_MANTLE: '1' },
  },
  {
    name: 'CLAUDE_CODE_USE_ANTHROPIC_AWS + AWS creds (fix)',
    add: {
      CLAUDE_CODE_USE_ANTHROPIC_AWS: '1',
      AWS_ACCESS_KEY_ID: 'AKIAFAKE',
      AWS_SECRET_ACCESS_KEY: 'fake',
      AWS_REGION: 'us-east-1',
    },
  },
  {
    name: 'ANTHROPIC_IDENTITY_TOKEN (fix)',
    add: { ANTHROPIC_IDENTITY_TOKEN: 'idtok-FAKE' },
  },
  {
    name: 'CLAUDE_CODE_API_BASE_URL -> listener (fix, exfil test)',
    add: { CLAUDE_CODE_API_BASE_URL: LISTENER },
  },
  {
    name: 'ANTHROPIC_BEDROCK_BASE_URL -> listener (pattern, exfil test)',
    add: { CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BEDROCK_BASE_URL: LISTENER },
  },
  {
    name: 'ANTHROPIC_BASE_URL -> listener (redirect + gateway-token exfil)',
    add: { ANTHROPIC_BASE_URL: LISTENER },
  },
];

async function runOnce(env: NodeJS.ProcessEnv): Promise<{
  ok: boolean;
  apiKeySource: string;
  detail: string;
}> {
  let apiKeySource = '?';
  let usage = 0;
  let isError = false;
  let detail = '';
  try {
    const it = query({
      prompt: 'Reply with the single word: hi',
      options: {
        env,
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowedTools: [],
      },
    });
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(
        () => rej(new Error('timeout/hung (diverted to a slow backend)')),
        45000,
      ),
    );
    await Promise.race([
      (async () => {
        for await (const m of it as AsyncIterable<any>) {
          if (m.type === 'system' && m.subtype === 'init')
            apiKeySource = m.apiKeySource ?? 'none';
          if (m.type === 'result') {
            isError = m.is_error === true;
            usage =
              (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0);
            detail =
              m.subtype +
              (m.is_error
                ? ` is_error / ${(m.result ?? '').slice(0, 50)}`
                : '');
          }
        }
      })(),
      timeout,
    ]);
  } catch (e) {
    detail = (e as Error).message.slice(0, 70);
  }
  return { ok: !isError && usage > 0, apiKeySource, detail };
}

(async () => {
  await new Promise<void>((r) => server.listen(8787, r));
  console.log(
    `key=${KEY.slice(0, 4)}***  gateway=${GATEWAY}  listener=${LISTENER}\n`,
  );
  for (const k of KNOBS) {
    const env = { ...baseEnv, ...k.add };
    const raw = await runOnce(env);
    // Mirror the wizard spawn site exactly: nuke the namespace, then re-inject
    // our gateway routing.
    const san = await runOnce({
      ...sanitizeAgentSubprocessEnv(env),
      ...GATEWAY_ROUTING,
    });
    const verdict = san.ok ? (raw.ok ? '—' : 'FIX HOLDS') : 'SANITIZED FAILED!';
    console.log(`### ${k.name}`);
    console.log(
      `  raw       : ok=${raw.ok}  apiKeySource=${raw.apiKeySource}  ${raw.detail}`,
    );
    console.log(
      `  sanitized : ok=${san.ok}  apiKeySource=${san.apiKeySource}  ${san.detail}  [${verdict}]\n`,
    );
  }
  if (hits.length) {
    console.log(
      '!!! LISTENER HITS (base-URL redirect / token exfil) — raw env only:',
    );
    for (const h of hits) console.log('   ' + h);
  } else {
    console.log('listener: no hits.');
  }
  server.close();
  process.exit(0);
})();

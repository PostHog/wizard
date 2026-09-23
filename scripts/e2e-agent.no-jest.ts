/**
 * `pnpm test:e2e:agent` — one real agent run through `runAgent` on a skill
 * that has nothing to do with PostHog programs. A local skills server hands
 * the agent a `quack` skill, the agent writes `quack/quack.txt` into an empty
 * directory, and this script checks the file. No programs, TUI, store or
 * context-mill are involved.
 *
 *   PROJECT_ID=… POSTHOG_KEY_FILE=… WIZARD_CI_GATEWAY_TOKEN_FILE=… \
 *   [E2E_RESULT_JSON=result.json] pnpm test:e2e:agent
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { strToU8, zipSync } from 'fflate';
import { runAgent, RunOutcome, DEFAULT_AGENT_BINDING } from '@agent';
import type { RunConfig } from '@agent/types';
import {
  formatProgress,
  readE2eEnv,
  resolveE2eCredentials,
  writeE2eResult,
} from '@e2e-harness/surface-e2e';

const SKILL_ID = 'quack';
const QUACK_FILE = path.join('quack', 'quack.txt');
const SKILL_MD = `---
name: quack
description: Write the word quack into quack/quack.txt.
---

# Quack

1. Create a directory named \`quack\` in the current working directory.
2. Write a file \`quack/quack.txt\` whose entire content is the word \`quack\`.
3. Change nothing else. Do not install packages or call any PostHog tool.
`;

/** Serve a one-skill menu and its archive on a loopback port. */
async function serveQuackSkill(): Promise<{ url: string; close: () => void }> {
  const archive = Buffer.from(zipSync({ 'SKILL.md': strToU8(SKILL_MD) }));
  let base = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/skill-menu.json') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          categories: {
            e2e: [
              { id: SKILL_ID, name: 'Quack', downloadUrl: `${base}/quack.zip` },
            ],
          },
        }),
      );
    } else if (req.url === '/quack.zip') {
      res.setHeader('content-type', 'application/zip');
      res.end(archive);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
  return { url: base, close: () => server.close() };
}

async function main(): Promise<void> {
  const e2e = readE2eEnv(process.env, { needsAppDir: false });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-e2e-agent-'));
  const credentials = await resolveE2eCredentials(e2e);
  const skills = await serveQuackSkill();

  const config: RunConfig = {
    programId: 'e2e-agent',
    run: {
      integrationLabel: SKILL_ID,
      skillId: SKILL_ID,
      spinnerMessage: 'Quacking',
      successMessage: 'Quacked',
      estimatedDurationMinutes: 1,
      reportFile: 'quack-report.md',
      docsUrl: 'https://posthog.com/docs',
    },
    composed: false,
    binding: DEFAULT_AGENT_BINDING,
    skillsBaseUrl: skills.url,
    wizardFlags: {},
    wizardFlagPayloads: {},
    wizardMetadata: {},
  };

  try {
    const result = await runAgent(
      config,
      {
        installDir: workDir,
        credentials: credentials.posthog,
        inferenceAuth: credentials.inferenceAuth,
        project: credentials.project,
        apiUser: credentials.apiUser,
        skillId: SKILL_ID,
        flags: {
          ci: true,
          signup: false,
          debug: false,
          e2eAsk: false,
          localMcp: false,
          captureAio: false,
          benchmark: false,
          yaraReport: false,
        },
        host: {},
      },
      {
        onProgress: (event) => {
          const line = formatProgress(event);
          if (line) console.log(line);
        },
      },
    );

    const quackPath = path.join(workDir, QUACK_FILE);
    const quack = fs.existsSync(quackPath)
      ? fs.readFileSync(quackPath, 'utf8').trim()
      : null;
    const passed = result.outcome === RunOutcome.Success && quack === 'quack';
    writeE2eResult({
      route: 'agent',
      skillId: SKILL_ID,
      workDir,
      outcome: result.outcome,
      failure:
        result.outcome === RunOutcome.Success ? null : result.failure.message,
      quack,
      passed,
    });
    console.log(`${SKILL_ID}: ${result.outcome}, ${QUACK_FILE} = ${quack}`);
    if (!passed) process.exitCode = 1;
  } finally {
    skills.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

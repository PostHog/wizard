/**
 * Run the Decisions judgment service against local folders, outside a wizard run.
 * It asks every question the programs declare, plus the project picker's
 * questions with --projects, and prints each answer next to why it is asked.
 *
 * Usage:
 *   WIZARD_CI_GATEWAY_TOKEN_FILE=<abs path> pnpm decisions-detect <dir> [dir...] [flags]   (PostHog's AI gateway)
 *   OPENAI_API_KEY=... pnpm decisions-detect <dir> [dir...] [flags]                        (OpenAI directly)
 *
 * The gateway token file is the one docs/local-dev.md sets up. It wins when both are set.
 *
 *   --projects  also judge which apps the folder holds, as the project pickers do
 *   --compare   also run static detectFramework and show agreement (implied for several dirs)
 *   --json      machine-readable output
 *   --state     print the rendered input and exit (no credential, no API call)
 *   --request   print the gateway request bodies and exit (no credential, no API call; before redaction)
 *
 * Exits 1 when any folder's call fails.
 */

import path from 'path';
import fs from 'fs';
import {
  detectFramework,
  FRAMEWORK_REGISTRY,
  getProgramDecisions,
  loadDecisionsService,
  type DecisionQuestionSpec,
  type DecisionsResult,
} from '@programs';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import {
  DECISIONS_MODEL,
  toSystemOneRequest,
  type DecisionsTransport,
} from '@shared/decisions-client';

/** The gateway's question limit per request. */
const MAX_QUESTIONS_PER_CALL = 32;

type DecisionsService = NonNullable<
  Awaited<ReturnType<typeof loadDecisionsService>>
>;

type Row = {
  dir: string;
  result: Omit<DecisionsResult, 'mode'>;
  projects?: Awaited<ReturnType<DecisionsService['judgeProjects']>>;
  staticFramework?: string | null;
};

const declared = getProgramDecisions();
/** Every program that asks each question key, in first-declared order. */
const askedBy = new Map<string, string[]>();
for (const { id, decisions } of declared) {
  for (const key of decisions) {
    askedBy.set(key, [...(askedBy.get(key) ?? []), id]);
  }
}
// Set in main(), once the service has loaded.
let svc: DecisionsService;
let specs: DecisionQuestionSpec[] = [];
const integrationTargets = Object.entries(FRAMEWORK_REGISTRY).map(
  ([id, config]) => ({ id, name: config.metadata.name }),
);

function resolveTransport(): {
  transport: DecisionsTransport;
  label: string;
} | null {
  const tokenFile = process.env.WIZARD_CI_GATEWAY_TOKEN_FILE;
  if (tokenFile) {
    const region = process.env.POSTHOG_WIZARD_REGION === 'eu' ? 'eu' : 'us';
    const gateway = readCiGatewayCredential(region);
    if (!gateway.token.trim()) {
      // A `<(...)` path reads empty once pnpm and tsx have spawned the script.
      throw new Error(`The gateway token file is empty: ${tokenFile}`);
    }
    return {
      transport: { gateway },
      label: `gateway ${gateway.url} · credential: token file ${tokenFile}`,
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    return {
      transport: { apiKey, baseUrl: process.env.OPENAI_BASE_URL || undefined },
      label: 'OpenAI directly · credential: OPENAI_API_KEY',
    };
  }
  return null;
}

function printRow(row: Row): void {
  const { result } = row;
  console.log(`\n${row.dir}`);
  if (result.error) console.log(`  error: ${result.error}`);
  const summary = svc.summarizeAnswers(result.answers);
  const width = Math.max(...specs.map((s) => s.name.length));
  for (const spec of specs) {
    const value = summary[spec.name];
    console.log(
      `  ${spec.name.padEnd(width)}  ${String(value ?? 'unanswered').padEnd(
        24,
      )} ${spec.purpose} (${askedBy.get(spec.name)?.join(', ') ?? ''})`,
    );
  }
  if (row.staticFramework !== undefined) {
    const framework = result.answers.framework;
    const judged = framework?.kind === 'choice' ? framework.choice : null;
    const verdict =
      judged === null
        ? 'no answer'
        : judged === (row.staticFramework ?? 'none')
        ? 'agrees'
        : 'disagrees';
    console.log(
      `  static framework: ${row.staticFramework ?? 'none'} · ${verdict}`,
    );
  }
  if (row.projects !== undefined) {
    if (!row.projects) {
      console.log('  projects: call failed');
    } else {
      const { report, confident } = row.projects;
      console.log(
        `  projects (${report.repoType}, ${
          confident ? 'confident' : 'not confident'
        }):`,
      );
      for (const p of report.projects) {
        console.log(
          `    ${p.recommended ? '→' : ' '} ${p.path.padEnd(28)} ${
            p.framework
          }${p.hasPostHog ? ' · PostHog installed' : ''}`,
        );
      }
    }
  }
  console.log(
    `  ${
      result.model
    } · ${result.inputTokens.toLocaleString()} input tokens · ${
      result.durationMs
    }ms · ${result.redactedLines} line(s) redacted`,
  );
}

async function main(): Promise<void> {
  const loaded = await loadDecisionsService();
  if (!loaded) {
    console.error(
      'The Decisions service is not in production builds. Run this script from source.',
    );
    process.exit(1);
  }
  svc = loaded;
  specs = [...askedBy.keys()].map(
    (key) => svc.QUESTIONS[key as keyof typeof svc.QUESTIONS],
  );
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const dirs = args
    .filter((a) => !a.startsWith('--'))
    .map((d) => path.resolve(d))
    .filter((d) => {
      if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
        console.error(`skipping: not a directory: ${d}`);
        return false;
      }
      return true;
    });
  if (dirs.length === 0) {
    console.error(
      'Usage: WIZARD_CI_GATEWAY_TOKEN_FILE=<abs path> | OPENAI_API_KEY=... pnpm decisions-detect <dir> [dir...] [--projects] [--compare] [--json] [--state] [--request]',
    );
    process.exit(1);
  }

  if (flags.has('--state') || flags.has('--request')) {
    for (const dir of dirs) {
      const input = svc.renderDecisionInput(svc.collectDecisionsScan(dir));
      if (flags.has('--state')) {
        console.log(input);
        continue;
      }
      const questions = specs.map(svc.toApiQuestion);
      const bodies = [];
      for (let i = 0; i < questions.length; i += MAX_QUESTIONS_PER_CALL) {
        bodies.push(
          toSystemOneRequest({
            model: DECISIONS_MODEL,
            input,
            questions: questions.slice(i, i + MAX_QUESTIONS_PER_CALL),
          }),
        );
      }
      console.log(JSON.stringify(bodies, null, 2));
    }
    return;
  }

  const resolved = resolveTransport();
  if (!resolved) {
    console.error(
      'No credential: set WIZARD_CI_GATEWAY_TOKEN_FILE (see docs/local-dev.md) or OPENAI_API_KEY.',
    );
    process.exit(1);
  }
  console.error(`decisions via ${resolved.label}`);

  const compare = flags.has('--compare') || dirs.length > 1;
  const rows: Row[] = [];
  for (const dir of dirs) {
    const scan = svc.collectDecisionsScan(dir);
    const [result, projects] = await Promise.all([
      svc.askDecisions(svc.renderDecisionInput(scan), specs, {
        transport: resolved.transport,
      }),
      flags.has('--projects')
        ? svc.judgeProjects(scan, resolved.transport, {
            targets: integrationTargets,
            recommend: true,
            onError: (message) => console.error(message),
          })
        : Promise.resolve(undefined),
    ]);
    const row: Row = { dir, result, projects };
    if (compare) row.staticFramework = (await detectFramework(dir)) ?? null;
    rows.push(row);
  }

  if (flags.has('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const row of rows) printRow(row);
  }
  if (rows.some((row) => row.result.error)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

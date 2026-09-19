/**
 * Standalone Jev detection runner — the demo / benchmarking entry point.
 * Classifies one or more project dirs with Jev and (optionally) the static
 * detector, without running the wizard.
 *
 * Usage:
 *   TYPESAFE_API_KEY=... pnpm jev-detect <dir> [dir...] [--compare] [--json] [--state] [--md[=path]]
 *
 *   --compare     also run static detectFramework and show agreement
 *   --json        machine-readable output (one JSON object per dir)
 *   --state       print the assembled classifier state and exit (no API call)
 *   --no-descend  skip monorepo descent (per-subdirectory parallel calls)
 *   --md       write a detailed markdown report (distributions, signals,
 *              full report JSON, request state); default path is
 *              scratch/jev-report-<timestamp>.md, override with --md=path
 *
 * Multiple dirs render as a comparison table — point it at a glob of
 * wizard-workbench apps, e.g. "jev-detect .../apps/basic-integration/<fw>/<app>" expanded by the shell.
 */

import path from 'path';
import fs from 'fs';
import {
  detectWithJev,
  sourceHits,
  type JevChoiceAnswer,
  type JevDetectionReport,
} from '@lib/detection/jev/index';
import { assembleProjectState } from '@lib/detection/jev/state';
import { JEV_QUESTIONS } from '@lib/detection/jev/questions';
import { detectFramework } from '@lib/detection/framework';

type Row = {
  dir: string;
  jev: JevDetectionReport | { error: string };
  staticResult?: string | null;
  staticMs?: number;
};

function bar(p: number, width = 20): string {
  return '█'.repeat(Math.max(0, Math.round(p * width))).padEnd(width);
}

function topProbabilities(
  probabilities: Record<string, number>,
  n: number,
): Array<[string, number]> {
  return Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

function printSingle(row: Row): void {
  console.log(`\nJev detection — ${row.dir}\n`);
  if ('error' in row.jev) {
    console.log(`  jev failed: ${row.jev.error}`);
    return;
  }
  const r = row.jev;
  for (const [label, p] of topProbabilities(r.framework.probabilities, 3)) {
    const marker = label === r.framework.choice ? '→' : ' ';
    console.log(
      `  ${marker} framework    ${label.padEnd(18)} ${bar(p)} ${p.toFixed(2)}`,
    );
  }
  console.log(`    confidence   ${r.framework.confidence.toFixed(2)}\n`);
  if (r.variant) {
    console.log(
      `    variant      ${r.variant.choice.padEnd(
        18,
      )} conf ${r.variant.confidence.toFixed(2)} (${r.variant.key})`,
    );
  }
  const dims: Array<[string, { choice: string; confidence: number }]> = [
    ['language', r.language],
    ['package mgr', r.packageManager],
    ['use case', r.useCase],
    ['industry', r.industry],
  ];
  for (const [name, answer] of dims) {
    console.log(
      `    ${name.padEnd(12)} ${answer.choice.padEnd(
        18,
      )} conf ${answer.confidence.toFixed(2)}`,
    );
  }
  const s = r.signals;
  console.log(
    `\n    signals      monorepo ${s.isMonorepo.toFixed(
      2,
    )} · ts ${s.typescript.toFixed(2)} · posthog ${s.hasPosthog.toFixed(
      2,
    )} · stripe ${s.hasStripe.toFixed(2)} · llm ${s.usesLlm.toFixed(
      2,
    )} · auth ${s.hasAuth.toFixed(2)} · web ${s.webFrontend.toFixed(
      2,
    )} · mobile ${s.isMobile.toFixed(2)}`,
  );
  console.log(
    `    logs         structured ${s.structuredLogs.toFixed(
      2,
    )} · opentelemetry ${s.openTelemetry.toFixed(2)}`,
  );
  const fmtHits = (sources: Record<string, number>): string => {
    const hits = sourceHits(sources);
    return hits.length > 0
      ? hits.map(([kind, p]) => `${kind} ${p.toFixed(2)}`).join(' · ')
      : 'none ≥ 0.50';
  };
  console.log(`    frameworks   ${fmtHits(r.frameworkPresence)}`);
  console.log(`    languages    ${fmtHits(r.languagePresence)}`);
  console.log(`    warehouse    ${fmtHits(r.warehouseSources)}`);
  console.log(`    ai/llm       ${fmtHits(r.aiSources)}`);
  if (r.subprojects && r.subprojects.length > 0) {
    console.log(
      `\n    monorepo descent — ${r.subprojects.length} subproject(s):`,
    );
    for (const sub of r.subprojects) {
      const sr = sub.report;
      console.log(
        `      ${sub.path.padEnd(28)} ${sr.framework.choice.padEnd(16)} ${(
          sr.variant?.choice ?? '—'
        ).padEnd(13)} conf ${sr.framework.confidence.toFixed(2)} · ${
          sr.useCase.choice
        }`,
      );
    }
  }
  console.log(
    `\n    ${
      r.model
    } · ${r.usage.inputTokens.toLocaleString()} tokens in · $${r.estCostUsd.toFixed(
      4,
    )} · ${r.durationMs}ms · state ${(r.stateBytes / 1024).toFixed(0)}KB`,
  );
  if (row.staticResult !== undefined) {
    const agree =
      !('error' in row.jev) &&
      row.jev.framework.choice === (row.staticResult ?? 'none');
    console.log(
      `    static       ${(row.staticResult ?? 'none').padEnd(18)} ${
        row.staticMs
      }ms · agreement ${agree ? '✓' : '✗'}`,
    );
  }
}

function printTable(rows: Row[]): void {
  const name = (d: string): string => path.basename(d);
  const width = Math.max(24, ...rows.map((r) => name(r.dir).length + 2));
  const header = `${'app'.padEnd(width)} ${'static'.padEnd(16)} ${'jev'.padEnd(
    18,
  )} ${'variant'.padEnd(13)} conf   agree  ms     tokens   cost`;
  console.log(`\n${header}\n${'─'.repeat(header.length)}`);
  for (const row of rows) {
    const staticLabel = (row.staticResult ?? 'none').padEnd(16);
    if ('error' in row.jev) {
      console.log(
        `${name(row.dir).padEnd(width)} ${staticLabel} error: ${row.jev.error}`,
      );
      continue;
    }
    const r = row.jev;
    const agree = r.framework.choice === (row.staticResult ?? 'none');
    console.log(
      `${name(row.dir).padEnd(
        width,
      )} ${staticLabel} ${r.framework.choice.padEnd(18)} ${(
        r.variant?.choice ?? '—'
      ).padEnd(13)} ${r.framework.confidence.toFixed(2)}   ${
        agree ? '✓' : '✗'
      }      ${String(r.durationMs).padEnd(6)} ${String(tokensOf(r)).padEnd(
        8,
      )} $${costOf(r).toFixed(5)}`,
    );
  }
  const ok = rows.filter(
    (r) =>
      !('error' in r.jev) &&
      r.jev.framework.choice === (r.staticResult ?? 'none'),
  ).length;
  const reports = rows
    .map((r) => r.jev)
    .filter((j): j is JevDetectionReport => !('error' in j));
  const totalTokens = reports.reduce((n, r) => n + tokensOf(r), 0);
  const totalCost = reports.reduce((n, r) => n + costOf(r), 0);
  console.log(
    `\nagreement: ${ok}/${
      rows.length
    } · ${totalTokens.toLocaleString()} input tokens · $${totalCost.toFixed(
      4,
    )} total`,
  );
}

// ── Markdown report ──────────────────────────────────────────────────

function mdProbTable(probabilities: Record<string, number>): string {
  const rows = Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .filter(([, p], i) => i < 2 || p >= 0.005)
    .map(
      ([label, p]) => `| \`${label}\` | ${p.toFixed(3)} | ${bar(p, 24).trim()}`,
    );
  return ['| label | p | |', '| --- | ---: | :-- |', ...rows].join('\n');
}

function mdChoiceSection(name: string, answer: JevChoiceAnswer): string {
  return [
    `#### ${name} → \`${
      answer.choice
    }\` (confidence ${answer.confidence.toFixed(2)})`,
    '',
    mdProbTable(answer.probabilities),
    '',
  ].join('\n');
}

function tokensOf(r: JevDetectionReport): number {
  return (
    r.usage.inputTokens +
    (r.subprojects?.reduce((n, s) => n + s.report.usage.inputTokens, 0) ?? 0)
  );
}

function costOf(r: JevDetectionReport): number {
  return (
    r.estCostUsd +
    (r.subprojects?.reduce((n, s) => n + s.report.estCostUsd, 0) ?? 0)
  );
}

function mdDescentSection(
  subprojects: NonNullable<JevDetectionReport['subprojects']>,
): string {
  const hitList = (sources: Record<string, number>): string =>
    sourceHits(sources)
      .map(([kind, p]) => `${kind} ${p.toFixed(2)}`)
      .join(', ') || '—';
  return [
    `### Monorepo descent (${subprojects.length} subprojects, classified in parallel)`,
    '',
    '| path | framework | variant | conf | use case | warehouse | ai/llm |',
    '| --- | --- | --- | ---: | --- | --- | --- |',
    ...subprojects.map(({ path: p, report: sr }) => {
      return `| \`${p}\` | \`${sr.framework.choice}\` | ${
        sr.variant?.choice ?? '—'
      } | ${sr.framework.confidence.toFixed(2)} | ${
        sr.useCase.choice
      } | ${hitList(sr.warehouseSources)} | ${hitList(sr.aiSources)} |`;
    }),
    '',
    '<details><summary>Subproject reports JSON</summary>',
    '',
    '```json',
    JSON.stringify(subprojects, null, 2),
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
}

function mdSourceSection(
  title: string,
  sources: Record<string, number>,
): string {
  const shown = Object.entries(sources)
    .filter(([, p]) => p >= 0.05)
    .sort(([, a], [, b]) => b - a);
  const hidden = Object.keys(sources).length - shown.length;
  return [
    `### ${title} (noul ≥ 0.05)`,
    '',
    ...(shown.length > 0
      ? [
          '| kind | p |',
          '| --- | ---: |',
          ...shown.map(([kind, p]) => `| ${kind} | ${p.toFixed(3)} |`),
        ]
      : ['_none above 0.05_']),
    '',
    `_${hidden} more kind(s) below 0.05_`,
    '',
  ].join('\n');
}

function mdApp(row: Row): string {
  const app = path.basename(row.dir);
  const lines: string[] = [`## ${app}`, '', `\`${row.dir}\``, ''];
  if ('error' in row.jev) {
    return [...lines, `**Jev call failed:** ${row.jev.error}`, ''].join('\n');
  }
  const r = row.jev;
  const agree =
    row.staticResult === undefined
      ? null
      : r.framework.choice === (row.staticResult ?? 'none');
  lines.push(
    `**framework** \`${
      r.framework.choice
    }\` (confidence ${r.framework.confidence.toFixed(2)})` +
      (r.variant
        ? ` · **variant** \`${r.variant.choice}\` (${
            r.variant.key
          }, ${r.variant.confidence.toFixed(2)})`
        : '') +
      (row.staticResult !== undefined
        ? ` · **static** \`${row.staticResult ?? 'none'}\` ${
            agree ? '✓ agree' : '✗ disagree'
          }`
        : ''),
    '',
    '### Choice distributions',
    '',
    mdChoiceSection('framework', r.framework),
    mdChoiceSection('language', r.language),
    mdChoiceSection('package_manager', r.packageManager),
    mdChoiceSection('use_case', r.useCase),
    mdChoiceSection('industry', r.industry),
    '### Variant answers (speculative — only the matching one is used)',
    '',
    ...Object.entries(r.variants).map(([key, answer]) =>
      mdChoiceSection(key, answer),
    ),
    '### Signals (noul probabilities)',
    '',
    '| signal | p |',
    '| --- | ---: |',
    ...Object.entries(r.signals).map(
      ([key, p]) => `| ${key} | ${p.toFixed(3)} |`,
    ),
    '',
    mdSourceSection(
      'Framework presence (multi-label, independent of the primary choice)',
      r.frameworkPresence,
    ),
    mdSourceSection('Language presence', r.languagePresence),
    mdSourceSection('Warehouse sources', r.warehouseSources),
    mdSourceSection('AI / LLM sources', r.aiSources),
    ...(r.subprojects && r.subprojects.length > 0
      ? [mdDescentSection(r.subprojects)]
      : []),
    '### Call',
    '',
    `model \`${
      r.model
    }\` · ${r.usage.inputTokens.toLocaleString()} tokens in / ${r.usage.outputTokens.toLocaleString()} out · $${r.estCostUsd.toFixed(
      5,
    )} · ${r.durationMs}ms · state ${(r.stateBytes / 1024).toFixed(1)}KB` +
      (row.staticMs !== undefined ? ` · static ${row.staticMs}ms` : ''),
    '',
    '<details><summary>Full report JSON (mapped API response)</summary>',
    '',
    '```json',
    JSON.stringify(r, null, 2),
    '```',
    '',
    '</details>',
    '',
  );
  try {
    const state = assembleProjectState(row.dir);
    lines.push(
      '<details><summary>Request state (what was sent to the API)</summary>',
      '',
      '```json',
      JSON.stringify(state, null, 2),
      '```',
      '',
      '</details>',
      '',
    );
  } catch {
    lines.push('_Request state unavailable (re-assembly failed)._', '');
  }
  return lines.join('\n');
}

function mdReport(rows: Row[]): string {
  const name = (d: string): string => path.basename(d);
  const summary = rows.map((row) => {
    if ('error' in row.jev) {
      return `| ${name(row.dir)} | ${
        row.staticResult ?? ''
      } | _error_ | | | | | | |`;
    }
    const r = row.jev;
    const agree =
      row.staticResult === undefined
        ? ''
        : r.framework.choice === (row.staticResult ?? 'none')
        ? '✓'
        : '✗';
    return `| ${name(row.dir)} | \`${row.staticResult ?? 'none'}\` | \`${
      r.framework.choice
    }\` | ${r.variant?.choice ?? '—'} | ${r.framework.confidence.toFixed(
      2,
    )} | ${agree} | ${r.durationMs} | ${tokensOf(
      r,
    ).toLocaleString()} | $${costOf(r).toFixed(5)} |`;
  });
  const ok = rows.filter(
    (r) =>
      !('error' in r.jev) &&
      r.jev.framework.choice === (r.staticResult ?? 'none'),
  ).length;
  const reports = rows
    .map((r) => r.jev)
    .filter((j): j is JevDetectionReport => !('error' in j));
  const totalTokens = reports.reduce((n, r) => n + tokensOf(r), 0);
  const totalCost = reports.reduce((n, r) => n + costOf(r), 0);
  return [
    '# Jev detection report',
    '',
    `_generated ${new Date().toISOString()} · ${
      rows.length
    } project(s) · static↔jev agreement ${ok}/${
      rows.length
    } · ${totalTokens.toLocaleString()} input tokens · $${totalCost.toFixed(
      4,
    )} total_`,
    '',
    '## Summary',
    '',
    '| app | static | jev | variant | conf | agree | ms | tokens | cost |',
    '| --- | --- | --- | --- | ---: | :-: | ---: | ---: | ---: |',
    ...summary,
    '',
    '## API input',
    '',
    'Every call is one `POST /v1/systemone` with `model: "jev-latest"`, the question catalog below, and a per-project `state` (embedded per app under "Request state").',
    '',
    '<details><summary>Request questions (sent with every call)</summary>',
    '',
    '```json',
    JSON.stringify(JEV_QUESTIONS, null, 2),
    '```',
    '',
    '</details>',
    '',
    ...rows.map(mdApp),
  ].join('\n');
}

function resolveMdPath(mdArg: string): string {
  const custom = mdArg.includes('=') ? mdArg.slice(mdArg.indexOf('=') + 1) : '';
  if (custom) return path.resolve(custom);
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '-')
    .slice(0, 19);
  return path.resolve('scratch', `jev-report-${stamp}.md`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const mdArg = args.find((a) => a === '--md' || a.startsWith('--md='));
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
      'Usage: TYPESAFE_API_KEY=... pnpm jev-detect <dir> [dir...] [--compare] [--json] [--state] [--md[=path]]',
    );
    process.exit(1);
  }

  if (flags.has('--state')) {
    for (const dir of dirs) {
      console.log(JSON.stringify(assembleProjectState(dir), null, 2));
    }
    return;
  }

  const compare = flags.has('--compare') || dirs.length > 1;
  const rows: Row[] = [];
  for (const dir of dirs) {
    const row: Row = {
      dir,
      jev: await detectWithJev(dir, {
        descend: !flags.has('--no-descend'),
      }).catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      })),
    };
    if (compare) {
      const started = Date.now();
      row.staticResult = (await detectFramework(dir)) ?? null;
      row.staticMs = Date.now() - started;
    }
    rows.push(row);
  }

  if (flags.has('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else if (rows.length === 1) {
    printSingle(rows[0]);
  } else {
    printTable(rows);
  }

  if (mdArg) {
    const mdPath = resolveMdPath(mdArg);
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, mdReport(rows));
    console.log(`\nmarkdown report: ${mdPath}`);
  }
}

void main();

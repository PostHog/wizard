/**
 * Standalone Decisions API detection runner, for demos and benchmarking.
 *
 * Usage:
 *   OPENAI_API_KEY=... pnpm decisions-detect <dir> [dir...] [--compare] [--json] [--state] [--no-descend] [--md[=path]]
 *
 *   --compare     also run static detectFramework and show agreement (implied for several dirs)
 *   --json        machine-readable output
 *   --state       print the rendered API input and exit (no API call)
 *   --no-descend  skip monorepo descent
 *   --md          write a markdown report; default scratch/decisions-report-<timestamp>.md
 */

import path from 'path';
import fs from 'fs';
import {
  DECISION_QUESTIONS,
  detectFramework,
  detectWithDecisions,
  renderDecisionInput,
  scanProject,
  sourceHits,
  type DecisionsChoice,
  type DecisionsDetectionReport,
} from '@programs';

type Row = {
  dir: string;
  report: DecisionsDetectionReport | { error: string };
  staticResult?: string | null;
  staticMs?: number;
};

const fmt = (p: number | null | undefined): string =>
  p === null || p === undefined ? ' n/a' : p.toFixed(2);

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

function tokensOf(r: DecisionsDetectionReport): number {
  return (
    r.usage.inputTokens +
    (r.subprojects?.reduce((n, s) => n + s.report.usage.inputTokens, 0) ?? 0)
  );
}

function costOf(r: DecisionsDetectionReport): number {
  return (
    r.estCostUsd +
    (r.subprojects?.reduce((n, s) => n + s.report.estCostUsd, 0) ?? 0)
  );
}

function agrees(row: Row): boolean {
  return (
    !('error' in row.report) &&
    (row.report.framework?.choice ?? 'none') === (row.staticResult ?? 'none')
  );
}

function fmtHits(sources: Record<string, number>): string {
  const hits = sourceHits(sources);
  return hits.length > 0
    ? hits.map(([kind, p]) => `${kind} ${p.toFixed(2)}`).join(' · ')
    : 'none ≥ 0.50';
}

function printSingle(row: Row): void {
  console.log(`\nDecisions detection — ${row.dir}\n`);
  if ('error' in row.report) {
    console.log(`  decisions failed: ${row.report.error}`);
    return;
  }
  const r = row.report;
  if (r.framework) {
    for (const [label, p] of topProbabilities(r.framework.probabilities, 3)) {
      const marker = label === r.framework.choice ? '→' : ' ';
      console.log(
        `  ${marker} framework    ${label.padEnd(18)} ${bar(p)} ${p.toFixed(
          2,
        )}`,
      );
    }
    console.log(`    confidence   ${r.framework.confidence.toFixed(2)}\n`);
  } else {
    console.log('    framework    refused\n');
  }
  if (r.variant) {
    console.log(
      `    variant      ${r.variant.choice.padEnd(18)} p ${fmt(
        r.variant.probability,
      )} (${r.variant.key})`,
    );
  }
  const dims: Array<[string, DecisionsChoice | null]> = [
    ['language', r.language],
    ['package mgr', r.packageManager],
    ['use case', r.useCase],
    ['industry', r.industry],
  ];
  for (const [name, answer] of dims) {
    console.log(
      `    ${name.padEnd(12)} ${(answer?.choice ?? 'refused').padEnd(
        18,
      )} p ${fmt(answer?.probability)}`,
    );
  }
  console.log(
    `\n    signals      ${Object.entries(r.signals)
      .map(([key, p]) => `${key} ${fmt(p)}`)
      .join(' · ')}`,
  );
  console.log(`    frameworks   ${fmtHits(r.frameworkPresence)}`);
  console.log(`    languages    ${fmtHits(r.languagePresence)}`);
  console.log(`    warehouse    ${fmtHits(r.warehouseSources)}`);
  console.log(`    ai/llm       ${fmtHits(r.aiSources)}`);
  if (r.unanswered.length > 0) {
    console.log(`    unanswered   ${r.unanswered.join(', ')}`);
  }
  if (r.subprojects && r.subprojects.length > 0) {
    console.log(
      `\n    monorepo descent — ${r.subprojects.length} subproject(s):`,
    );
    for (const sub of r.subprojects) {
      const sr = sub.report;
      console.log(
        `      ${sub.path.padEnd(28)} ${(
          sr.framework?.choice ?? 'refused'
        ).padEnd(16)} ${(sr.variant?.choice ?? '—').padEnd(13)} p ${fmt(
          sr.framework?.probability,
        )} · ${sr.useCase?.choice ?? '—'}`,
      );
    }
  }
  console.log(
    `\n    ${r.model} · ${r.calls} call(s), ${r.failedCalls} failed · ` +
      `${r.usage.inputTokens.toLocaleString()} tokens in (${r.usage.cachedInputTokens.toLocaleString()} cached) · ` +
      `~$${r.estCostUsd.toFixed(4)} · ${r.durationMs}ms · input ${(
        r.inputBytes / 1024
      ).toFixed(0)}KB`,
  );
  if (row.staticResult !== undefined) {
    console.log(
      `    static       ${(row.staticResult ?? 'none').padEnd(18)} ${String(
        row.staticMs,
      )}ms · agreement ${agrees(row) ? '✓' : '✗'}`,
    );
  }
}

function printTable(rows: Row[]): void {
  const name = (d: string): string => path.basename(d);
  const width = Math.max(24, ...rows.map((r) => name(r.dir).length + 2));
  const header = `${'app'.padEnd(width)} ${'static'.padEnd(
    16,
  )} ${'decisions'.padEnd(18)} ${'variant'.padEnd(
    13,
  )} p      agree  ms     tokens   cost`;
  console.log(`\n${header}\n${'─'.repeat(header.length)}`);
  for (const row of rows) {
    const staticLabel = (row.staticResult ?? 'none').padEnd(16);
    if ('error' in row.report) {
      console.log(
        `${name(row.dir).padEnd(width)} ${staticLabel} error: ${
          row.report.error
        }`,
      );
      continue;
    }
    const r = row.report;
    console.log(
      `${name(row.dir).padEnd(width)} ${staticLabel} ${(
        r.framework?.choice ?? 'refused'
      ).padEnd(18)} ${(r.variant?.choice ?? '—').padEnd(13)} ${fmt(
        r.framework?.probability,
      )}   ${agrees(row) ? '✓' : '✗'}      ${String(r.durationMs).padEnd(
        6,
      )} ${String(tokensOf(r)).padEnd(8)} $${costOf(r).toFixed(5)}`,
    );
  }
  console.log(`\n${totalsLine(rows)}`);
}

function totalsLine(rows: Row[]): string {
  const reports = rows
    .map((r) => r.report)
    .filter((r): r is DecisionsDetectionReport => !('error' in r));
  const totalTokens = reports.reduce((n, r) => n + tokensOf(r), 0);
  const totalCost = reports.reduce((n, r) => n + costOf(r), 0);
  return `agreement: ${rows.filter(agrees).length}/${
    rows.length
  } · ${totalTokens.toLocaleString()} input tokens · ~$${totalCost.toFixed(
    4,
  )} total`;
}

function mdProbTable(probabilities: Record<string, number>): string {
  const rows = Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .filter(([, p], i) => i < 2 || p >= 0.005)
    .map(
      ([label, p]) => `| \`${label}\` | ${p.toFixed(3)} | ${bar(p, 24).trim()}`,
    );
  return ['| value | p | |', '| --- | ---: | :-- |', ...rows].join('\n');
}

function mdChoice(name: string, answer: DecisionsChoice | null): string {
  if (!answer) return `#### ${name} → _refused_\n`;
  return [
    `#### ${name} → \`${answer.choice}\` (p ${answer.probability.toFixed(
      2,
    )}, confidence ${answer.confidence.toFixed(2)})`,
    '',
    mdProbTable(answer.probabilities),
    '',
  ].join('\n');
}

function mdSources(title: string, sources: Record<string, number>): string {
  const shown = Object.entries(sources)
    .filter(([, p]) => p >= 0.05)
    .sort(([, a], [, b]) => b - a);
  return [
    `### ${title} (p ≥ 0.05)`,
    '',
    ...(shown.length > 0
      ? [
          '| kind | p |',
          '| --- | ---: |',
          ...shown.map(([kind, p]) => `| ${kind} | ${p.toFixed(3)} |`),
        ]
      : ['_none above 0.05_']),
    '',
  ].join('\n');
}

function mdDetails(summary: string, value: unknown): string[] {
  return [
    `<details><summary>${summary}</summary>`,
    '',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
    '',
    '</details>',
    '',
  ];
}

function mdApp(row: Row): string {
  const lines: string[] = [
    `## ${path.basename(row.dir)}`,
    '',
    `\`${row.dir}\``,
    '',
  ];
  if ('error' in row.report) {
    return [
      ...lines,
      `**Decisions call failed:** ${row.report.error}`,
      '',
    ].join('\n');
  }
  const r = row.report;
  lines.push(
    `**framework** \`${r.framework?.choice ?? 'refused'}\` (p ${fmt(
      r.framework?.probability,
    )})` +
      (r.variant
        ? ` · **variant** \`${r.variant.choice}\` (${r.variant.key}, p ${fmt(
            r.variant.probability,
          )})`
        : '') +
      (row.staticResult !== undefined
        ? ` · **static** \`${row.staticResult ?? 'none'}\` ${
            agrees(row) ? '✓ agree' : '✗ disagree'
          }`
        : ''),
    '',
    '### Choice distributions',
    '',
    mdChoice('framework', r.framework),
    mdChoice('language', r.language),
    mdChoice('package_manager', r.packageManager),
    mdChoice('use_case', r.useCase),
    mdChoice('industry', r.industry),
    '### Variant answers (speculative; only the matching one is used)',
    '',
    ...Object.entries(r.variants).map(([key, answer]) =>
      mdChoice(key, answer ?? null),
    ),
    '### Signals',
    '',
    '| signal | p |',
    '| --- | ---: |',
    ...Object.entries(r.signals).map(([key, p]) => `| ${key} | ${fmt(p)} |`),
    '',
    mdSources('Framework presence', r.frameworkPresence),
    mdSources('Language presence', r.languagePresence),
    mdSources('Warehouse sources', r.warehouseSources),
    mdSources('AI / LLM sources', r.aiSources),
    ...(r.unanswered.length > 0
      ? [`**Unanswered:** ${r.unanswered.join(', ')}`, '']
      : []),
    '### Call',
    '',
    `model \`${r.model}\` · ${r.calls} call(s), ${r.failedCalls} failed · ` +
      `${r.usage.inputTokens.toLocaleString()} tokens in (${r.usage.cachedInputTokens.toLocaleString()} cached) / ` +
      `${r.usage.outputTokens.toLocaleString()} out · ~$${r.estCostUsd.toFixed(
        5,
      )} · ${r.durationMs}ms` +
      (row.staticMs !== undefined ? ` · static ${row.staticMs}ms` : ''),
    '',
    ...mdDetails('Full report JSON', r),
    ...mdDetails(
      'Request input',
      renderDecisionInput(scanProject(row.dir).state),
    ),
  );
  return lines.join('\n');
}

function mdReport(rows: Row[]): string {
  const name = (d: string): string => path.basename(d);
  const summary = rows.map((row) => {
    if ('error' in row.report)
      return `| ${name(row.dir)} | ${
        row.staticResult ?? ''
      } | _error_ | | | | | | |`;
    const r = row.report;
    const agree = row.staticResult === undefined ? '' : agrees(row) ? '✓' : '✗';
    return `| ${name(row.dir)} | \`${row.staticResult ?? 'none'}\` | \`${
      r.framework?.choice ?? 'refused'
    }\` | ${r.variant?.choice ?? '—'} | ${fmt(
      r.framework?.probability,
    )} | ${agree} | ${r.durationMs} | ${tokensOf(
      r,
    ).toLocaleString()} | $${costOf(r).toFixed(5)} |`;
  });
  return [
    '# Decisions API detection report',
    '',
    `_generated ${new Date().toISOString()} · ${
      rows.length
    } project(s) · ${totalsLine(rows)}_`,
    '',
    '## Summary',
    '',
    '| app | static | decisions | variant | p | agree | ms | tokens | cost |',
    '| --- | --- | --- | --- | ---: | :-: | ---: | ---: | ---: |',
    ...summary,
    '',
    '## API input',
    '',
    'Each project is `POST /v1/decisions` calls sharing one rendered input, with the questions below split into batches.',
    '',
    ...mdDetails('Request questions', DECISION_QUESTIONS),
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
  return path.resolve('scratch', `decisions-report-${stamp}.md`);
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
      'Usage: OPENAI_API_KEY=... pnpm decisions-detect <dir> [dir...] [--compare] [--json] [--state] [--no-descend] [--md[=path]]',
    );
    process.exit(1);
  }

  if (flags.has('--state')) {
    for (const dir of dirs) {
      console.log(
        JSON.stringify(renderDecisionInput(scanProject(dir).state), null, 2),
      );
    }
    return;
  }

  const compare = flags.has('--compare') || dirs.length > 1;
  const rows: Row[] = [];
  for (const dir of dirs) {
    const row: Row = {
      dir,
      report: await detectWithDecisions(dir, {
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

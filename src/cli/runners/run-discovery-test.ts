/** Test discovery mode (`--test-discovery`): print what a run knows about the repo before login, then exit. */
import fs from 'fs';
import path from 'path';
import type {
  DiscoveryTestProject,
  DiscoveryTestReport,
  ProgramConfig,
} from '@programs/types';
import { runtimeEnv } from '@env';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import { replaceUnsafeChars } from '@utils/env-scan';
import type { CloudRegion } from '@utils/types';
import { tuiSessionArgs } from './run-wizard';
import { exitWith } from './signals';

/** Whether the command line asked for test discovery mode. */
export function wantsDiscoveryTest(options: Record<string, unknown>): boolean {
  return options.testDiscovery !== undefined;
}

/** The report's format: JSON when the mode asks for it, or when the file it is saved to is a `.json` one. */
export function discoveryTestFormat(
  mode: unknown,
  file?: string,
): 'json' | 'text' {
  return mode === 'json' || file?.toLowerCase().endsWith('.json')
    ? 'json'
    : 'text';
}

/** The files to save the report to: `--test-discovery-out`, once or repeated. */
export function discoveryTestFiles(options: Record<string, unknown>): string[] {
  return [options.testDiscoveryOut]
    .flat()
    .filter((out): out is string => typeof out === 'string' && out !== '');
}

const pad = (label: string, width = 18): string => label.padEnd(width);

/** A value from the repo as terminal text: control characters replaced, so a file name cannot send an escape sequence. JSON output escapes them itself. */
const clean = (value: unknown): string => replaceUnsafeChars(String(value));

const show = (value: unknown): string =>
  Array.isArray(value) ? value.map(clean).join(', ') : clean(value);

type Claims = NonNullable<
  DiscoveryTestProject['sources'][keyof DiscoveryTestProject['sources']]
>;

/** One source as the report names it: its name, and its confidence when it gives one. */
const sourceLabel = (claim: Claims[number]): string =>
  claim.confidence === undefined
    ? claim.source
    : `${claim.source} ${claim.confidence.toFixed(2)}`;

/** Where a trait's value came from: the sources that gave it, then in brackets any source that said otherwise. */
function sourceColumn(value: unknown, claims: Claims): string {
  const used = show(value);
  const gave = claims.filter((claim) => show(claim.value) === used);
  const others = claims.filter((claim) => show(claim.value) !== used);
  return [
    gave.map(sourceLabel).join(', ') || '-',
    ...others.map((claim) => {
      const said = `${claim.source} said ${show(claim.value)}`;
      return claim.confidence === undefined
        ? `[${said}]`
        : `[${said}, ${claim.confidence.toFixed(2)}]`;
    }),
  ].join('  ');
}

/** The widest value column the report gives a project's traits. */
const MAX_VALUE_WIDTH = 44;

function projectLines(project: DiscoveryTestProject): string[] {
  const title = project.path === '.' ? '. (root)' : clean(project.path);
  const lines = [`  ${title}${project.isRunProject ? '  <- run project' : ''}`];
  const traits = Object.entries(project.traits);
  const width = Math.min(
    MAX_VALUE_WIDTH,
    Math.max('Value'.length, ...traits.map(([, value]) => show(value).length)),
  );
  if (traits.length > 0) {
    lines.push(`    ${pad('Trait')} ${pad('Value', width)}  Source`);
  }
  for (const [name, value] of traits) {
    const claims = project.sources[name as keyof typeof project.sources] ?? [];
    const unsettled = project.unsettled?.includes(name as never)
      ? '  (unsettled)'
      : '';
    lines.push(
      `    ${pad(name)} ${pad(show(value), width)}  ${sourceColumn(
        value,
        claims,
      )}${unsettled}`,
    );
  }
  if (traits.length === 0) lines.push('    (no traits)');
  if (project.tools.length > 0) {
    lines.push(`    ${pad('tools')} ${project.tools.join(', ')}`);
  }
  return lines;
}

/** Which sources the preview ran, and what the Decisions call did. */
function sourceLines(decisions: DiscoveryTestReport['decisions']): string[] {
  const agentic = `  ${pad('Agentic')} not run: it answers after login`;
  if (!decisions.asked) {
    return [
      `  ${pad('Sources')} static only`,
      `  ${pad('Decisions')} not asked: ${decisions.reason}`,
      agentic,
    ];
  }
  const outcome = `${decisions.answered} of ${decisions.total} answered in ${
    decisions.durationMs
  } ms, ${decisions.inputTokens} input tokens${
    decisions.error ? `, error: ${decisions.error}` : ''
  }`;
  return [
    `  ${pad('Sources')} ${
      decisions.answered > 0 ? 'static and decisions' : 'static only'
    }`,
    `  ${pad('Decisions')} ${decisions.model}, ${
      decisions.use === 'traits'
        ? 'written as traits'
        : 'compared only, not written as traits'
    }: ${outcome}`,
    agentic,
  ];
}

/** The Decisions answers, one per line: a predicate's probability, or a choice with its probability. */
function decisionLines(decisions: DiscoveryTestReport['decisions']): string[] {
  if (!decisions.asked || decisions.answered === 0) return [];
  return [
    '',
    `Decisions answers (${decisions.model}): a probability, or a choice and its probability`,
    ...Object.entries(decisions.answers).map(
      ([name, answer]) => `  ${pad(name, 24)} ${show(answer)}`,
    ),
  ];
}

/** The report as text: the repo, each project's traits with their sources, and the project selection. */
export function formatDiscoveryTest(report: DiscoveryTestReport): string {
  const { walk, detection, projectSelection } = report;
  const lines = [
    `Project discovery, test mode: ${report.program}`,
    '',
    `  ${pad('Flag')} wizard-project-discovery = ${report.mode}`,
    `  ${pad('Run directory')} ${report.runDir}`,
    `  ${pad('Workspace root')} ${
      report.rootDir === report.runDir ? '(the run directory)' : report.rootDir
    }`,
    `  ${pad('Run project')} ${clean(report.runProject)}`,
    `  ${pad('Repo')} ${report.repoType}${
      report.workspaceTool ? `, ${report.workspaceTool}` : ''
    }`,
    `  ${pad('Walk')} ${walk.files} files kept${
      walk.truncated ? ', tree truncated' : ''
    }${walk.complete ? '' : ', walk incomplete'}`,
    `  ${pad('Detection')} ${detection.integration ?? 'no framework'}${
      detection.label ? ` (${detection.label})` : ''
    }, PostHog ${detection.posthogSdkDetected ? 'detected' : 'not detected'}`,
    `  ${pad('Match keys')} ${
      Object.entries(report.matchKeys)
        .map(([key, values]) => `${key}:${(values ?? []).join('|')}`)
        .join('  ') || '(none)'
    }`,
    `  ${pad('Tools')} ${
      report.toolsMatched ? 'matched' : 'not matched: no tool catalog'
    }`,
    ...sourceLines(report.decisions),
    '',
    `Projects (${report.projects.length}): the value a run uses and the source it came from. A source that said otherwise follows in brackets.`,
    ...report.projects.flatMap(projectLines),
    ...decisionLines(report.decisions),
    '',
    `Project selection for ${report.program}: ${
      report.mode === 'off'
        ? `not used while the flag is off; the run works in ${clean(
            projectSelection.selectedProjectPath,
          )}`
        : `${
            projectSelection.asks ? 'asks after login' : 'asks nothing'
          }, picks ${clean(projectSelection.selectedProjectPath)}`
    }`,
    ...projectSelection.projects.map((project) => {
      const mark =
        project.path === projectSelection.selectedProjectPath ? '*' : ' ';
      const detail = [
        project.frameworkName,
        project.isMainApp ? 'main app' : undefined,
        project.eligible
          ? undefined
          : `not eligible: ${project.exclusionReason ?? ''}`,
      ].filter((part): part is string => part !== undefined);
      return `  ${mark} ${pad(clean(project.path), 24)} ${detail.join(', ')}`;
    }),
  ];
  // Every line: the run directory and the workspace root come from the machine too.
  return lines.map(clean).join('\n');
}

/**
 * Run discovery and the program's own detection with no login and no agent,
 * print the report as text or JSON, or save it to a file, and exit. Nothing is
 * set up.
 */
export function runDiscoveryTest(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  exitWith(async () => {
    const { testDiscovery } = await import('@programs');
    // As the run would start: its real CI setting and the last `--project`.
    const project = [options.project].flat().at(-1) as string | undefined;
    // A pre-issued gateway token lets the preview ask Decisions, with no PostHog login.
    const gateway = runtimeEnv('WIZARD_CI_GATEWAY_TOKEN_FILE')
      ? readCiGatewayCredential(
          (options.region as CloudRegion | undefined) ?? 'us',
        )
      : undefined;
    const report = await testDiscovery(
      config,
      { ...tuiSessionArgs(options), ci: options.ci === true },
      project,
      gateway,
    );
    const render = (file?: string): string =>
      discoveryTestFormat(options.testDiscovery, file) === 'json'
        ? JSON.stringify(report, null, 2)
        : formatDiscoveryTest(report);
    const files = discoveryTestFiles(options);
    for (const out of files) {
      // A relative path is from the directory the command ran in.
      const file = path.resolve(out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${render(file)}\n`);
      process.stdout.write(`Saved the report to ${file}\n`);
    }
    if (files.length === 0) process.stdout.write(`${render()}\n`);
    return 0;
  });
}

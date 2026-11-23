/** Test discovery mode (`--test-discovery`): print what a run knows about the repo before login, then exit. */
import type {
  DiscoveryTestProject,
  DiscoveryTestReport,
  ProgramConfig,
} from '@programs/types';
import { replaceUnsafeChars } from '@utils/env-scan';
import { tuiSessionArgs } from './run-wizard';
import { exitWith } from './signals';

/** Whether the command line asked for test discovery mode. */
export function wantsDiscoveryTest(options: Record<string, unknown>): boolean {
  return options.testDiscovery !== undefined;
}

const pad = (label: string, width = 18): string => label.padEnd(width);

/** A value from the repo as terminal text: control characters replaced, so a file name cannot send an escape sequence. JSON output escapes them itself. */
const clean = (value: unknown): string => replaceUnsafeChars(String(value));

const show = (value: unknown): string =>
  Array.isArray(value) ? value.map(clean).join(', ') : clean(value);

function projectLines(project: DiscoveryTestProject): string[] {
  const title = project.path === '.' ? '. (root)' : clean(project.path);
  const lines = [`  ${title}${project.isRunProject ? '  <- run project' : ''}`];
  for (const [name, value] of Object.entries(project.traits)) {
    const claims = project.sources[name as keyof typeof project.sources] ?? [];
    const sources = claims
      .map((claim) =>
        claim.confidence === undefined
          ? `${claim.source}=${show(claim.value)}`
          : `${claim.source}=${show(claim.value)}@${claim.confidence.toFixed(
              2,
            )}`,
      )
      .join('  ');
    const unsettled = project.unsettled?.includes(name as never)
      ? '  (unsettled)'
      : '';
    lines.push(
      `    ${pad(name)} ${pad(show(value), 22)} ${sources}${unsettled}`,
    );
  }
  if (Object.keys(project.traits).length === 0) lines.push('    (no traits)');
  if (project.tools.length > 0) {
    lines.push(`    ${pad('tools')} ${project.tools.join(', ')}`);
  }
  return lines;
}

/** The report as text: the repo, each project's traits with their sources, and the plan. */
export function formatDiscoveryTest(report: DiscoveryTestReport): string {
  const { walk, detection, plan } = report;
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
    '',
    `Projects (${report.projects.length}): trait, value a run uses, then each source's value`,
    ...report.projects.flatMap(projectLines),
    '',
    `Plan for ${report.program}: ${
      report.mode === 'off'
        ? `not used while the flag is off; the run works in ${clean(
            plan.picked,
          )}`
        : `${plan.asks ? 'asks after login' : 'asks nothing'}, picks ${clean(
            plan.picked,
          )}`
    }`,
    ...plan.projects.map((project) => {
      const mark = project.path === plan.picked ? '*' : ' ';
      const detail = [
        project.frameworkName,
        project.mainApp ? 'main app' : undefined,
        project.offered ? undefined : `not offered: ${project.reason ?? ''}`,
      ].filter((part): part is string => part !== undefined);
      return `  ${mark} ${pad(clean(project.path), 24)} ${detail.join(', ')}`;
    }),
  ];
  // Every line: the run directory and the workspace root come from the machine too.
  return lines.map(clean).join('\n');
}

/**
 * Run discovery and the program's own detection with no login and no agent,
 * print the report as text or JSON, and exit. Nothing is set up.
 */
export function runDiscoveryTest(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  exitWith(async () => {
    const { testDiscovery } = await import('@programs');
    const report = await testDiscovery(config, tuiSessionArgs(options));
    const text =
      options.testDiscovery === 'json'
        ? JSON.stringify(report, null, 2)
        : formatDiscoveryTest(report);
    process.stdout.write(`${text}\n`);
    return 0;
  });
}

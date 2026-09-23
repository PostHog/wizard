/**
 * Proves the layer configs reject each forbidden import. Each probe is a
 * virtual file compiled inside one layer's project against the other layers'
 * built declarations (run after `tsc -b tsconfig.layers.json`). A probe that
 * should fail must produce an error in the probe file; one that should pass
 * must produce none.
 */
import * as path from 'node:path';
import * as ts from 'typescript';

type Probe = {
  layer: string;
  name: string;
  source: string;
  expect: 'error' | 'ok';
};

const LAYER_CONFIGS: Record<string, string> = {
  env: 'src/tsconfig.env.layer.json',
  shared: 'src/shared/tsconfig.layer.json',
  agent: 'src/agent/tsconfig.layer.json',
  programs: 'src/programs/tsconfig.layer.json',
  tui: 'src/tui/tsconfig.layer.json',
  headless: 'src/headless/tsconfig.layer.json',
  cli: 'src/cli/tsconfig.layer.json',
};

const PROBES: Probe[] = [
  // The A3 bypass: shared and env reaching the agent's runtime entry.
  {
    layer: 'shared',
    name: 'shared imports @agent',
    source: "import { runAgent } from '@agent';\nexport const x = runAgent;",
    expect: 'error',
  },
  {
    layer: 'shared',
    name: 'shared imports the agent entry by path',
    source:
      "import { runAgent } from '../agent/index';\nexport const x = runAgent;",
    expect: 'error',
  },
  {
    layer: 'shared',
    name: 'shared imports agent types',
    source:
      "import type { AgentProgress } from '@agent/types';\nexport type X = AgentProgress;",
    expect: 'error',
  },
  {
    layer: 'env',
    name: 'env imports shared',
    source:
      "import { POSTHOG_DOCS_URL } from '@shared/constants';\nexport const x = POSTHOG_DOCS_URL;",
    expect: 'error',
  },
  // The matrix, by alias, by path, by dynamic import and by type query.
  {
    layer: 'agent',
    name: 'agent imports programs',
    source:
      "import { PROGRAM_REGISTRY } from '@programs';\nexport const x = PROGRAM_REGISTRY;",
    expect: 'error',
  },
  {
    layer: 'programs',
    name: 'programs imports the TUI',
    source:
      "import { WizardStore } from '@tui';\nexport const x = WizardStore;",
    expect: 'error',
  },
  {
    layer: 'programs',
    name: 'programs imports the TUI store by path',
    source:
      "import { WizardStore } from '../tui/store';\nexport const x = WizardStore;",
    expect: 'error',
  },
  {
    layer: 'programs',
    name: 'programs type-queries the TUI',
    source: "export type X = import('../tui/store').WizardStore;",
    expect: 'error',
  },
  {
    layer: 'programs',
    name: 'programs dynamic-imports the CLI',
    source: "export const x = () => import('../cli/ui');",
    expect: 'error',
  },
  {
    layer: 'headless',
    name: 'headless imports the TUI',
    source:
      "import { WizardStore } from '@tui';\nexport const x = WizardStore;",
    expect: 'error',
  },
  {
    layer: 'tui',
    name: 'tui imports headless',
    source:
      "import { LoggingUI } from '@headless';\nexport const x = LoggingUI;",
    expect: 'error',
  },
  {
    layer: 'tui',
    name: 'tui imports the CLI',
    source: "export const x = () => import('../cli/ui');",
    expect: 'error',
  },
  // Public entries only.
  {
    layer: 'programs',
    name: 'programs deep-imports the agent by alias',
    source:
      "import { runAgent } from '@agent/runner/index';\nexport const x = runAgent;",
    expect: 'error',
  },
  {
    layer: 'programs',
    name: 'programs deep-imports the agent by path',
    source:
      "import { runAgent } from '../agent/runner/index';\nexport const x = runAgent;",
    expect: 'error',
  },
  {
    layer: 'cli',
    name: 'cli deep-imports the TUI store',
    source:
      "import { WizardStore } from '@tui/store';\nexport const x = WizardStore;",
    expect: 'error',
  },
  {
    layer: 'agent',
    name: 'agent imports itself by alias',
    source:
      "import { OutroKind } from '@agent/progress';\nexport const x = OutroKind;",
    expect: 'error',
  },
  // Types-only access.
  {
    layer: 'tui',
    name: 'tui takes a value from @agent/types',
    source:
      "import { runAgent } from '@agent/types';\nexport const x = runAgent;",
    expect: 'error',
  },
  {
    layer: 'tui',
    name: 'tui imports the agent runtime entry',
    source: "import { runAgent } from '@agent';\nexport const x = runAgent;",
    expect: 'error',
  },
  {
    layer: 'tui',
    name: 'tui takes a type from @agent/types',
    source:
      "import type { AgentProgress } from '@agent/types';\nexport type X = AgentProgress;",
    expect: 'ok',
  },
  // Ink only in the TUI.
  {
    layer: 'programs',
    name: 'programs imports ink',
    source: "import { Box } from 'ink';\nexport const x = Box;",
    expect: 'error',
  },
  {
    layer: 'cli',
    name: 'cli imports react',
    source:
      "import { createElement } from 'react';\nexport const x = createElement;",
    expect: 'error',
  },
  {
    layer: 'tui',
    name: 'tui imports ink',
    source: "import { Box } from 'ink';\nexport const x = Box;",
    expect: 'ok',
  },
  // The permitted edges still compile.
  {
    layer: 'programs',
    name: 'programs imports the agent entry',
    source: "import { runAgent } from '@agent';\nexport const x = runAgent;",
    expect: 'ok',
  },
  {
    layer: 'cli',
    name: 'cli imports the TUI entry',
    source:
      "import { WizardStore } from '@tui';\nexport const x = WizardStore;",
    expect: 'ok',
  },
  {
    layer: 'agent',
    name: 'agent imports shared deep',
    source:
      "import { POSTHOG_DOCS_URL } from '@shared/constants';\nexport const x = POSTHOG_DOCS_URL;",
    expect: 'ok',
  },
];

function compile(probe: Probe): readonly ts.Diagnostic[] {
  const configPath = path.resolve(LAYER_CONFIGS[probe.layer]);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error(`cannot read ${configPath}`);
  const probePath = path.join(
    path.dirname(configPath),
    '__boundary_probe__.ts',
  );
  const options = { ...parsed.options, noEmit: true, incremental: false };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (f) =>
    path.resolve(f) === probePath ? probe.source : readFile(f);
  host.fileExists = (f) => path.resolve(f) === probePath || fileExists(f);
  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, probePath],
    options,
    host,
    projectReferences: parsed.projectReferences,
  });
  const file = program.getSourceFile(probePath);
  if (!file) throw new Error('probe did not load');
  return [
    ...program.getSyntacticDiagnostics(file),
    ...program.getSemanticDiagnostics(file),
    ...program
      .getOptionsDiagnostics()
      .filter((d) => d.file?.fileName === probePath),
    ...program
      .getGlobalDiagnostics()
      .filter((d) => d.file && path.resolve(d.file.fileName) === probePath),
  ];
}

let failures = 0;
for (const probe of PROBES) {
  const errors = compile(probe).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  const ok = probe.expect === 'error' ? errors.length > 0 : errors.length === 0;
  const detail = errors[0]
    ? ` (TS${errors[0].code}: ${ts
        .flattenDiagnosticMessageText(errors[0].messageText, ' ')
        .slice(0, 90)})`
    : '';
  process.stdout.write(
    `${ok ? 'ok  ' : 'FAIL'} ${probe.layer}: ${probe.name}${detail}\n`,
  );
  if (!ok) failures += 1;
}
if (failures > 0) {
  process.stderr.write(
    `${failures} boundary probe(s) did not behave as expected\n`,
  );
  process.exit(1);
}

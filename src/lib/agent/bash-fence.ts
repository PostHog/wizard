/**
 * Bash command fence: exact per-manager allowlists + shell-shape gates.
 *
 * In effect this gates the pi harness only — on the Anthropic arm `Bash` is
 * pre-allowed (BASE_ALLOWED_TOOLS), so canUseTool never sees it and the SDK's
 * OS sandbox + YARA hooks gate execution instead. pi has no OS sandbox yet,
 * so this string fence is its only execution gate.
 *
 * Threat model: the agent can already Write project files, so commands that
 * execute project-defined code (installs, builds) are equivalent risk by
 * construction. The fence must prevent: direct arbitrary shell, outward
 * registry actions (publish/push/deploy), arbitrary-package execution
 * (`npx <anything>` downloads and runs it), and shell injection. Matching is
 * token-exact per manager — keyword prefixes admitted `npm publish` via `pub`.
 */
import { LINTING_TOOLS } from '@lib/safe-tools';

export type BashFenceDecision =
  | { allowed: true }
  | { allowed: false; message: string; analyticsReason: string };

const NODE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const GRADLE_MANAGERS = new Set(['gradle', 'gradlew', './gradlew']);
const MAVEN_MANAGERS = new Set(['mvn', 'mvnw', './mvnw']);

const NODE_SUBCOMMANDS = [
  'install',
  'i',
  'ci',
  'add',
  'remove',
  'uninstall',
  'update',
  'view',
];

// Build/verify script names: exact or `name:variant` (build:prod). No kebab
// continuations — `npm install-test` runs tests, `update-notifier` is not update.
const NODE_SCRIPT_NAMES = [
  'build',
  'lint',
  'format',
  'tsc',
  'typecheck',
  'type-check',
  'check-types',
  'types',
];

// npx executes the named registry package, so exact curated names only —
// `npx build` would run whoever owns the `build` package name.
const NPX_TOOLS = new Set([
  ...LINTING_TOOLS,
  'tsc',
  'expo',
  'pod-install',
  'cap',
]);

const PIP_SUBCOMMANDS = ['install', 'uninstall', 'show', 'list', 'index'];
const BUNDLE_SUBCOMMANDS = ['install', 'add', 'remove', 'update', 'show'];
const MAVEN_GOALS = [
  'install',
  'compile',
  'package',
  'verify',
  'dependency:tree',
];

/** Managers whose first subcommand is checked exactly against a fixed set. */
const SIMPLE_MANAGERS: Record<string, readonly string[]> = {
  pip: PIP_SUBCOMMANDS,
  pip3: PIP_SUBCOMMANDS,
  poetry: ['install', 'add', 'remove', 'show', 'lock', 'update'],
  pipenv: ['install', 'uninstall'],
  uv: ['add', 'remove', 'sync'], // `uv pip <sub>` handled separately
  pdm: ['install', 'add', 'remove'],
  conda: ['install', 'remove'],
  composer: ['install', 'require', 'update', 'remove', 'show'],
  bundle: BUNDLE_SUBCOMMANDS, // `bundle exec <lint tool>` handled separately
  bundler: BUNDLE_SUBCOMMANDS,
  gem: ['install', 'uninstall', 'list', 'search'],
  swift: ['package', 'build'],
  pod: ['install', 'update', 'search'],
  carthage: ['bootstrap', 'update'],
};

// Gradle tasks are verb-anchored camelCase: assembleDebug yes, publishToMavenCentral no.
const GRADLE_EXACT_TASKS = new Set(['build', 'clean', 'dependencies']);
const GRADLE_TASK_VERBS = ['assemble', 'compile', 'bundle', 'lint'];

// xcodebuild's action follows its flags, and flag values are bare tokens, so a
// positive action list is unparseable; only the test actions are out of contract.
const XCODEBUILD_DENIED_ACTIONS = new Set(['test', 'test-without-building']);

const DANGEROUS_OPERATORS = /[;`$()]/;

const ALLOWED_TOOLS_SUMMARY =
  'Allowed: npm/pnpm/yarn/bun (install|i|ci|add|remove|uninstall|update|view, run <build/lint/typecheck script>), ' +
  'npx <lint tool|tsc|expo|pod-install|cap>, pip/pip3/poetry/pipenv/uv/pdm/conda (install/add/remove/...), ' +
  'composer (install|require|update|remove|show), bundle (install|add|remove|update|show|exec <lint tool>), ' +
  'gem (install|uninstall|list|search), swift (package|build), pod (install|update|search), carthage (bootstrap|update), ' +
  'xcodebuild (build/clean/archive actions), gradle/gradlew (build|clean|dependencies|assemble*/compile*/bundle*/lint* tasks), ' +
  'mvn (install|compile|package|verify|dependency:tree).';

function deny(analyticsReason: string, message: string): BashFenceDecision {
  return { allowed: false, message, analyticsReason };
}

function denyCommand(command: string, feedback: string): BashFenceDecision {
  const shown = command.length > 120 ? command.slice(0, 117) + '...' : command;
  return deny(
    'not in allowlist',
    `Bash command not allowed: \`${shown}\`. ${feedback}`,
  );
}

function isNodeScriptName(token: string): boolean {
  return NODE_SCRIPT_NAMES.some(
    (name) => token === name || token.startsWith(name + ':'),
  );
}

function isLintingTool(token: string): boolean {
  return LINTING_TOOLS.includes(token) || token === 'tsc';
}

function nodeDecision(parts: string[], command: string): BashFenceDecision {
  const bin = parts[0];
  let i = 1;
  if (bin === 'yarn' && parts[i] === 'workspace' && parts[i + 1]) i += 2;
  // Monorepo workspace-scoping flags may precede the subcommand.
  for (;;) {
    const t = parts[i];
    if (t === '-r' || t === '--recursive') {
      i++;
    } else if (
      t &&
      (t.startsWith('--filter=') || t.startsWith('--workspace='))
    ) {
      i++;
    } else if (
      (t === '--filter' ||
        t === '--workspace' ||
        (t === '-w' && bin === 'npm')) &&
      parts[i + 1]
    ) {
      i += 2;
    } else if (t === '-w' && bin === 'pnpm') {
      i++;
    } else {
      break;
    }
  }
  const sub = parts[i];
  const feedback = `Allowed ${bin} usage: ${bin} ${NODE_SUBCOMMANDS.join(
    '|',
  )} [args], ${bin} run <script named ${NODE_SCRIPT_NAMES.join(
    '/',
  )}>, ${bin} exec <lint tool>, or ${bin} <that script name or lint tool> directly.`;
  if (!sub) return denyCommand(command, feedback);
  if (sub === 'run') {
    const target = parts[i + 1];
    if (target && isNodeScriptName(target)) return { allowed: true };
    return denyCommand(command, feedback);
  }
  if (sub === 'exec') {
    const target = parts[i + 1];
    if (target && isLintingTool(target)) return { allowed: true };
    return denyCommand(command, feedback);
  }
  if (NODE_SUBCOMMANDS.includes(sub)) return { allowed: true };
  if (isNodeScriptName(sub) || isLintingTool(sub)) return { allowed: true };
  return denyCommand(command, feedback);
}

function npxDecision(parts: string[], command: string): BashFenceDecision {
  const target = parts[1];
  // No flags before the tool: -p/--package aliases an arbitrary package.
  if (!target || target.startsWith('-')) {
    return denyCommand(
      command,
      'npx may only run a known tool directly: tsc, expo, pod-install, cap, or a lint/format tool (eslint, prettier, biome, ...).',
    );
  }
  const name = target.replace(/@[^@/]*$/, ''); // eslint@8 -> eslint
  if (NPX_TOOLS.has(name)) return { allowed: true };
  return denyCommand(
    command,
    'npx may only run a known tool directly: tsc, expo, pod-install, cap, or a lint/format tool (eslint, prettier, biome, ...).',
  );
}

function gradleDecision(parts: string[], command: string): BashFenceDecision {
  let sawTask = false;
  for (const raw of parts.slice(1)) {
    if (raw.startsWith('-')) continue;
    const task = raw.replace(/^(?::[\w.-]+)+:/, ''); // :app:assembleDebug -> assembleDebug
    const ok =
      GRADLE_EXACT_TASKS.has(task) ||
      GRADLE_TASK_VERBS.some(
        (verb) =>
          task.startsWith(verb) && /^[A-Z]/.test(task.slice(verb.length)),
      );
    if (!ok) {
      return denyCommand(
        command,
        'Allowed gradle tasks: build, clean, dependencies, or assemble*/compile*/bundle*/lint* variants (flags OK).',
      );
    }
    sawTask = true;
  }
  return sawTask
    ? { allowed: true }
    : denyCommand(
        command,
        'Give gradle an allowed task: build, clean, dependencies, assembleDebug, ...',
      );
}

function mavenDecision(parts: string[], command: string): BashFenceDecision {
  let sawGoal = false;
  for (const raw of parts.slice(1)) {
    if (raw.startsWith('-')) continue;
    if (!MAVEN_GOALS.includes(raw)) {
      return denyCommand(
        command,
        `Allowed mvn goals: ${MAVEN_GOALS.join(', ')} (flags OK).`,
      );
    }
    sawGoal = true;
  }
  return sawGoal
    ? { allowed: true }
    : denyCommand(
        command,
        `Give mvn an allowed goal: ${MAVEN_GOALS.join(', ')}.`,
      );
}

function xcodebuildDecision(
  parts: string[],
  command: string,
): BashFenceDecision {
  for (const t of parts.slice(1)) {
    if (XCODEBUILD_DENIED_ACTIONS.has(t)) {
      return denyCommand(
        command,
        'xcodebuild test actions are not allowed; build, clean, and archive are.',
      );
    }
  }
  return { allowed: true };
}

/** Grammar decision for a single operator-free, pipe-free command. */
function commandDecision(command: string): BashFenceDecision {
  const parts = command.split(/\s+/).filter(Boolean);
  const bin = parts[0];
  if (!bin) return denyCommand(command, ALLOWED_TOOLS_SUMMARY);
  if (NODE_MANAGERS.has(bin)) return nodeDecision(parts, command);
  if (bin === 'npx') return npxDecision(parts, command);
  if (GRADLE_MANAGERS.has(bin)) return gradleDecision(parts, command);
  if (MAVEN_MANAGERS.has(bin)) return mavenDecision(parts, command);
  if (bin === 'xcodebuild') return xcodebuildDecision(parts, command);
  if (bin === 'uv' && parts[1] === 'pip') {
    if (parts[2] && PIP_SUBCOMMANDS.includes(parts[2]))
      return { allowed: true };
    return denyCommand(
      command,
      `Allowed uv pip subcommands: ${PIP_SUBCOMMANDS.join(', ')}.`,
    );
  }
  if ((bin === 'bundle' || bin === 'bundler') && parts[1] === 'exec') {
    if (parts[2] && isLintingTool(parts[2])) return { allowed: true };
    return denyCommand(
      command,
      `bundle exec may only run a lint/format tool (rubocop, ...). Allowed bundle subcommands: ${BUNDLE_SUBCOMMANDS.join(
        ', ',
      )}, exec <lint tool>.`,
    );
  }
  const subs = SIMPLE_MANAGERS[bin];
  if (subs) {
    if (parts[1] && subs.includes(parts[1])) return { allowed: true };
    const exec =
      bin === 'bundle' || bin === 'bundler' ? ', exec <lint tool>' : '';
    return denyCommand(
      command,
      `Allowed ${bin} subcommands: ${subs.join(', ')}${exec}.`,
    );
  }
  return denyCommand(
    command,
    `\`${bin}\` is not an allowed tool. ${ALLOWED_TOOLS_SUMMARY}`,
  );
}

function tailArgsAreSafe(argStr: string): boolean {
  const args = argStr.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-[nc]$/.test(a)) {
      if (!/^[+-]?\d+$/.test(args[i + 1] ?? '')) return false;
      i++;
    } else if (!/^-[nc]?\+?\d+$/.test(a)) {
      return false;
    }
  }
  return true;
}

/**
 * Full fence decision for a Bash command: shell-shape gates (separators,
 * redirects, pipes) first, then the per-manager grammar.
 */
export function evaluateBashCommand(rawCommand: string): BashFenceDecision {
  const command = rawCommand.trim();
  // Newlines separate commands in bash; token splitting would flatten
  // `npm install x\ncurl evil` into one "allowed" command.
  if (/[\r\n]/.test(command)) {
    return deny(
      'dangerous operators',
      'Bash command not allowed. Multi-line commands are not permitted — run one command at a time.',
    );
  }
  if (DANGEROUS_OPERATORS.test(command)) {
    return deny(
      'dangerous operators',
      'Bash command not allowed. Shell operators like ; ` $ ( ) are not permitted.',
    );
  }
  // Strip harmless output-silencing redirects, then ban the rest: `>` writes
  // command output to any path, `<`/here-docs feed arbitrary files in.
  const normalized = command
    .replace(/\s*\d*>&\d+\s*/g, ' ')
    .replace(/\s*\d*>\s*\/dev\/null\s*/g, ' ')
    .trim();
  if (/[<>]/.test(normalized)) {
    return deny(
      'disallowed redirect',
      'Bash command not allowed. Redirects are not permitted (only 2>&1 and >/dev/null).',
    );
  }
  const pipeMatch = normalized.match(
    /^(.+?)\s*\|\s*(?:tail|head)((?:\s+\S+)*)\s*$/,
  );
  if (pipeMatch) {
    const base = pipeMatch[1].trim();
    if (/[|&]/.test(base)) {
      return deny(
        'multiple pipes',
        'Bash command not allowed. Only a single pipe to tail/head is permitted.',
      );
    }
    if (!tailArgsAreSafe(pipeMatch[2])) {
      return deny(
        'disallowed pipe',
        'Bash command not allowed. tail/head may only take numeric flags (-n 50, -c 200) — no file arguments.',
      );
    }
    return commandDecision(base);
  }
  if (/[|&]/.test(normalized)) {
    return deny(
      'disallowed pipe',
      'Bash command not allowed. Pipes are only permitted as a single | tail/head for output limiting.',
    );
  }
  return commandDecision(normalized);
}

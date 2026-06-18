import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { analytics } from '@utils/analytics';
import {
  CLI_STEERING_TARGETS,
  type CliSteeringTarget,
  detectTargets,
  findTarget,
  installOrUpdatePostHogCli,
  installSteeringSnippet,
} from '@steps/install-cli-steering';
import type { Command } from '../command';

export const cliAddCommand: Command = {
  name: 'add',
  description:
    "Install or update PostHog CLI and add steering instructions to your coding agent's global instructions file",
  options: {
    agent: {
      describe: 'Agent to install the instructions for',
      choices: CLI_STEERING_TARGETS.map((target) => target.id),
      type: 'string',
    },
    path: {
      describe:
        'Write to an explicit instructions file instead of a detected agent',
      type: 'string',
    },
    all: {
      default: false,
      describe: 'Install for every detected agent without prompting',
      type: 'boolean',
    },
  },
  examples: [
    ['wizard cli add', 'Detect your coding agents and pick one'],
    [
      'wizard cli add --agent claude-code',
      'Install for Claude Code (~/.claude/CLAUDE.md)',
    ],
    ['wizard cli add --all', 'Install for every detected agent'],
    [
      'wizard cli add --path ./AGENTS.md',
      'Install into a specific instructions file',
    ],
  ],
  check: (argv) => {
    if (argv.all && (argv.agent || argv.path)) {
      throw new Error('--all cannot be combined with --agent or --path');
    }
    return true;
  },
  handler: (argv) => {
    void runCliAdd(argv);
  },
};

async function runCliAdd(argv: Arguments): Promise<void> {
  setUI(new LoggingUI());
  const ui = getUI();
  ui.intro('PostHog CLI setup');

  const files = await resolveTargetFiles(argv);
  if (files.length === 0) {
    process.exit(1);
    return;
  }

  ui.log.info('Installing or updating PostHog CLI...');
  const cliInstallResult = installOrUpdatePostHogCli();
  if (!cliInstallResult.success) {
    ui.log.error(
      `Failed to install or update PostHog CLI: ${
        cliInstallResult.error ?? ''
      }`,
    );
    analytics.wizardCapture('cli steering installed', {
      files: files.length,
      failures: files.length,
      cli_install_failed: true,
      agent: typeof argv.agent === 'string' ? argv.agent : undefined,
    });
    process.exit(1);
    return;
  }
  ui.log.success('Installed or updated PostHog CLI.');

  let failures = 0;
  for (const file of files) {
    const result = installSteeringSnippet(file);
    if (result.success) {
      ui.log.success(`Installed PostHog steering instructions in ${file}`);
    } else {
      failures += 1;
      ui.log.error(`Failed to update ${file}: ${result.error ?? ''}`);
    }
  }

  analytics.wizardCapture('cli steering installed', {
    files: files.length,
    failures,
    agent: typeof argv.agent === 'string' ? argv.agent : undefined,
  });

  if (failures > 0) {
    process.exit(1);
    return;
  }
  ui.outro(
    'Done. PostHog CLI is installed and your agent will now use `posthog-cli api` for PostHog tasks.',
  );
  process.exit(0);
}

/** Resolve which instruction files to write, from flags, detection, or a prompt. */
async function resolveTargetFiles(argv: Arguments): Promise<string[]> {
  const ui = getUI();

  if (typeof argv.path === 'string' && argv.path.trim()) {
    return [path.resolve(argv.path.trim())];
  }

  if (typeof argv.agent === 'string') {
    // yargs `choices` already rejected unknown ids.
    const target = findTarget(argv.agent);
    if (!target) {
      ui.log.error(`Unsupported agent: ${argv.agent}`);
      return [];
    }
    return [target.instructionsPath()];
  }

  const detected = detectTargets();
  if (detected.length === 0) {
    ui.log.error(
      'No supported coding agents detected. Pass --agent <id> or --path <file> to choose a target.',
    );
    ui.log.info(
      `Supported agents: ${CLI_STEERING_TARGETS.map((t) => t.id).join(', ')}`,
    );
    return [];
  }

  if (argv.all === true) {
    ui.log.info(
      `Installing for all detected agents: ${detected
        .map((t) => t.name)
        .join(', ')}`,
    );
    return detected.map((target) => target.instructionsPath());
  }

  if (detected.length === 1) {
    ui.log.info(
      `Detected ${detected[0].name} (${detected[0].instructionsPath()})`,
    );
    return [detected[0].instructionsPath()];
  }

  // Non-interactive shells can't pick, so install for every detected agent —
  // the snippet is additive and idempotent, mirroring how MCP install treats
  // all supported clients.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    ui.log.info(
      `Installing for all detected agents: ${detected
        .map((t) => t.name)
        .join(', ')}`,
    );
    return detected.map((target) => target.instructionsPath());
  }

  const selected = await promptForTargets(detected);
  return selected.map((target) => target.instructionsPath());
}

/** Minimal numbered selection — this command is intentionally not a TUI flow. */
async function promptForTargets(
  detected: CliSteeringTarget[],
): Promise<CliSteeringTarget[]> {
  const ui = getUI();
  ui.log.info('Which coding agent are you using?');
  detected.forEach((target, index) => {
    ui.log.info(
      `  ${index + 1}) ${target.name} (${target.instructionsPath()})`,
    );
  });
  ui.log.info(`  ${detected.length + 1}) All of the above`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    for (;;) {
      const answer = (
        await rl.question(`Select 1-${detected.length + 1}: `)
      ).trim();
      const choice = Number(answer);
      if (
        Number.isInteger(choice) &&
        choice >= 1 &&
        choice <= detected.length
      ) {
        return [detected[choice - 1]];
      }
      if (choice === detected.length + 1) {
        return detected;
      }
      ui.log.warn(`Enter a number between 1 and ${detected.length + 1}.`);
    }
  } finally {
    rl.close();
  }
}

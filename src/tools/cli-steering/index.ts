import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import type { ConsoleLog } from '@shared/console-log';
import {
  CLI_STEERING_TARGETS,
  type CliSteeringTarget,
  detectTargets,
  findTarget,
  installOrUpdatePostHogCli,
  installSteeringSnippet,
} from '@shared/install-cli-steering';
import { analytics } from '@utils/analytics';

export type CliAddArgs = { agent?: string; path?: string; all?: boolean };

/** Resolves 0 when the CLI and every snippet installed, else 1. */
export async function runCliAdd(
  args: CliAddArgs,
  { log: ui }: { log: ConsoleLog },
): Promise<number> {
  ui.intro('PostHog CLI setup');

  const files = await resolveTargetFiles(args, ui);
  if (files.length === 0) return 1;

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
      agent: args.agent,
    });
    return 1;
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
    agent: args.agent,
  });

  if (failures > 0) return 1;
  ui.outro(
    'Done. PostHog CLI is installed and your agent will now use `posthog-cli api` for PostHog tasks.',
  );
  return 0;
}

/** Resolve which instruction files to write, from flags, detection, or a prompt. */
async function resolveTargetFiles(
  args: CliAddArgs,
  ui: ConsoleLog,
): Promise<string[]> {
  if (args.path?.trim()) {
    return [path.resolve(args.path.trim())];
  }

  if (args.agent !== undefined) {
    // yargs `choices` already rejected unknown ids.
    const target = findTarget(args.agent);
    if (!target) {
      ui.log.error(`Unsupported agent: ${args.agent}`);
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

  if (args.all === true) {
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

  const selected = await promptForTargets(detected, ui);
  return selected.map((target) => target.instructionsPath());
}

/** Minimal numbered selection — this command is intentionally not a TUI flow. */
async function promptForTargets(
  detected: CliSteeringTarget[],
  ui: ConsoleLog,
): Promise<CliSteeringTarget[]> {
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

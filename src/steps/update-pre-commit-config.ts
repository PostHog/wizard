import * as fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { parse, stringify } from 'yaml';
import type { Integration } from '../lib/constants';
import { analytics } from '../utils/analytics';
import clack from '../utils/clack';
import { traceStep } from '../telemetry';

const TYPE_CHECKING_HOOK_IDS = ['mypy', 'pyright', 'pytype'];
const CONFIG_FILENAMES = ['.pre-commit-config.yaml', '.pre-commit-config.yml'];
// Matches 'posthog' with any version specifier (==, >=, <=, ~=, !=, etc.) or extras [...]
const POSTHOG_DEP_PATTERN = /^posthog([=<>~![]|$)/;

interface PreCommitHook {
  id: string;
  additional_dependencies?: string[];
  [key: string]: unknown;
}

interface PreCommitRepo {
  repo: string;
  hooks?: PreCommitHook[];
  [key: string]: unknown;
}

interface PreCommitConfig {
  repos?: PreCommitRepo[];
  [key: string]: unknown;
}

function findConfigFile(installDir: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(installDir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hasTypeCheckingHooks(config: PreCommitConfig): boolean {
  if (!config.repos || !Array.isArray(config.repos)) {
    return false;
  }
  return config.repos.some((repo) =>
    repo.hooks?.some((hook) => TYPE_CHECKING_HOOK_IDS.includes(hook.id)),
  );
}

export async function updatePreCommitConfigStep({
  installDir,
  integration,
}: {
  installDir: string;
  integration: Integration;
}): Promise<{ updated: boolean }> {
  return traceStep('update-pre-commit-config', async () => {
    const configPath = findConfigFile(installDir);

    if (!configPath) {
      return { updated: false };
    }

    const configFilename = path.basename(configPath);

    let content: string;
    try {
      content = await fs.promises.readFile(configPath, 'utf8');
    } catch (error) {
      clack.log.warn(`Could not read ${chalk.bold.cyan(configFilename)}`);
      analytics.capture('wizard interaction', {
        action: 'failed to read pre-commit config',
        integration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { updated: false };
    }

    let config: PreCommitConfig;
    try {
      config = parse(content) as PreCommitConfig;
    } catch (error) {
      clack.log.warn(`Could not parse ${chalk.bold.cyan(configFilename)}`);
      analytics.capture('wizard interaction', {
        action: 'failed to parse pre-commit config',
        integration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { updated: false };
    }

    if (!config.repos || !Array.isArray(config.repos)) {
      return { updated: false };
    }

    let modified = false;

    for (const repo of config.repos) {
      if (!repo.hooks || !Array.isArray(repo.hooks)) {
        continue;
      }

      for (const hook of repo.hooks) {
        if (!TYPE_CHECKING_HOOK_IDS.includes(hook.id)) {
          continue;
        }

        if (!hook.additional_dependencies) {
          hook.additional_dependencies = [];
        }

        const hasPosthog = hook.additional_dependencies.some((dep) =>
          POSTHOG_DEP_PATTERN.test(dep),
        );

        if (!hasPosthog) {
          hook.additional_dependencies.push('posthog');
          modified = true;
        }
      }
    }

    if (!modified) {
      if (hasTypeCheckingHooks(config)) {
        clack.log.success(
          `${chalk.bold.cyan(
            configFilename,
          )} already has posthog in type-checking hook dependencies`,
        );
      }
      return { updated: false };
    }

    try {
      await fs.promises.writeFile(configPath, stringify(config), 'utf8');
    } catch (error) {
      clack.log.warn(`Could not write ${chalk.bold.cyan(configFilename)}`);
      analytics.capture('wizard interaction', {
        action: 'failed to write pre-commit config',
        integration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { updated: false };
    }

    analytics.capture('wizard interaction', {
      action: 'updated pre-commit config',
      integration,
    });

    clack.log.success(
      `Added posthog to additional_dependencies in ${chalk.bold.cyan(
        configFilename,
      )}`,
    );

    return { updated: true };
  });
}

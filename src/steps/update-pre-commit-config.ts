import * as fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { parseDocument, isSeq, isMap, YAMLSeq } from 'yaml';
import type { Integration } from '../lib/constants';
import { analytics } from '../utils/analytics';
import clack from '../utils/clack';
import { traceStep } from '../telemetry';

const TYPE_CHECKING_HOOK_IDS = ['mypy', 'pyright', 'pytype'];
const CONFIG_FILENAMES = ['.pre-commit-config.yaml', '.pre-commit-config.yml'];
// Matches 'posthog' with any version specifier (==, >=, <=, ~=, !=, etc.) or extras [...]
const POSTHOG_DEP_PATTERN = /^posthog([=<>~![]|$)/;

function findConfigFile(installDir: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(installDir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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

    let doc;
    try {
      doc = parseDocument(content);
    } catch (error) {
      clack.log.warn(`Could not parse ${chalk.bold.cyan(configFilename)}`);
      analytics.capture('wizard interaction', {
        action: 'failed to parse pre-commit config',
        integration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { updated: false };
    }

    const repos = doc.get('repos');
    if (!isSeq(repos)) {
      return { updated: false };
    }

    let modified = false;
    let alreadyHasPosthog = false;

    for (const repo of repos.items) {
      if (!isMap(repo)) continue;

      const hooks = repo.get('hooks');
      if (!isSeq(hooks)) continue;

      for (const hook of hooks.items) {
        if (!isMap(hook)) continue;

        const hookId = String(hook.get('id') ?? '');
        if (!TYPE_CHECKING_HOOK_IDS.includes(hookId)) continue;

        const deps = hook.get('additional_dependencies');

        if (isSeq(deps)) {
          // Check if posthog already exists
          const hasPosthog = deps.items.some((item) =>
            POSTHOG_DEP_PATTERN.test(String(item)),
          );

          if (!hasPosthog) {
            deps.add('posthog');
            modified = true;
          } else {
            alreadyHasPosthog = true;
          }
        } else if (deps === undefined || deps === null) {
          // No additional_dependencies - create new sequence
          const newDeps = new YAMLSeq();
          newDeps.add('posthog');
          hook.set('additional_dependencies', newDeps);
          modified = true;
        } else {
          clack.log.warn(
            `Unexpected additional_dependencies format in ${chalk.bold.cyan(
              hookId,
            )} hook, skipping`,
          );
        }
      }
    }

    if (!modified) {
      if (alreadyHasPosthog) {
        clack.log.success(
          `${chalk.bold.cyan(
            configFilename,
          )} already has posthog in type-checking hook dependencies`,
        );
      }
      return { updated: false };
    }

    try {
      const output = doc.toString({ flowCollectionPadding: false });
      await fs.promises.writeFile(configPath, output, 'utf8');
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

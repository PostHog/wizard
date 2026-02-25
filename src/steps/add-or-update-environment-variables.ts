import chalk from 'chalk';
import type { Integration } from '../lib/constants';
import { traceStep } from '../telemetry';
import { analytics } from '../utils/analytics';
import { getUI } from '../ui';
import { getDotGitignore } from '../utils/file-utils';
import * as fs from 'fs';
import path from 'path';

export async function addOrUpdateEnvironmentVariablesStep({
  installDir,
  variables,
  integration,
}: {
  installDir: string;
  variables: Record<string, string>;
  integration: Integration;
}): Promise<{
  relativeEnvFilePath: string;
  addedEnvVariables: boolean;
  addedGitignore: boolean;
}> {
  return traceStep('add-or-update-environment-variables', async () => {
    const envVarContent = Object.entries(variables)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const dotEnvLocalFilePath = path.join(installDir, '.env.local');
    const dotEnvFilePath = path.join(installDir, '.env');
    const targetEnvFilePath = fs.existsSync(dotEnvLocalFilePath)
      ? dotEnvLocalFilePath
      : dotEnvFilePath;

    const dotEnvFileExists = fs.existsSync(targetEnvFilePath);

    const relativeEnvFilePath = path.relative(installDir, targetEnvFilePath);

    let addedGitignore = false;
    let addedEnvVariables = false;

    if (dotEnvFileExists) {
      try {
        let dotEnvFileContent = fs.readFileSync(targetEnvFilePath, 'utf8');
        let updated = false;

        for (const [key, value] of Object.entries(variables)) {
          const regex = new RegExp(`^${key}=.*$`, 'm');

          if (dotEnvFileContent.match(regex)) {
            dotEnvFileContent = dotEnvFileContent.replace(
              regex,
              `${key}=${value}`,
            );
            updated = true;
          } else {
            if (!dotEnvFileContent.endsWith('\n')) {
              dotEnvFileContent += '\n';
            }
            dotEnvFileContent += `${key}=${value}\n`;
            updated = true;
          }
        }

        if (updated) {
          await fs.promises.writeFile(targetEnvFilePath, dotEnvFileContent, {
            encoding: 'utf8',
            flag: 'w',
          });
          getUI().log.success(
            `Updated environment variables in ${chalk.bold.cyan(
              relativeEnvFilePath,
            )}`,
          );
        } else {
          getUI().log.success(
            `${chalk.bold.cyan(
              relativeEnvFilePath,
            )} already has the necessary environment variables.`,
          );
        }

        addedEnvVariables = true;
      } catch (error) {
        getUI().log.warn(
          `Failed to update environment variables in ${chalk.bold.cyan(
            relativeEnvFilePath,
          )}. Please update them manually.`,
        );

        analytics.capture('wizard interaction', {
          action: 'failed to update environment variables',
          integration,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        return {
          relativeEnvFilePath,
          addedEnvVariables,
          addedGitignore,
        };
      }
    } else {
      try {
        await fs.promises.writeFile(targetEnvFilePath, envVarContent, {
          encoding: 'utf8',
          flag: 'w',
        });
        getUI().log.success(
          `Created ${chalk.bold.cyan(
            relativeEnvFilePath,
          )} with environment variables.`,
        );

        addedEnvVariables = true;
      } catch (error) {
        getUI().log.warn(
          `Failed to create ${chalk.bold.cyan(
            relativeEnvFilePath,
          )} with environment variables. Please add them manually.`,
        );

        analytics.capture('wizard interaction', {
          action: 'failed to create environment variables',
          integration,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        return {
          relativeEnvFilePath,
          addedEnvVariables,
          addedGitignore,
        };
      }
    }

    const gitignorePath = getDotGitignore({ installDir });

    const envFileName = path.basename(targetEnvFilePath);

    const envFiles = [envFileName];

    if (gitignorePath) {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      const missingEnvFiles = envFiles.filter(
        (file) => !gitignoreContent.includes(file),
      );

      if (missingEnvFiles.length > 0) {
        try {
          const newGitignoreContent = `${gitignoreContent}\n${missingEnvFiles.join(
            '\n',
          )}`;
          await fs.promises.writeFile(gitignorePath, newGitignoreContent, {
            encoding: 'utf8',
            flag: 'w',
          });
          getUI().log.success(
            `Updated ${chalk.bold.cyan(
              '.gitignore',
            )} to include ${chalk.bold.cyan(envFileName)}.`,
          );
          addedGitignore = true;
        } catch (error) {
          getUI().log.warn(
            `Failed to update ${chalk.bold.cyan(
              '.gitignore',
            )} to include ${chalk.bold.cyan(envFileName)}.`,
          );

          analytics.capture('wizard interaction', {
            action: 'failed to update gitignore',
            integration,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          return {
            relativeEnvFilePath,
            addedEnvVariables,
            addedGitignore,
          };
        }
      }
    } else {
      try {
        const newGitignoreContent = `${envFiles.join('\n')}\n`;
        await fs.promises.writeFile(
          path.join(installDir, '.gitignore'),
          newGitignoreContent,
          {
            encoding: 'utf8',
            flag: 'w',
          },
        );
        getUI().log.success(
          `Created ${chalk.bold.cyan('.gitignore')} with environment files.`,
        );
        addedGitignore = true;
      } catch (error) {
        getUI().log.warn(
          `Failed to create ${chalk.bold.cyan(
            '.gitignore',
          )} with environment files.`,
        );

        analytics.capture('wizard interaction', {
          action: 'failed to create gitignore',
          integration,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        return {
          relativeEnvFilePath,
          addedEnvVariables,
          addedGitignore,
        };
      }
    }

    analytics.capture('wizard interaction', {
      action: 'added environment variables',
      integration,
    });

    return {
      relativeEnvFilePath,
      addedEnvVariables,
      addedGitignore,
    };
  });
}

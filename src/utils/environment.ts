import path from 'path';
import readEnv from 'read-env';
import fs from 'fs';
import clack from './clack';
import chalk from 'chalk';
import { getDotGitignore } from './file-utils';
import { Integration } from '../lib/constants';
import { analytics } from './analytics';
export function readEnvironment(): Record<string, unknown> {
  const result = readEnv('POSTHOG_WIZARD');

  return result;
}

export async function addOrUpdateEnvironmentVariables({
  installDir,
  variables,
  integration,
}: {
  installDir: string;
  variables: Record<string, string>;
  integration: Integration;
}): Promise<void> {
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
        clack.log.success(
          `Updated environment variables in ${chalk.bold.cyan(
            relativeEnvFilePath,
          )}`,
        );
      } else {
        clack.log.success(
          `${chalk.bold.cyan(
            relativeEnvFilePath,
          )} already has the necessary environment variables.`,
        );
      }
    } catch (error) {
      clack.log.warning(
        `Failed to update environment variables in ${chalk.bold.cyan(
          relativeEnvFilePath,
        )}. Please update them manually. Error: ${error.message}`,
      );
    }
  } else {
    try {
      await fs.promises.writeFile(targetEnvFilePath, envVarContent, {
        encoding: 'utf8',
        flag: 'w',
      });
      clack.log.success(
        `Created ${chalk.bold.cyan(
          relativeEnvFilePath,
        )} with environment variables.`,
      );
    } catch (error) {
      clack.log.warning(
        `Failed to create ${chalk.bold.cyan(
          relativeEnvFilePath,
        )} with environment variables. Please add them manually. Error: ${
          error.message
        }`,
      );
    }
  }

  const gitignorePath = getDotGitignore({ installDir });
  const envFiles = ['.env', '.env.local'];

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
        clack.log.success(
          `Updated ${chalk.bold.cyan(
            '.gitignore',
          )} to include environment files.`,
        );
      } catch (error) {
        clack.log.warning(
          `Failed to update ${chalk.bold.cyan(
            '.gitignore',
          )} to include environment files. Error: ${error.message}`,
        );
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
      clack.log.success(
        `Created ${chalk.bold.cyan('.gitignore')} with environment files.`,
      );
    } catch (error) {
      clack.log.warning(
        `Failed to create ${chalk.bold.cyan(
          '.gitignore',
        )} with environment files. Error: ${error.message}`,
      );
    }
  }

  analytics.capture('wizard interaction', {
    action: 'added environment variables',
    integration,
  });
}

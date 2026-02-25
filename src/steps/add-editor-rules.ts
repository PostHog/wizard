import * as fs from 'fs';
import chalk from 'chalk';
import path from 'path';
import { Integration } from '../lib/constants';
import { analytics } from '../utils/analytics';
import { getUI } from '../ui';
import { traceStep } from '../telemetry';

type AddEditorRulesStepOptions = {
  installDir: string;
  rulesName: string;
  integration: Integration;
};

export const addEditorRulesStep = async ({
  installDir,
  rulesName,
  integration,
}: AddEditorRulesStepOptions): Promise<boolean> => {
  // Add rules file if in Cursor environment
  if (process.env.CURSOR_TRACE_ID) {
    return traceStep('add-editor-rules', async () => {
      const docsDir = path.join(installDir, '.cursor', 'rules');

      await fs.promises.mkdir(docsDir, { recursive: true });

      const frameworkRules = await fs.promises.readFile(
        path.join(__dirname, '..', 'utils', 'rules', rulesName),
        'utf8',
      );
      const universalRulesPath = path.join(
        __dirname,
        '..',
        'utils',
        'rules',
        'universal.md',
      );

      const universalRules = await fs.promises.readFile(
        universalRulesPath,
        'utf8',
      );

      // Replace {universal} placeholder with universal rules content
      const combinedRules = frameworkRules.replace(
        '{universal}',
        universalRules,
      );
      const targetPath = path.join(docsDir, 'posthog-integration.mdc');

      // Write the combined rules
      await fs.promises.writeFile(targetPath, combinedRules, 'utf8');

      analytics.capture('wizard interaction', {
        action: 'added editor rules',
        integration,
      });

      getUI().log.info(
        `Added Cursor rules to ${chalk.bold.cyan(
          `.cursor/rules/posthog-integration.mdc`,
        )}`,
      );

      return true;
    });
  }

  return false;
};

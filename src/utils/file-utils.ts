import path from 'path';
import fs from 'fs';
import type { CloudRegion, FileChange, WizardOptions } from './types';
import clack from './clack';
import z from 'zod';
import { query } from './query';
import fg from 'fast-glob';
import { analytics } from './analytics';
import { Integration } from '../lib/constants';
import { abort } from './clack-utils';
import { INTEGRATION_CONFIG } from '../lib/config';
import {
  baseFilterFilesPromptTemplate,
  baseGenerateFileChangesPromptTemplate,
} from '../lib/prompts';

export const GLOBAL_IGNORE_PATTERN = [
  'node_modules',
  'dist',
  'build',
  'public',
  'static',
  '.git',
  '.next',
];
export async function getAllFilesInProject(dir: string): Promise<string[]> {
  let results: string[] = [];

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (GLOBAL_IGNORE_PATTERN.some((pattern) => fullPath.includes(pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      // Recursively get files from subdirectories
      const subDirFiles = await getAllFilesInProject(fullPath);
      results = results.concat(subDirFiles);
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

export function getDotGitignore({
  installDir,
}: Pick<WizardOptions, 'installDir'>) {
  const gitignorePath = path.join(installDir, '.gitignore');
  const gitignoreExists = fs.existsSync(gitignorePath);

  if (gitignoreExists) {
    return gitignorePath;
  }

  return undefined;
}

export async function updateFile(
  change: FileChange,
  { installDir }: Pick<WizardOptions, 'installDir'>,
) {
  const dir = path.dirname(path.join(installDir, change.filePath));
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(installDir, change.filePath),
    change.newContent,
  );
}

export async function getFilesToChange({
  integration,
  relevantFiles,
  documentation,
  accessToken,
  cloudRegion,
}: {
  integration: Integration;
  relevantFiles: string[];
  documentation: string;
  accessToken: string;
  cloudRegion: CloudRegion;
}) {
  const filterFilesSpinner = clack.spinner();

  filterFilesSpinner.start('Selecting files to change...');

  const filterFilesResponseSchmea = z.object({
    files: z.array(z.string()),
  });

  const prompt = await baseFilterFilesPromptTemplate.format({
    documentation,
    file_list: relevantFiles.join('\n'),
    integration_name: integration,
    integration_rules: INTEGRATION_CONFIG[integration].filterFilesRules,
  });

  const filterFilesResponse = await query({
    message: prompt,
    schema: filterFilesResponseSchmea,
    accessToken,
    region: cloudRegion,
  });

  const filesToChange = filterFilesResponse.files;

  filterFilesSpinner.stop(`Found ${filesToChange.length} files to change`);

  analytics.capture('wizard interaction', {
    action: 'detected files to change',
    integration,
    files: filesToChange,
  });

  return filesToChange;
}

export async function generateFileContent({
  prompt,
  accessToken,
  cloudRegion,
}: {
  prompt: string;
  accessToken: string;
  cloudRegion: CloudRegion;
}) {
  const response = await query({
    message: prompt,
    schema: z.object({
      newContent: z.string(),
    }),
    accessToken: accessToken,
    region: cloudRegion,
  });

  return response.newContent;
}

export async function generateFileChangesForIntegration({
  integration,
  filesToChange,
  accessToken,
  documentation,
  installDir,
  cloudRegion,
}: {
  integration: Integration;
  filesToChange: string[];
  accessToken: string;
  documentation: string;
  installDir: string;
  cloudRegion: CloudRegion;
}) {
  const changes: FileChange[] = [];

  for (const filePath of filesToChange) {
    const fileChangeSpinner = clack.spinner();

    analytics.capture('wizard interaction', {
      action: 'processing file',
      integration,
      file: filePath,
    });

    try {
      let oldContent = undefined;
      try {
        oldContent = await fs.promises.readFile(
          path.join(installDir, filePath),
          'utf8',
        );
      } catch (readError) {
        if (readError.code !== 'ENOENT') {
          await abort(`Error reading file ${filePath}`);
          continue;
        }
      }

      fileChangeSpinner.start(
        `${oldContent ? 'Updating' : 'Creating'} file ${filePath}`,
      );

      const unchangedFiles = filesToChange.filter(
        (filePath) => !changes.some((change) => change.filePath === filePath),
      );

      const prompt = await baseGenerateFileChangesPromptTemplate.format({
        file_content: oldContent,
        file_path: filePath,
        documentation,
        integration_name: INTEGRATION_CONFIG[integration].name,
        integration_rules: INTEGRATION_CONFIG[integration].generateFilesRules,
        changed_files: changes
          .map((change) => `${change.filePath}\n${change.newContent}`)
          .join('\n'),
        unchanged_files: unchangedFiles,
      });

      const newContent = await generateFileContent({
        prompt,
        accessToken,
        cloudRegion,
      });

      if (newContent !== oldContent) {
        await updateFile({ filePath, oldContent, newContent }, { installDir });
        changes.push({ filePath, oldContent, newContent });
      }

      fileChangeSpinner.stop(
        `${oldContent ? 'Updated' : 'Created'} file ${filePath}`,
      );

      analytics.capture('wizard interaction', {
        action: 'processed file',
        integration,
        file: filePath,
      });
    } catch (error) {
      await abort(`Error processing file ${filePath}`);
    }
  }

  analytics.capture('wizard interaction', {
    action: 'completed file changes',
    integration,
    files: filesToChange,
  });

  return changes;
}

export async function getRelevantFilesForIntegration({
  installDir,
  integration,
}: Pick<WizardOptions, 'installDir'> & {
  integration: Integration;
}) {
  const filterPatterns = INTEGRATION_CONFIG[integration].filterPatterns;
  const ignorePatterns = INTEGRATION_CONFIG[integration].ignorePatterns;

  const filteredFiles = await fg(filterPatterns, {
    cwd: installDir,
    ignore: ignorePatterns,
  });

  analytics.capture('wizard interaction', {
    action: 'detected relevant files',
    integration,
    number_of_files: filteredFiles.length,
  });

  return filteredFiles;
}

import {
  abort,
  abortIfCancelled,
  getOrAskForProjectData,
  askForCloudRegion,
  getPackageDotJson,
} from './utils/clack-utils';
import clack from './utils/clack';
import { WizardOptions } from './utils/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { query } from './utils/query';
import { z } from 'zod';
import {
  getAllFilesInProject,
  updateFile,
} from './utils/file-utils';
import { getPackageVersion, hasPackageInstalled } from './utils/package-json';
import * as semver from 'semver';
import { enableDebugLogs, debug } from './utils/debug';

// Schema for file selection from AI
const FileSelectionSchema = z.object({
  files: z.array(z.string()).max(10),
});

// Schema for enhanced file with events
const EnhancedFileSchema = z.object({
  filePath: z.string(),
  content: z.string(),
  events: z.array(z.object({
    name: z.string(),
    description: z.string(),
  })),
});

export async function runEventSetupWizard(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  clack.intro(
    `Let's do a first pass on PostHog event tracking for your project.
    
    Analyzing your project structure. Stand by to receive changes. Use git to discard any events you're not happy with.

    We'll start by selecting 10 files, adding up to two events to each. This will give you a great starting point for your event tracking.
    `,
  );

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const { wizardHash } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  // Check if this is a Next.js 15.3+ project with instrumentation-client
  const packageJson = await getPackageDotJson(options);
  const isNextJs = hasPackageInstalled('next', packageJson);

  if (!isNextJs) {
    abort('This feature is only available for Next.js projects.');
  }

  const nextVersion = getPackageVersion('next', packageJson);
  const isNext15_3Plus = nextVersion && semver.gte(nextVersion, '15.3.0');

  if (!isNext15_3Plus) {
    abort('This feature requires Next.js 15.3.0 or higher.');
  }

  // Check for instrumentation-client file
  const allFiles = await getAllFilesInProject(options.installDir);
  const instrumentationFiles = allFiles.filter(f =>
    f.includes('instrumentation') &&
    (f.endsWith('.ts') || f.endsWith('.js')) &&
    (f.includes('client') || f.includes('Client'))
  );

  if (instrumentationFiles.length === 0) {
    abort('No instrumentation-client file found. Please set up Next.js instrumentation first.');
  }

  // Get the project file tree
  const s = clack.spinner();
  s.start('Analyzing your project structure');

  const projectFiles = await getAllFilesInProject(options.installDir);
  const relativeFiles = projectFiles
    .map(f => path.relative(options.installDir, f))
    .filter(f => {
      // Exclude instrumentation files and next.config
      const isInstrumentation = f.includes('instrumentation') &&
        (f.endsWith('.ts') || f.endsWith('.js'));
      const isNextConfig = f.startsWith('next.config.') || f === 'next.config';
      return !isInstrumentation && !isNextConfig;
    });

  debug('Total files found:', projectFiles.length);
  debug('Files after filtering:', relativeFiles.length);
  s.stop('Project structure analyzed');

  // Send file tree to AI to get 10 most useful files
  s.start('Selecting some files to enhance with events...');

  const fileSelectionPrompt = `Given this Next.js 15.3+ project structure and package.json, select the 10 most useful files for adding PostHog analytics events. Focus on:
  - User interaction points (buttons, forms, navigation)
  - Key user flows (auth, checkout, main features)
  - Business-critical paths
  - Files that represent important user actions
  
  Package.json:
  ${JSON.stringify(packageJson, null, 2)}
  
  Project files:
  ${relativeFiles.join('\n')}
  
  Return exactly 10 file paths that would benefit most from analytics tracking.`;

  let selectedFiles: string[] = [];
  try {
    const response = await query({
      message: fileSelectionPrompt,
      region: cloudRegion,
      schema: FileSelectionSchema,
      wizardHash,
    });
    selectedFiles = response.files;
    s.stop(`Selected ${selectedFiles.length} files for event tracking`);
  } catch (error) {
    s.stop('Failed to select files');
    abort('Could not analyze project structure. Please try again.');
  }

  // Read the selected files and enhance them with events
  clack.log.info('Files selected for event tracking:');
  selectedFiles.forEach((file, index) => {
    clack.log.info(`  ${index + 1}. ${file}`);
  });

  const enhancedFiles: Array<{
    filePath: string;
    events: Array<{ name: string; description: string }>;
  }> = [];

  clack.log.info('\nEnhancing files with event tracking. Changes will be applied as they come in. Use your git interface to review new events...');

  for (const filePath of selectedFiles) {
    const fileSpinner = clack.spinner();
    fileSpinner.start(`Analyzing ${filePath}`);

    try {
      const fullPath = path.join(options.installDir, filePath);
      const fileContent = await fs.readFile(fullPath, 'utf8');

      // Determine if this is client or server code
      const isClientCode = filePath.includes('app/') || filePath.includes('pages/') ||
        filePath.includes('components/') || fileContent.includes('"use client"');

      const enhancePrompt = `Enhance this ${isClientCode ? 'client-side' : 'server-side'} Next.js file with 1-2 meaningful PostHog events.
      
      Rules:
      - Import ${isClientCode ? 'posthog-js' : 'posthog-node'} appropriately
      - Add 1-2 high-value events that track important user actions
      - Use descriptive event names (lowercase-hyphenated)
      - Include relevant properties with events
      - Ensure the code remains functional and follows Next.js patterns
      - For server code: initialize PostHog properly
      - Do not set timestamps on events; PostHog will do this automatically
      - Do not initialize PostHog in the file; assume it has already been initialized
      - Do not change the formatting of the file; only add events
      
      File path: ${filePath}
      File content:
      ${fileContent}
      
      Return the enhanced file content and list the events added.`;

      const response = await query({
        message: enhancePrompt,
        region: cloudRegion,
        schema: EnhancedFileSchema,
        wizardHash,
      });

      // Apply changes immediately
      if (response.content !== fileContent) {
        await updateFile({
          filePath,
          oldContent: fileContent,
          newContent: response.content,
        }, options);

        enhancedFiles.push({
          filePath,
          events: response.events,
        });

        fileSpinner.stop(`✓ Enhanced ${filePath} with ${response.events.length} events`);
      } else {
        fileSpinner.stop(`No changes needed for ${filePath}`);
      }
    } catch (error) {
      fileSpinner.stop(`✗ Failed to enhance ${filePath}`);
      debug('Error enhancing file:', error);
    }
  }

  // All files have been updated immediately during enhancement

  // Generate event tracking plan
  const generateMarkdown = () => {
    let md = `# Event Tracking Plan\n\n`;
    md += `This document lists all PostHog events that have been automatically added to your Next.js application.\n\n`;
    md += `## Events by File\n\n`;

    enhancedFiles.forEach((file) => {
      if (file.events.length > 0) {
        md += `### ${file.filePath}\n\n`;
        file.events.forEach(event => {
          md += `- **${event.name}**: ${event.description}\n`;
        });
        md += `\n`;
      }
    });

    md += `\n---\n\n`;
    md += `## Next Steps\n\n`;
    md += `1. Review the changes made to your files\n`;
    md += `2. Test that events are being captured correctly\n`;
    md += `3. Create insights and dashboards in PostHog\n`;
    md += `4. Use the PostHog MCP to create funnel insights\n\n`;
    md += `Learn more: https://posthog.com/docs/product-analytics\n`;
    return md;
  };

  const markdownContent = generateMarkdown();
  const fileName = 'event-tracking-plan.md';
  const filePath = path.join(options.installDir, fileName);

  await fs.writeFile(filePath, markdownContent);

  // Summary
  const totalEvents = enhancedFiles.reduce((sum, file) => sum + file.events.length, 0);

  clack.outro(
    `Success! Added ${chalk.bold(totalEvents.toString())} events across ${chalk.bold(enhancedFiles.length.toString())} files.
    
    Event tracking plan saved to: ${chalk.cyan(fileName)}
    
    Next steps:
    1. Review changes with ${chalk.bold('git diff')}
    2. Revert unwanted changes with ${chalk.bold('git checkout <file>')}
    3. Test that events are being captured
    4. Create insights in PostHog
    `,
  );
}


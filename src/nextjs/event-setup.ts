import {
  abort,
  abortIfCancelled,
  getOrAskForProjectData,
  askForCloudRegion,
  getPackageDotJson,
} from '../utils/clack-utils';
import clack from '../utils/clack';
import { WizardOptions } from '../utils/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { query } from '../utils/query';
import { z } from 'zod';
import {
  getAllFilesInProject,
  updateFile,
} from '../utils/file-utils';
import { getPackageVersion, hasPackageInstalled } from '../utils/package-json';
import * as semver from 'semver';
import { enableDebugLogs, debug } from '../utils/debug';

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
    
    We'll start by analyzing your project structure, then choose ten files to enhance. Use git to discard any events you're not happy with.

    This will give you a starting point, then you can add any events that we missed.
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

  // Check if server-side PostHog helper exists
  const posthogHelperJsPath = path.join(options.installDir, 'app', 'posthog.js');
  const posthogHelperTsPath = path.join(options.installDir, 'app', 'posthog.ts');
  const hasPosthogHelper = await fs.access(posthogHelperJsPath).then(() => true).catch(() => false) ||
                          await fs.access(posthogHelperTsPath).then(() => true).catch(() => false);

  if (!hasPosthogHelper) {
    s.start('Creating server-side PostHog helper...');
    
    // Check if project uses TypeScript
    const tsConfigPath = path.join(options.installDir, 'tsconfig.json');
    const isTypeScript = await fs.access(tsConfigPath).then(() => true).catch(() => false);
    
    const helperContent = isTypeScript ? 
      `// app/posthog.ts
import { PostHog } from 'posthog-node'

export default function PostHogClient(): PostHog {
  const posthogClient = new PostHog(
    process.env.NEXT_PUBLIC_POSTHOG_KEY!,
    {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0
    }
  )
  return posthogClient
}
` : 
      `// app/posthog.js
import { PostHog } from 'posthog-node'

export default function PostHogClient() {
  const posthogClient = new PostHog(
    process.env.NEXT_PUBLIC_POSTHOG_KEY,
    {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0
    }
  )
  return posthogClient
}
`;

    try {
      // Ensure app directory exists
      const appDir = path.join(options.installDir, 'app');
      await fs.mkdir(appDir, { recursive: true });
      
      // Write the helper file
      const targetPath = isTypeScript ? posthogHelperTsPath : posthogHelperJsPath;
      await fs.writeFile(targetPath, helperContent);
      s.stop(`Created server-side PostHog helper at app/posthog.${isTypeScript ? 'ts' : 'js'}`);
    } catch (error) {
      s.stop('Failed to create server-side PostHog helper');
      debug('Error creating PostHog helper:', error);
    }
  }

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
      model: 'gemini-2.5-flash',
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

  clack.log.info("\nEnhancing files with event tracking. Changes will be applied as they come in. Use your git interface to review new events. Feel free to toss anything you don't like...");

  for (const filePath of selectedFiles) {
    const fileSpinner = clack.spinner();
    fileSpinner.start(`Analyzing ${filePath}`);

    try {
      const fullPath = path.join(options.installDir, filePath);
      const fileContent = await fs.readFile(fullPath, 'utf8');

      // Determine if this is client or server code
      const isServerCode = 
        // Explicit server indicators
        fileContent.includes('"use server"') ||
        // API routes
        filePath.includes('/api/') ||
        filePath.includes('route.ts') ||
        filePath.includes('route.js') ||
        // Server-only imports
        fileContent.includes('import ') && (
          fileContent.includes('next/headers') ||
          fileContent.includes('next/cache') ||
          fileContent.includes('@/lib/db') ||
          fileContent.includes('prisma') ||
          fileContent.includes('server-only')
        ) ||
        // Metadata exports (server components)
        fileContent.includes('export const metadata') ||
        fileContent.includes('export async function generateMetadata') ||
        // Server actions
        fileContent.includes('async function') && fileContent.includes('"use server"');
      
      const isClientCode = !isServerCode && (
        // Explicit client directive
        fileContent.includes('"use client"') ||
        // Client-only hooks
        fileContent.includes('useState') ||
        fileContent.includes('useEffect') ||
        fileContent.includes('useContext') ||
        fileContent.includes('useReducer') ||
        fileContent.includes('useCallback') ||
        fileContent.includes('useMemo') ||
        // Client-side event handlers
        fileContent.includes('onClick') ||
        fileContent.includes('onChange') ||
        fileContent.includes('onSubmit') ||
        // Components in typical client directories
        (filePath.includes('components/') && !isServerCode)
      );

      const enhancePrompt = `Enhance this ${isClientCode ? 'client-side' : 'server-side'} Next.js file with 1-2 meaningful PostHog events.
      
      Rules:
      ${isClientCode ? 
        '- Import from "posthog-js" and use the existing posthog instance' : 
        '- Import the PostHog helper from "@/app/posthog" using: import PostHogClient from "@/app/posthog"\n      - Create a PostHog instance at the start of your server functions using: const posthog = PostHogClient()\n      - Remember to call posthog.shutdown() after capturing events to ensure they are sent'}
      - Add 1-2 high-value events that track important user actions
      - Use descriptive event names (lowercase-hyphenated)
      - Include some properties with events where relevant, but do not create too much complexity to achieve this
      - Ensure the code remains functional and follows Next.js patterns
      - Do not set timestamps on events; PostHog will do this automatically
      - ${isClientCode ? 'Do not initialize PostHog; assume it has already been initialized' : 'Use the PostHogClient helper to create instances as needed'}
      - Do not change the formatting of the file; only add events
      - Always return the entire file content, not just the changes. Never return a diff or truncated response that says "rest of file unchanged"
      - Do not add events to track pageviews; PostHog will do this automatically. Instead, track specific actions. Add no useEffect-type hooks.
      - NEVER INSERT "use client". Respect the project's existing architecture
      ${!isClientCode ? '- For server-side code, capture events within async functions and remember to call shutdown() after' : ''}
      
      File path: ${filePath}
      File content:
      ${fileContent}
      
      Return the enhanced file content and list the events added.`;

      const response = await query({
        message: enhancePrompt,
        model: 'gemini-2.5-pro',
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

  // Generate event tracking plan
  const generateMarkdown = () => {
    let md = `# Event tracking plan\n\n`;
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

    md += `\n## Events still awaiting implementation\n`;
    md += `-`

    md += `\n---\n\n`;
    md += `## Next Steps\n\n`;
    md += `1. Review the changes made to your files\n`;
    md += `2. Test that events are being captured correctly\n`;
    md += `3. Create insights and dashboards in PostHog\n`;
    md += `4. Make a list of events we missed above. Knock them out yourself, or give this file to an agent.`
    md += `Learn more about what to measure with PostHog and why: https://posthog.com/docs/new-to-posthog/getting-hogpilled\n`;
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


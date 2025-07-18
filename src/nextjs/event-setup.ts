import {
  abort,
  abortIfCancelled,
  getOrAskForProjectData,
  askForCloudRegion,
  getPackageDotJson,
  getUncommittedOrUntrackedFiles,
  isInGitRepo,
} from '../utils/clack-utils';
import clack from '../utils/clack';
import { WizardOptions } from '../utils/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { query } from '../utils/query';
import { z } from 'zod';
import { getAllFilesInProject, updateFile } from '../utils/file-utils';
import { getPackageVersion, hasPackageInstalled } from '../utils/package-json';
import * as semver from 'semver';
import { enableDebugLogs, debug } from '../utils/debug';
import { analytics } from '../utils/analytics';

// Schema for file selection from AI
const FileSelectionSchema = z.object({
  files: z.array(z.string()).max(10),
});

// Schema for enhanced file with events
const EnhancedFileSchema = z.object({
  filePath: z.string(),
  content: z.string(),
  events: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    }),
  ),
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

  // Track event setup started
  analytics.capture('wizard interaction', {
    action: 'event setup started',
  });

  // Check for uncommitted changes
  if (isInGitRepo()) {
    const uncommittedOrUntrackedFiles = getUncommittedOrUntrackedFiles();
    if (uncommittedOrUntrackedFiles.length) {
      clack.log.warn(
        `You have uncommitted or untracked files in your repo:

${uncommittedOrUntrackedFiles.join('\n')}

The event setup wizard will modify multiple files. For the best experience, commit or stash your changes first.`,
      );
      const continueWithDirtyRepo = await abortIfCancelled(
        clack.confirm({
          message: 'Do you want to continue anyway?',
        }),
      );
      if (!continueWithDirtyRepo) {
        analytics.capture('wizard interaction', {
          action: 'event setup canceled',
          reason: 'uncommitted changes',
        });
        await abort('Please commit your changes and try again.', 0);
      }
    }
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const { wizardHash } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  // Check if this is a Next.js 15.3+ project with instrumentation-client
  const packageJson = await getPackageDotJson(options);
  const isNextJs = hasPackageInstalled('next', packageJson);

  if (!isNextJs) {
    analytics.capture('wizard interaction', {
      action: 'event setup canceled',
      reason: 'not nextjs project',
    });
    return abort('This feature is only available for Next.js projects.');
  }

  const nextVersion = getPackageVersion('next', packageJson);
  const isNext15_3Plus = nextVersion && semver.gte(nextVersion, '15.3.0');

  if (!isNext15_3Plus) {
    analytics.capture('wizard interaction', {
      action: 'event setup canceled',
      reason: 'nextjs version too old',
      version: nextVersion,
    });
    return abort('This feature requires Next.js 15.3.0 or higher.');
  }

  // Check for instrumentation-client file
  const allFiles = await getAllFilesInProject(options.installDir);
  const instrumentationFiles = allFiles.filter(
    (f) =>
      f.includes('instrumentation') &&
      (f.endsWith('.ts') || f.endsWith('.js')) &&
      (f.includes('client') || f.includes('Client')),
  );

  if (instrumentationFiles.length === 0) {
    analytics.capture('wizard interaction', {
      action: 'event setup canceled',
      reason: 'no instrumentation client',
    });
    return abort(
      'No instrumentation-client file found. Please set up Next.js instrumentation first.',
    );
  }

  // Get the project file tree
  const s = clack.spinner();
  s.start('Analyzing your project structure');

  const projectFiles = await getAllFilesInProject(options.installDir);
  const relativeFiles = projectFiles
    .map((f) => path.relative(options.installDir, f))
    .filter((f) => {
      // Exclude instrumentation files and next.config
      const isInstrumentation =
        f.includes('instrumentation') &&
        (f.endsWith('.ts') || f.endsWith('.js'));
      const isNextConfig = f.startsWith('next.config.') || f === 'next.config';
      return !isInstrumentation && !isNextConfig;
    });

  debug('Total files found:', projectFiles.length);
  debug('Files after filtering:', relativeFiles.length);
  s.stop('Project structure analyzed');

  // Check if universal PostHog helper exists
  const posthogHelperPath = path.join(
    options.installDir,
    'app',
    'posthog-helper.ts',
  );
  const hasPosthogHelper = await fs
    .access(posthogHelperPath)
    .then(() => true)
    .catch(() => false);

  if (!hasPosthogHelper) {
    s.start('Creating universal PostHog helper...');

    try {
      // Read the helper template from our source
      const helperTemplatePath = path.join(__dirname, 'next-posthog-helper.ts');
      const helperContent = await fs.readFile(helperTemplatePath, 'utf8');

      // Ensure app directory exists
      const appDir = path.join(options.installDir, 'app');
      await fs.mkdir(appDir, { recursive: true });

      // Write the helper file
      await fs.writeFile(posthogHelperPath, helperContent);
      s.stop('Created universal PostHog helper at app/posthog-helper.ts');
    } catch (error) {
      s.stop('Failed to create universal PostHog helper');
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
    analytics.capture('wizard interaction', {
      action: 'event setup canceled',
      reason: 'file selection failed',
    });
    return abort('Could not analyze project structure. Please try again.');
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

  clack.log.info(
    "\nEnhancing files with event tracking. Changes will be applied as they come in. Use your git interface to review new events. Feel free to toss anything you don't like...",
  );

  for (const filePath of selectedFiles) {
    const fileSpinner = clack.spinner();
    fileSpinner.start(`Analyzing ${filePath}`);

    try {
      const fullPath = path.join(options.installDir, filePath);
      const fileContent = await fs.readFile(fullPath, 'utf8');

      const enhancePrompt = `You are enhancing a REAL production Next.js file with PostHog analytics. This is NOT an example or tutorial - add events to the ACTUAL code provided.

      CRITICAL INSTRUCTIONS:
      - This is a REAL file from a production codebase
      - DO NOT add placeholder comments like "// In a real app..." or "// This is an example..."
      - DO NOT modify the existing business logic or add simulation code
      - DO NOT add any tutorial-style comments
      - ONLY add PostHog event tracking to the existing, real functionality
      - DO NOT remove comments that already exist in a file
      
      FORBIDDEN - NEVER DO THESE:
      - NEVER add 'use client' or 'use server' directives at the top of the file, or in functions
      - NEVER use useEffect to track page views or component renders
      - NEVER track events like "page_viewed", "form_viewed", "component_rendered", "flow_started", "page_opened" etc
      - NEVER track that someone simply arrived at or viewed a page
      - NEVER change the file's existing client/server architecture
      - NEVER add events on component mount or render - only on actual user interactions
      - NEVER add onSubmit, onClick, onChange or any event handlers to Server Components
      - If the file is a Server Component (no "use client" directive), track events in server actions only
      
      How to use PostHog:
      - Import the universal helper functions:
        import { captureEvent, postHogIdentify } from '@/app/posthog-helper'
      
      - To track events:
        captureEvent('event-name', { property1: 'value', property2: 123 })
      
      - To identify users:
        postHogIdentify(userId, { email: user.email, name: user.name })
      
      - These functions work in BOTH client and server code - no need to worry about which library to use
      - The functions handle all the complexity of client vs server environments automatically
      
      IMPORTANT Server Component Rules:
      - Server Components CANNOT have event handlers (onClick, onSubmit, onChange, etc.)
      - In Server Components, track events inside server actions (async functions with "use server")
      - For forms in Server Components, use action={serverAction} NOT onSubmit
      - If you need client-side interaction tracking, the component must have "use client" directive
      
      Technical Rules:
      - Add 1-2 high-value events that track the ACTUAL user actions in this file
      - Use descriptive event names (lowercase-hyphenated) based on what the code ACTUALLY does
      - Include properties that capture REAL data from the existing code
      - Do not change the formatting of the file; only add events
      - Do not set timestamps on events; PostHog will do this automatically
      - Always return the entire file content, not just the changes
      - NEVER add events that correspond to page views; PostHog tracks these automatically
      - NEVER INSERT "use client" or "use server" directives
      - PRESERVE the exact file ending (including any trailing newlines or lack thereof)
      
      File path: ${filePath}
      File content:
      ${fileContent}
      
      IMPORTANT: If this file only renders UI without any user interactions (no buttons, forms, or actions), 
      or if the only possible events would be pageview-like (e.g., "form-viewed", "page-opened", "flow-started"),
      then SKIP THIS FILE by returning the original content unchanged. We only want to track actual user actions, not that someone looked at a page.
      
      Return the enhanced file with PostHog tracking added to the EXISTING functionality. List the events you added.`;

      const response = await query({
        message: enhancePrompt,
        model: 'gemini-2.5-flash',
        region: cloudRegion,
        schema: EnhancedFileSchema,
        wizardHash,
      });

      // Apply changes immediately
      if (response.content !== fileContent) {
        await updateFile(
          {
            filePath,
            oldContent: fileContent,
            newContent: response.content,
          },
          options,
        );

        enhancedFiles.push({
          filePath,
          events: response.events,
        });

        fileSpinner.stop(
          `✓ Enhanced ${filePath} with ${response.events.length} events`,
        );
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
        file.events.forEach((event) => {
          md += `- **${event.name}**: ${event.description}\n`;
        });
        md += `\n`;
      }
    });

    md += `\n## Events still awaiting implementation\n`;
    md += `-`;

    md += `\n---\n\n`;
    md += `## Next Steps\n\n`;
    md += `1. Review the changes made to your files\n`;
    md += `2. Test that events are being captured correctly\n`;
    md += `3. Create insights and dashboards in PostHog\n`;
    md += `4. Make a list of events we missed above. Knock them out yourself, or give this file to your agent to flesh out.\n`;
    md += `Learn more about what to measure with PostHog and why: https://posthog.com/docs/new-to-posthog/getting-hogpilled\n`;
    return md;
  };

  const markdownContent = generateMarkdown();
  const fileName = 'event-tracking-report.md';
  const filePath = path.join(options.installDir, fileName);

  await fs.writeFile(filePath, markdownContent);

  // Summary
  const totalEvents = enhancedFiles.reduce(
    (sum, file) => sum + file.events.length,
    0,
  );

  // Track successful completion
  analytics.capture('wizard interaction', {
    action: 'event setup successful',
    'total events added': totalEvents,
    enhanced: enhancedFiles.length,
    analyzed: selectedFiles.length,
  });

  clack.outro(
    `Success! Added ${chalk.bold(
      totalEvents.toString(),
    )} events across ${chalk.bold(enhancedFiles.length.toString())} files.
    
    Event tracking report saved to: ${chalk.cyan(fileName)}
    
    Next steps:
    1. Review changes with your preferred git interface
    2. Revert unwanted changes
    3. Test that events are being captured
    4. Create insights in PostHog: https://posthog.com/docs/product-analytics/insights
    `,
  );
}

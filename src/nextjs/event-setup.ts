import {
  abort,
  getOrAskForProjectData,
  askForCloudRegion,
  getPackageDotJson,
  getUncommittedOrUntrackedFiles,
  isInGitRepo,
  abortIfCancelled,
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

// Analytics constants
const WIZARD_INTERACTION = 'wizard interaction';
const INTEGRATION_NAME = 'event-setup';

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
    
    We'll start by analyzing your project structure, then choose up to ten files to enhance. Use git to discard any events you're not happy with.

    This will give you a starting point, then you can add any events that we missed.
    `,
  );

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
        analytics.capture(WIZARD_INTERACTION, {
          action: 'aborted due to uncommitted changes',
          integration: INTEGRATION_NAME,
        });
        return abort('Please commit your changes and try again.', 0);
      }
      analytics.capture(WIZARD_INTERACTION, {
        action: 'continued with uncommitted changes',
        integration: INTEGRATION_NAME,
      });
    }
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const { accessToken, projectId } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  // Check if this is a Next.js 15.3+ project with instrumentation-client
  const packageJson = await getPackageDotJson(options);
  const isNextJs = hasPackageInstalled('next', packageJson);

  if (!isNextJs) {
    return abort('This feature is only available for Next.js projects.');
  }

  const nextVersion = getPackageVersion('next', packageJson);
  const isNext15_3Plus = nextVersion && semver.gte(nextVersion, '15.3.0');

  analytics.setTag('nextjs-version', nextVersion);

  if (!isNext15_3Plus) {
    analytics.capture(WIZARD_INTERACTION, {
      action: 'aborted due to nextjs version',
      integration: INTEGRATION_NAME,
      nextjsVersion: nextVersion,
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
    analytics.capture(WIZARD_INTERACTION, {
      action: 'aborted due to missing instrumentation-client',
      integration: INTEGRATION_NAME,
    });
    return abort(
      'No instrumentation-client file found. Please set up Next.js instrumentation-client first. Try using this wizard to do it!',
    );
  }

  analytics.capture(WIZARD_INTERACTION, {
    action: 'started event setup',
    integration: INTEGRATION_NAME,
    instrumentationFilesCount: instrumentationFiles.length,
  });

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

  analytics.capture(WIZARD_INTERACTION, {
    action: 'analyzed project structure',
    integration: INTEGRATION_NAME,
    totalFiles: projectFiles.length,
    eligibleFiles: relativeFiles.length,
  });

  // Send file tree to AI to get 10 most useful files
  s.start('Selecting some files to enhance with events...');

  const fileSelectionPrompt = `Given this Next.js 15.3+ project structure and package.json, select up to 10 CLIENT-SIDE FILES for adding PostHog analytics events.
  
  IMPORTANT: Only select files that:
  - Have "use client" directive at the top, OR
  - Use React hooks (useState, useEffect, etc.), OR  
  - Have event handlers (onClick, onSubmit, onChange)
  
  DO NOT select:
  - API routes (files in /api/ or route.ts/route.js files)
  - Server Components (files without "use client" and no hooks/handlers)
  - Layout files (layout.tsx/layout.js)
  - Configuration files
  - Pure utility files
  
  Focus on:
  - User interaction points (buttons, forms, navigation)
  - Key user flows (auth, checkout, main features)
  - Business-critical paths
  - Files that represent important user actions
  
  Package.json:
  ${JSON.stringify(packageJson, null, 2)}
  
  Project files:
  ${relativeFiles.join('\n')}
  
  Return file paths for client-side files ONLY that would benefit most from analytics tracking. If there are fewer than 10 suitable client files, return only those.`;

  let selectedFiles: string[] = [];
  try {
    const response = await query({
      message: fileSelectionPrompt,
      model: 'gemini-2.5-flash',
      region: cloudRegion,
      schema: FileSelectionSchema,
      accessToken,
      projectId,
    });
    selectedFiles = response.files;
    s.stop(`Selected ${selectedFiles.length} files for event tracking`);
    analytics.capture(WIZARD_INTERACTION, {
      action: 'selected files for tracking',
      integration: INTEGRATION_NAME,
      filesSelected: selectedFiles.length,
    });
  } catch (error) {
    s.stop('Failed to select files');
    analytics.capture(WIZARD_INTERACTION, {
      action: 'file selection failed',
      integration: INTEGRATION_NAME,
      error: error instanceof Error ? error.message : 'Unknown error',
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

      const enhancePrompt = `You are enhancing a REAL production, client-side Next.js file with PostHog analytics. This is NOT an example or tutorial - add events to the ACTUAL code provided.
      
      - REQUIRED: import posthog from 'posthog-js'
      - Track events with: posthog.capture('event-name', { property: 'value' })
      - NEVER import PostHogClient from '@/app/posthog'
      - NEVER create functions with 'use server'

      CRITICAL INSTRUCTIONS:
      - This is a REAL file from a production codebase
      - DO NOT add placeholder comments like "// In a real app..." or "// This is an example..."
      - DO NOT modify the existing business logic or add simulation code
      - DO NOT add any tutorial-style comments
      - ONLY add PostHog event tracking to the existing, real functionality
      - DO NOT create wrapper functions around existing functions just to add tracking
      - Add tracking code directly inside existing functions where appropriate
      - NEVER import new packages or libraries that aren't already used in the file
      - ONLY use imports that already exist in the file or the PostHog imports specified
      - DO NOT assume any authentication library (Clerk, Auth.js, etc.) is available
      
      FORBIDDEN - NEVER DO THESE:
      - NEVER add 'use client' or 'use server' directives at the top of the file, or in functions
      - NEVER define new server actions (functions with "use server") in Client Components
      - NEVER create inline "use server" functions in files that have "use client"
      - NEVER use useEffect to track page views or component renders
      - NEVER track events like "page_viewed", "form_viewed", "component_rendered", "flow_started", "page_opened" etc
      - NEVER track that someone simply arrived at or viewed a page
      - NEVER change the file's existing client/server architecture
      - NEVER add events on component mount or render - only on actual user interactions
      - Track events on user interactions like clicks, form submissions, etc.
      
      Technical Rules:
      - This is a client-side file suitable for event tracking
      - REQUIRED IMPORT: import posthog from 'posthog-js'
      - Use the existing posthog instance for all tracking
      - Example: posthog.capture('button-clicked', { buttonId: 'submit' })
      - Focus on tracking user interactions in the UI components
      - Track events like button clicks, form submissions, navigation, etc.
      - Add 1-2 high-value events that track the ACTUAL user actions in this file
      - Use descriptive event names (lowercase-hyphenated) based on what the code ACTUALLY does
      - Include properties that capture REAL data from the existing code
      - For user identification: ONLY use user data that's already available in the code
      - DO NOT add code to fetch user IDs or authentication state if not already available in the file
      - Do not change the formatting of the file; only add events
      - Do not set timestamps on events; PostHog will do this automatically
      - Always return the entire file content, not just the changes
      - NEVER add events that correspond to page views; PostHog tracks these automatically
      - NEVER INSERT "use client" or "use server" directives
      
      File path: ${filePath}
      File content:
      ${fileContent}
      
      IMPORTANT: If this file only renders UI without any user interactions (no buttons, forms, or actions), 
      or if the only possible events would be pageview-like (e.g., "form-viewed", "page-opened", "flow-started"),
      then SKIP THIS FILE by returning the original content unchanged. We only want to track actual user actions,
      not that someone looked at a page.
      
      Return the enhanced file with PostHog tracking added to the EXISTING functionality. List the events you added.`;

      const response = await query({
        message: enhancePrompt,
        model: 'gemini-2.5-pro',
        region: cloudRegion,
        schema: EnhancedFileSchema,
        accessToken,
        projectId,
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
        analytics.capture(WIZARD_INTERACTION, {
          action: 'enhanced file',
          integration: INTEGRATION_NAME,
          filePath,
          eventsAdded: response.events.length,
        });
      } else {
        fileSpinner.stop(`No changes needed for ${filePath}`);
        analytics.capture(WIZARD_INTERACTION, {
          action: 'file skipped',
          integration: INTEGRATION_NAME,
          filePath,
          reason: 'no events to add',
        });
      }
    } catch (error) {
      fileSpinner.stop(`✗ Failed to enhance ${filePath}`);
      debug('Error enhancing file:', error);
      analytics.capture(WIZARD_INTERACTION, {
        action: 'file enhancement failed',
        integration: INTEGRATION_NAME,
        filePath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Generate event tracking report
  const generateMarkdown = () => {
    let md = `# Event tracking report\n\n`;
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
    md += `- (human: you can fill these in)`;

    md += `\n---\n\n`;
    md += `## Next Steps\n\n`;
    md += `1. Review the changes made to your files\n`;
    md += `2. Test that events are being captured correctly\n`;
    md += `3. Create insights and dashboards in PostHog\n`;
    md += `4. Make a list of events we missed above. Knock them out yourself, or give this file to an agent.\n\n`;
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

  analytics.capture(WIZARD_INTERACTION, {
    action: 'event setup completed',
    integration: INTEGRATION_NAME,
    totalEvents,
    filesEnhanced: enhancedFiles.length,
    filesProcessed: selectedFiles.length,
  });

  analytics.setTag('event-setup-total-events', totalEvents);
  analytics.setTag('event-setup-files-enhanced', enhancedFiles.length);

  clack.outro(
    `Success! Added ${chalk.bold(
      totalEvents.toString(),
    )} events across ${chalk.bold(enhancedFiles.length.toString())} files.
    
    Event tracking plan saved to: ${chalk.cyan(fileName)}
    
    Next steps:
    1. Review changes with your favorite git tool
    2. Revert unwanted changes with ${chalk.bold('git checkout <file>')}
    3. Test that events are being captured in your PostHog project
    4. Create insights in PostHog
    `,
  );
}

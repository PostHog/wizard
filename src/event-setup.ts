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
import chalk from 'chalk';
import { filePickerText } from './utils/file-picker-prompt';
import { query } from './utils/query';
import { z } from 'zod';
import {
  getFilesToChange,
  getRelevantFilesForIntegration,
  generateFileChangesForIntegration,
} from './utils/file-utils';
import { Integration } from './lib/constants';
import { getPackageVersion, hasPackageInstalled } from './utils/package-json';
import * as semver from 'semver';
import { enableDebugLogs } from './utils/debug';

// Schema for AI event suggestions
const EventSuggestionsSchema = z.object({
  names: z.array(z.string()),
  descriptions: z.array(z.string()),
});

type EventSuggestion = { name: string; description?: string; suggestedLocation?: string };

export async function runEventSetupWizard(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  clack.intro(
    `Let's get the basics of event tracking ready in your app. We'll generate a plan you can follow yourself, or with the help of an agent. You can always edit it later.
    
    To start, let's decide on a ${chalk.bold('North Star metric')}. A good North Star measures whether your product is on the right track.
    
    Examples:
    
    - ${chalk.bold('Total rides')} - Perfect for a ride-sharing app.
    - ${chalk.bold('Daily active users')} - Great for a social media platform.
    - ${chalk.bold('Signups')} - A good starting point for a very early-stage app.
    
    What top-level number could we track to measure the progress of your product?

    Learn more about picking a North Star metric: https://posthog.com/docs/new-to-posthog/getting-hogpilled
    
    `,
  );

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  const { wizardHash } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  const northStarMetric = await abortIfCancelled(
    clack.text({
      message: "What should we call your product's North Star metric?",
      placeholder: 'Total hedgehogs',
    }),
  );

  clack.note(
    `Great! We'll call it ${chalk.bold(northStarMetric)}.
    
    Now, let me suggest some events that could influence this metric...`,
  );

  // Get AI suggestions for events based on the North Star metric
  const s = clack.spinner();
  s.start('Analyzing your North Star metric to suggest relevant events');

  let eventSuggestions: EventSuggestion[] = [];
  try {
    const suggestionsPrompt = `For the metric "${northStarMetric}", provide 5 event names (lowercase-hyphenated like user-signed-up) and their descriptions. Events should be high-level, ocurring across the entire funnel leading to the North Star metric.`;

    const response = await query({
      message: suggestionsPrompt,
      region: cloudRegion,
      schema: EventSuggestionsSchema,
      wizardHash,
    });

    // Combine names and descriptions into EventSuggestion objects
    eventSuggestions = response.names.map((name: string, index: number) => ({
      name,
      description: response.descriptions[index] || `Track when ${name} occurs`,
    }));
    s.stop('Generated event suggestions');
  } catch (error) {
    s.stop('Could not generate suggestions, proceeding with manual entry');
    clack.log.warn('AI suggestions unavailable, you can enter events manually');
  }

  // Present suggestions to the user
  if (eventSuggestions.length > 0) {
    clack.log.info('Here are some suggested events based on your North Star metric:');
    eventSuggestions.forEach((suggestion, index) => {
      clack.log.info(`  ${index + 1}. ${chalk.bold(suggestion.name)} - ${suggestion.description}`);
    });
    clack.log.info('\nYou can use these suggestions or add your own events.');
  }

  clack.note(
    `Let's set up the events for your tracking plan.
    
    We want to keep this simple: not more than 8 events to get started.`,
  );

  const events: Array<{ name: string; location: string; description?: string }> = [];
  const maxEvents = 8;

  // Get relevant files for location suggestions
  const packageJson = await getPackageDotJson(options);
  const isNextJs = hasPackageInstalled('next', packageJson);
  let relevantFiles: string[] = [];

  if (isNextJs) {
    relevantFiles = await getRelevantFilesForIntegration({
      installDir: options.installDir,
      integration: Integration.nextjs,
    });
  }

  // Helper function to get AI-suggested file locations
  const getSuggestedLocation = async (eventName: string, eventDescription?: string): Promise<string | undefined> => {
    if (!isNextJs || relevantFiles.length === 0) {
      return undefined;
    }

    try {
      const locationPrompt = `Given a Next.js application with these files:\n${relevantFiles.slice(0, 50).join('\n')}\n\nWhere would be the most appropriate location to trigger the "${eventName}" event? ${eventDescription ? `This event ${eventDescription}.` : ''} Return just the file path, choosing from the existing files listed above.`;

      const LocationSchema = z.object({
        filePath: z.string(),
      });

      const response = await query({
        message: locationPrompt,
        region: cloudRegion,
        schema: LocationSchema,
        wizardHash,
      });

      return response.filePath;
    } catch {
      return undefined;
    }
  };

  // If we have suggestions, offer them first
  if (eventSuggestions.length > 0) {
    const useAISuggestions = await abortIfCancelled(
      clack.confirm({
        message: 'Would you like to use the AI-suggested events?',
        initialValue: true,
      }),
    );

    if (useAISuggestions) {
      for (const suggestion of eventSuggestions) {
        const s = clack.spinner();
        s.start(`Finding best location for "${suggestion.name}" event`);

        const suggestedLocation = await getSuggestedLocation(suggestion.name, suggestion.description);
        s.stop();

        const location = await filePickerText({
          message: `Where should the "${suggestion.name}" event be triggered?`,
          placeholder: suggestedLocation || 'Type @ to browse files',
          cwd: options.installDir,
        });

        if (clack.isCancel(location)) {
          abort('Setup cancelled');
        }

        events.push({
          name: suggestion.name,
          description: suggestion.description,
          location: location as string,
        });

        if (events.length >= maxEvents) {
          break;
        }
      }
    }
  }

  // Allow user to add additional custom events
  while (events.length < maxEvents) {
    const eventName = await abortIfCancelled(
      clack.text({
        message: `Enter an event name – or leave blank to finish:`,
        placeholder: 'e.g., user-signed-up',
      }),
    );

    if (!eventName) {
      break;
    }

    const s = clack.spinner();
    s.start(`Finding best location for "${eventName}" event`);

    const suggestedLocation = await getSuggestedLocation(eventName);
    s.stop();

    const location = await filePickerText({
      message: `Where should the "${eventName}" event be triggered?`,
      placeholder: suggestedLocation || 'Type @ to browse files',
      cwd: options.installDir,
    });

    if (clack.isCancel(location)) {
      abort('Setup cancelled');
    }

    events.push({
      name: eventName,
      location: location as string
    });
  }

  const generateMarkdown = () => {
    let md = `# Event tracking plan\n\n`;
    md += `## 🧭 North Star Metric: ${northStarMetric}\n\n`;
    md += `This document outlines the key events to track in order to measure and improve our North Star metric.\n\n`;
    md += `## Events\n\n`;
    events.forEach((event) => {
      md += `### ${event.name}\n`;
      md += `- **Description:** ${event.description || '[Add description here]'}\n`;
      md += `- **Location:** ${event.location}\n`;
      md += `- **Complete:** [ ]\n\n`;
    });
    md += `\n---\n\n`;
    md += `## 📊 Creating a Funnel Insight in PostHog\n\n`;
    md += `Once these events are implemented, you can use the PostHog MCP to create a funnel insight. This will help you visualize how users progress through these key events and identify where they drop off.\n\n`;
    md += `Learn more about creating funnels: https://posthog.com/docs/product-analytics/funnels\n`;
    return md;
  };

  const markdownContent = generateMarkdown();
  const fileName = 'PostHog event tracking plan.md';

  await fs.writeFile(fileName, markdownContent);

  // Check if this is a Next.js 15.3+ project with instrumentation-client
  let canAutoImplement = false;
  if (isNextJs) {
    const nextVersion = getPackageVersion('next', packageJson);
    const isNext15_3Plus = nextVersion && semver.gte(nextVersion, '15.3.0');

    if (isNext15_3Plus) {
      // Check for instrumentation-client file
      try {
        const instrumentationFiles = relevantFiles.filter(f =>
          f.includes('instrumentation') &&
          (f.endsWith('.ts') || f.endsWith('.js')) &&
          (f.includes('client') || f.includes('Client'))
        );

        if (instrumentationFiles.length > 0) {
          canAutoImplement = true;
        }
      } catch { }
    }
  }

  if (canAutoImplement && events.length > 0) {
    const autoImplement = await abortIfCancelled(
      clack.confirm({
        message: 'Would you like me to automatically add the event tracking code to your Next.js app?',
        initialValue: true,
      }),
    );

    if (autoImplement) {
      const s = clack.spinner();
      s.start('Adding event tracking code to your application');

      try {
        // Generate the event tracking documentation
        const eventTrackingDocs = generateEventTrackingDocumentation(events);

        // Get files that need to be changed
        const filesToChange = await getFilesToChange({
          integration: Integration.nextjs,
          relevantFiles: events.map(e => e.location),
          documentation: eventTrackingDocs,
          wizardHash,
          cloudRegion,
        });

        // Generate and apply the changes
        await generateFileChangesForIntegration({
          integration: Integration.nextjs,
          filesToChange,
          wizardHash,
          installDir: options.installDir,
          documentation: eventTrackingDocs,
          cloudRegion,
        });

        s.stop('Event tracking code added successfully!');

        clack.outro(
          `Success! Your event tracking plan has been saved to ${chalk.cyan(
            fileName,
          )} and the events have been added to your code. Review the changes to ensure they're correct.`,
        );
      } catch (error) {
        s.stop('Failed to add event tracking code automatically');
        clack.log.warn('Could not automatically add event tracking code. You can add it manually using the tracking plan.');

        clack.outro(
          `Your event tracking plan has been saved to ${chalk.cyan(
            fileName,
          )}. Review the plan and add the events manually to your app.`,
        );
      }
    } else {
      clack.outro(
        `Success! Your event tracking plan has been saved to ${chalk.cyan(
          fileName,
        )}. Review the plan to confirm it's correct. You can add the events manually when you're ready.`,
      );
    }
  } else {
    clack.outro(
      `Success! Your event tracking plan has been saved to ${chalk.cyan(
        fileName,
      )}. Review the plan to confirm it's correct. ${isNextJs ? 'To enable automatic event implementation, ensure you have Next.js 15.3+ with instrumentation-client set up.' : ''}`,
    );
  }
}

// Helper function to generate event tracking documentation
function generateEventTrackingDocumentation(events: Array<{ name: string; location: string; description?: string }>): string {
  let docs = `# Adding PostHog Event Tracking\n\n`;
  docs += `Import posthog from your PostHog client configuration and add these events:\n\n`;

  events.forEach(event => {
    docs += `## Event: ${event.name}\n`;
    if (event.description) {
      docs += `Description: ${event.description}\n\n`;
    }
    docs += `Location: ${event.location}\n\n`;
    docs += `Add this code where the event should be triggered:\n\n`;
    docs += `\`\`\`javascript\n`;
    docs += `posthog.capture('${event.name}', {\n`;
    docs += `  // Add any relevant properties here\n`;
    docs += `})\n`;
    docs += `\`\`\`\n\n`;
  });

  return docs;
}


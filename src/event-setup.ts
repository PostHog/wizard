import {
  abort,
  abortIfCancelled,
  askForItemSelection,
} from './utils/clack-utils';
import clack from './utils/clack';
import { WizardOptions } from './utils/types';
import * as fs from 'fs/promises';
import chalk from 'chalk';
import { filePickerText } from './utils/file-picker-prompt';

export async function runEventSetupWizard(
  options: WizardOptions,
): Promise<void> {
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

  const northStarMetric = await abortIfCancelled(
    clack.text({
      message: "What should we call your product's North Star metric?",
      placeholder: 'Total hedgehogs',
    }),
  );

  clack.note(
    `Great! We'll call it ${chalk.bold(northStarMetric)}.
    
    Now, let's think about the events that influence this specific metric.
    
    We want to keep this simple: not more than 8 events to get started.`,
  );

  const events: Array<{ name: string; location: string }> = [];
  const maxEvents = 8;

  for (let i = 0; i < maxEvents; i++) {
    const eventName = await abortIfCancelled(
      clack.text({
        message: `Enter an event name – or leave blank to finish:`,
        placeholder: 'e.g., user-signed-up',
      }),
    );

    if (!eventName) {
      break;
    }

    const location = await filePickerText({
      message: `Where should the "${eventName}" event be triggered?`,
      placeholder: 'Type @ to browse files',
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
      md += `- **Description:** [Add description here]\n`;
      md += `- **Location:** ${event.location}\n`;
      md += `- **Complete:** [ ]\n\n`;
    });
    md += `\n---\n\n`;
    md += `## 📊 Creating a Funnel Insight in PostHog\n\n`;
    md += `Once these events are implemented, you can use the PostHog MCP <(Multi-Channel Platform) >to create a funnel insight. This will help you visualize how users progress through these key events and identify where they drop off.\n\n`;
    md += `[Placeholder for detailed guidance on creating a funnel insight with the PostHog MCP]\n`;
    return md;
  };

  const markdownContent = generateMarkdown();
  const fileName = 'PostHog event tracking plan.md';

  await fs.writeFile(fileName, markdownContent);

  clack.outro(
    `Success! Your event tracking plan has been saved to ${chalk.cyan(
      fileName,
    )}. Review the plan to confirm it's correct. When you're ready, you can run the following command to add the events to your app: ${chalk.bold('@posthog/wizard -- execute-event-plan')}`,
  );
}


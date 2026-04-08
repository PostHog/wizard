/**
 * OLD FLOW: Single monolithic integration prompt.
 *
 * Used when the `wizard-queued-workflow` feature flag is OFF.
 * This prompt tells the agent to do everything in one shot:
 * load skill menu → install skill → follow workflow files → set env vars.
 *
 * Delete this file once the queued workflow is the only path.
 */

import {
  DEFAULT_PACKAGE_INSTALLATION,
  type FrameworkConfig,
} from '../framework-config.js';
import { AgentSignals } from '../agent-interface.js';

export function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    projectId: number;
  },
  frameworkContext: Record<string, unknown>,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  return `You have access to the PostHog MCP server which provides skills to integrate PostHog into this ${
    config.metadata.name
  } project.

Project context:
- PostHog Project ID: ${context.projectId}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog public token: ${context.projectApiKey}
- PostHog Host: ${context.host}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: Call load_skill_menu (from the wizard-tools MCP server) to see available skills.
   If the tool fails, emit: ${
     AgentSignals.ERROR_MCP_MISSING
   } Could not load skill menu and halt.

   Choose a skill from the \`integration\` category that matches this project's framework. Do NOT pick skills from other categories (llm-analytics, error-tracking, feature-flags, omnibus, etc.) — those are handled separately.
   If no suitable integration skill is found, emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 2: Call install_skill (from the wizard-tools MCP server) with the chosen skill ID (e.g., "integration-nextjs-app-router").
   Do NOT run any shell commands to install skills.

STEP 3: Load the installed skill's SKILL.md file to understand what references are available.

STEP 4: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write PostHog tokens directly to code files; always use environment variables.

STEP 5: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.


`;
}

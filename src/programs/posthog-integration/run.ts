/** PostHog integration's run recipe, independent of WizardSession and TUI state. */
import type {
  AgentRunDefinition,
  RunFlags,
  RunHooks,
  SeedTaskEntry,
} from '@agent/types';
import { AgentSignals, shouldDisableAsk } from '@agent';
import type { Credentials } from '@shared/posthog/api';
import type { HostResolution } from '@shared/posthog/host-resolution';
import type { FrameworkConfig } from '../frameworks/framework-config';
import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
} from '../frameworks/framework-config';
import type { DetectedSource } from '../warehouse-sources/types';
import { OutroKind } from '@agent';
import {
  WIZARD_INTERACTION_EVENT_NAME,
  type Integration,
} from '@shared/config/constants';
import { withUtm } from '@utils/links';
import { buildCodingAgentPrompt } from './handoff.js';

export const SETUP_REPORT_FILE = 'posthog-setup-report.md';
const WAREHOUSE_SOURCES_DOCS_URL =
  'https://posthog.com/docs/data-warehouse/sources';
const WAREHOUSE_SEED_TASK_TYPE = 'warehouse';
const WAREHOUSE_LINK_LIMIT = 3;

type TagValue = string | boolean | number | null | undefined;

export interface PosthogIntegrationRunInput {
  installDir: string;
  frameworkConfig: FrameworkConfig;
  frameworkContext: Record<string, unknown>;
  typescript: boolean;
  additionalFeatureQueue?: AgentRunDefinition['additionalFeatureQueue'];
  warehouseSources: readonly DetectedSource[];
  flags: Pick<RunFlags, 'ci' | 'signup' | 'e2eAsk'>;
  mayReportScanResults: boolean;
  /** Legacy TUI calls its separate seedTasks callback after resolving the run. */
  includeSeedTasks?: boolean;
  /** An earlier step may have produced a dashboard link already. */
  dashboardDeepLink?: unknown;
  /** Fallback for hosts that do not expose a live notebook URL getter. */
  notebookUrl?: string | null;
}

/** Effects a host supplies at the program boundary. No WizardSession is passed in. */
export interface PosthogIntegrationRunEffects {
  readPackageJson: (installDir: string) => Promise<unknown | null>;
  hasDeclaredDependency: (name: string, packageJson: unknown) => boolean;
  warn: (message: string) => void;
  setTag: (key: string, value: TagValue) => void;
  capture: (event: string, properties: Record<string, unknown>) => void;
  uploadEnvironmentVariables: (
    envVars: Record<string, string>,
    integration: Integration,
  ) => Promise<string[]>;
  requestDeepLink: (
    credentials: Credentials,
  ) => Promise<string | null | undefined>;
  openDashboardDeepLink: (taggedUrl: string) => void;
  getNotebookUrl?: () => string | null | undefined;
  setDashboardDeepLink?: (taggedUrl: string) => void;
}

export interface ResolvedPosthogIntegrationRun {
  run: AgentRunDefinition;
  hooks: RunHooks;
  seedTasks: SeedTaskEntry[];
}

function resolveContinueUrl(
  signup: boolean,
  host: HostResolution,
  deepLink: unknown,
): string | undefined {
  if (!signup) return undefined;
  if (typeof deepLink === 'string' && deepLink) return deepLink;
  return withUtm(`${host.appHost}/products?source=wizard`, 'outro-continue');
}

function warehouseSourceUrl(
  host: HostResolution,
  projectId: number | string,
  kind: string,
): string {
  const path = `${
    host.appHost
  }/project/${projectId}/data-warehouse/new-source?kind=${encodeURIComponent(
    kind,
  )}`;
  return withUtm(path, 'outro-warehouse');
}

function buildWarehouseNextSteps(
  sources: readonly DetectedSource[],
  host: HostResolution,
  projectId: number | string,
  completedSeededTypes: readonly string[],
): { heading: string; items: string[] } | undefined {
  if (completedSeededTypes.includes(WAREHOUSE_SEED_TASK_TYPE)) return undefined;
  if (sources.length === 0) return undefined;

  const listed = sources.slice(0, WAREHOUSE_LINK_LIMIT);
  const items = listed.map(
    (s) => `Connect ${s.label}: ${warehouseSourceUrl(host, projectId, s.kind)}`,
  );
  const remaining = sources.length - listed.length;
  if (remaining > 0)
    items.push(`And ${remaining} more we found in this project.`);
  items.push('Connect them all at once with: npx @posthog/wizard warehouse');
  return { heading: 'Query your other data in PostHog:', items };
}

function warehouseReportInstruction(
  sources: readonly DetectedSource[],
): string {
  if (sources.length === 0) return '';
  const labels = sources.map((s) => s.label).join(', ');
  return `Finally: this project also contains data sources PostHog can import (${labels}). In the setup report's "Verify before merging" checklist, add one item noting these were found and that \`npx @posthog/wizard warehouse\` will connect them to PostHog's data warehouse. Do not attempt to set them up yourself in this run.`;
}

/** The deterministic warehouse task decision is shared with the legacy adapter. */
export function resolvePosthogIntegrationSeedTasks(
  input: Pick<
    PosthogIntegrationRunInput,
    'warehouseSources' | 'flags' | 'mayReportScanResults'
  >,
  capture: PosthogIntegrationRunEffects['capture'],
): SeedTaskEntry[] {
  if (shouldDisableAsk(input.flags)) return [];
  const sources = input.warehouseSources;
  if (sources.length === 0) return [];
  if (input.mayReportScanResults) {
    capture('orchestrator warehouse task queued', {
      warehouse_source_count: sources.length,
      warehouse_source_kinds: sources.map((s) => s.kind),
    });
  }
  return [
    {
      type: WAREHOUSE_SEED_TASK_TYPE,
      inputs: {
        sources: sources.map((s) => ({
          kind: s.kind,
          label: s.label,
          mode: s.mode,
          matchedSignal: s.matchedSignal,
        })),
      },
      notice: {
        title: 'Connect your data sources',
        body: [
          'We detected some warehouse sources we can connect to enrich your PostHog data. Answer now, and we connect them at the end of the run, after your code changes. We will ask you for the credentials at that point, and beep when we do.',
          "You can select [Skip] if you'd like to do this later in PostHog.",
        ],
        items: sources.map((s) => s.label),
        docsLabel: 'Learn more about warehouse sources',
        docsUrl: WAREHOUSE_SOURCES_DOCS_URL,
        prompt: 'Connect these during setup?',
        confirmLabel: 'Continue [Enter]',
        cancelLabel: 'Skip [Esc]',
      },
    },
  ];
}

/** Resolve prompt, completion hooks and seeded tasks from explicit program data. */
export async function resolvePosthogIntegrationRun(
  input: PosthogIntegrationRunInput,
  effects: PosthogIntegrationRunEffects,
): Promise<ResolvedPosthogIntegrationRun> {
  const config = input.frameworkConfig;
  const typeScriptDetected = input.typescript;
  effects.setTag('typescript', typeScriptDetected);

  const usesPackageJson = config.detection.usesPackageJson !== false;
  let frameworkVersion: string | undefined;
  if (usesPackageJson) {
    const packageJson = await effects.readPackageJson(input.installDir);
    if (packageJson) {
      if (
        !effects.hasDeclaredDependency(
          config.detection.packageName,
          packageJson,
        )
      ) {
        effects.warn(
          `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
        );
      }
      frameworkVersion = config.detection.getVersion(packageJson);
    } else {
      effects.warn(
        'Could not find package.json. Continuing anyway — the agent will handle it.',
      );
    }
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    effects.setTag(`${config.metadata.integration}-version`, versionBucket);
  }
  const frameworkContext = input.frameworkContext;
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) =>
    effects.setTag(key, value),
  );

  let dashboardDeepLink = input.dashboardDeepLink;
  const run: AgentRunDefinition = {
    integrationLabel: config.metadata.integration,
    additionalMcpServers: config.metadata.additionalMcpServers,
    detectPackageManager: config.detection.detectPackageManager,
    spinnerMessage: SPINNER_MESSAGE,
    successMessage: config.ui.successMessage,
    estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
    reportFile: SETUP_REPORT_FILE,
    docsUrl: config.metadata.docsUrl,
    errorMessage: 'Integration failed',
    additionalFeatureQueue: input.additionalFeatureQueue,
    richLinks: true,
    customPrompt: (ctx) => {
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
- PostHog Project ID: ${ctx.projectId}
- Framework: ${config.metadata.name} ${frameworkVersion || 'latest'}
- TypeScript: ${typeScriptDetected ? 'Yes' : 'No'}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host.apiHost}
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
   If install_skill fails, emit on its own line: ${
     AgentSignals.SKILL_INSTALL_FAILED
   } <skill id — one-line reason>. Then CONTINUE and SKIP to STEP 5 the integration without the skill, following these steps and your knowledge of ${
        config.metadata.name
      } and PostHog's official docs, and note in the setup report that the skill could not be installed.

STEP 3: Load the installed skill's SKILL.md file to understand what references are available.

STEP 4: Follow the skill's program files in sequence. Look for numbered program files in the references (e.g., files with patterns like "1-", "2-", "3-"). Start with the first one and proceed through each step until completion. Each program file will tell you what to do and which file comes next. Never directly write PostHog tokens directly to code files; always use environment variables.

STEP 5: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys the project already sets, and where. Omit filePath and it scans every .env file in the project, so you don't have to guess between .env, .env.local and a nested one. It answers { status, foundIn } per key: "present" means a real env file sets the key, while a key found only in a committed template (.env.example and friends) reads as "missing" — a template documents a key rather than setting it, and is never a file to write credentials into.
   - Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses, then run its install command to add the SDK. Do not manually search for lockfiles or config files. If a file already EXISTS, read it immediately before you edit or overwrite it — writing from a stale read causes a tool failure. Creating a brand-new file needs no prior read: never read a path that does not exist yet; just write it.

${warehouseReportInstruction(input.warehouseSources)}
`;
    },
  };

  const hooks: RunHooks = {
    postRun: async (credentials) => {
      const envVars = config.environment.getEnvVars(
        credentials.projectApiKey,
        credentials.host.apiHost,
      );
      if (config.environment.uploadToHosting) {
        const uploadedEnvVars = await effects.uploadEnvironmentVariables(
          envVars,
          config.metadata.integration,
        );
        if (uploadedEnvVars.length > 0) {
          effects.capture(WIZARD_INTERACTION_EVENT_NAME, {
            action: 'wizard_env_vars_uploaded',
            integration: config.metadata.integration,
            variable_count: uploadedEnvVars.length,
            variable_keys: uploadedEnvVars,
          });
        }
      }
      if (input.flags.signup) {
        const deepLink = await effects.requestDeepLink(credentials);
        if (deepLink) {
          const taggedDeepLink = withUtm(deepLink, 'dashboard-deeplink');
          dashboardDeepLink = taggedDeepLink;
          effects.setDashboardDeepLink?.(taggedDeepLink);
          effects.openDashboardDeepLink(taggedDeepLink);
        }
      }
    },
    buildOutroNextSteps: (credentials, completedSeededTypes) =>
      buildWarehouseNextSteps(
        input.warehouseSources,
        credentials.host,
        credentials.projectId,
        completedSeededTypes,
      ),
    buildOutroData: (credentials) => {
      const envVars = config.environment.getEnvVars(
        credentials.projectApiKey,
        credentials.host.apiHost,
      );
      const continueUrl = resolveContinueUrl(
        input.flags.signup,
        credentials.host,
        dashboardDeepLink,
      );
      const changes = [
        ...config.ui.getOutroChanges(frameworkContext),
        Object.keys(envVars).length > 0
          ? 'Added environment variables to .env file'
          : '',
      ].filter(Boolean);
      const notebookUrl =
        effects.getNotebookUrl?.() ?? input.notebookUrl ?? undefined;
      return {
        kind: OutroKind.Success,
        message: 'Successfully installed PostHog!',
        changes,
        docsUrl: config.metadata.docsUrl,
        continueUrl,
        nextSteps: buildWarehouseNextSteps(
          input.warehouseSources,
          credentials.host,
          credentials.projectId,
          [],
        ),
        notebookUrl,
        handoffPrompt: notebookUrl
          ? buildCodingAgentPrompt(notebookUrl)
          : undefined,
      };
    },
  };

  return {
    run,
    hooks,
    seedTasks:
      input.includeSeedTasks === false
        ? []
        : resolvePosthogIntegrationSeedTasks(input, effects.capture),
  };
}

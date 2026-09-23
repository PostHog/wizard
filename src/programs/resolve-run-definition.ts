/** Resolve program run copy and prompts from data the host already prepared. */

import type { AgentRunDefinition } from '@agent/types';
import { LONGER_ASK_TIMEOUT_MS } from '@agent';
import type { AdditionalFeature } from '@shared/constants';
import type { SkillProgramOptions } from './agent-skill/index.js';
import { SPINNER_MESSAGE } from './framework-config';
import { AUDIT_ABORT_CASES } from './audit/detect.js';
import { AUDIT_REPORT_FILE } from './audit/types.js';
import { SETUP_REPORT_FILE } from './events-audit/constants.js';
import { WAREHOUSE_ABORT_CASES } from './warehouse-source/detect.js';
import type { DetectedSource } from './warehouse-sources/types.js';
import {
  SOURCE_MAPS_ABORT_CASES,
  type SkillVariant,
} from './error-tracking-upload-source-maps/detect.js';
import {
  buildSourceMapsUploadPrompt,
  SOURCE_MAPS_DETECTION_FAILED_PROMPT,
} from './error-tracking-upload-source-maps/prompt.js';

export type SourceMapsSelection = {
  variant?: SkillVariant;
  displayName?: string;
  projectPath?: string;
};

export type ProgramRunDefinitionInput = {
  typescript?: boolean;
  additionalFeatureQueue?: readonly AdditionalFeature[];
  warehouseSources?: readonly DetectedSource[];
  sourceMapsSelection?: SourceMapsSelection;
};

const AUDIT_DOCS_URL =
  'https://posthog.com/docs/product-analytics/best-practices';
const EVENTS_AUDIT_DOCS_URL = AUDIT_DOCS_URL;
export const ERROR_TRACKING_REPORT_FILE = 'posthog-error-tracking-report.md';
export const ERROR_TRACKING_DOCS_URL =
  'https://posthog.com/docs/error-tracking';
const WAREHOUSE_REPORT_FILE = 'posthog-warehouse-report.md';
export const SOURCE_MAPS_REPORT_FILE = 'posthog-source-maps-report.md';
export const SOURCE_MAPS_DOCS_URL =
  'https://posthog.com/docs/error-tracking/upload-source-maps';

export const AUDIT_PROGRAM_OPTIONS: SkillProgramOptions = {
  skillId: 'audit',
  command: 'audit',
  id: 'audit',
  description: 'Audit and improve your PostHog setup',
  integrationLabel: 'audit',
  customPrompt:
    'Run a comprehensive audit of the existing PostHog integration. Follow the skill program steps in order. Do not modify any project files — only create the final audit report.',
  successMessage:
    'Audit complete! You can view the audit report at ./posthog-audit-report.md',
  reportFile: AUDIT_REPORT_FILE,
  docsUrl: AUDIT_DOCS_URL,
  spinnerMessage: 'Auditing PostHog integration...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: AUDIT_ABORT_CASES,
};

export function resolveProgramRunDefinition(
  programId: string,
  input: ProgramRunDefinitionInput,
): AgentRunDefinition | undefined {
  switch (programId) {
    case 'audit':
      return resolveAuditRunDefinition();
    case 'events-audit':
      return resolveEventsAuditRunDefinition(input);
    case 'error-tracking':
      return resolveErrorTrackingRunDefinition();
    case 'warehouse-source':
      return resolveWarehouseSourceRunDefinition(input.warehouseSources ?? []);
    case 'error-tracking-upload-source-maps':
      return resolveSourceMapsRunDefinition(input.sourceMapsSelection);
    default:
      return undefined;
  }
}

export function resolveAuditRunDefinition(): AgentRunDefinition {
  const options = AUDIT_PROGRAM_OPTIONS;
  const prompt = options.customPrompt;
  return {
    skillId: options.skillId,
    integrationLabel: options.integrationLabel,
    customPrompt: prompt ? () => prompt : undefined,
    successMessage: options.successMessage,
    reportFile: options.reportFile,
    docsUrl: options.docsUrl,
    spinnerMessage: options.spinnerMessage,
    estimatedDurationMinutes: options.estimatedDurationMinutes,
    abortCases: options.abortCases,
  };
}

export function resolveEventsAuditRunDefinition(
  input: Pick<
    ProgramRunDefinitionInput,
    'typescript' | 'additionalFeatureQueue'
  >,
): AgentRunDefinition {
  const typeScriptDetected = input.typescript ?? false;
  return {
    skillId: 'events-audit',
    integrationLabel: 'events-audit',
    spinnerMessage: SPINNER_MESSAGE,
    successMessage:
      'Events audit complete! You can view the report at ./posthog-events-audit-report.md',
    estimatedDurationMinutes: 5,
    reportFile: SETUP_REPORT_FILE,
    docsUrl: EVENTS_AUDIT_DOCS_URL,
    errorMessage: 'Events audit failed',
    additionalFeatureQueue: input.additionalFeatureQueue,
    customPrompt: (ctx) =>
      `Audit PostHog event capture in this project. Do not modify any project files — produce a read-only report only.

Project context:
- PostHog Project ID: ${ctx.projectId}
- TypeScript: ${typeScriptDetected ? 'Yes' : 'No'}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host.apiHost}
`,
  };
}

/** Linear fallback prompt; the orchestrator uses its own flow instructions. */
const ERROR_TRACKING_PROMPT = `Set up PostHog error tracking end-to-end:

1. If PostHog is not integrated yet, install and initialize the SDK first —
   do not abort. Pick the matching variant from the skill menu's
   "integration-v2/install" and "integration-v2/init" categories.

2. Wire up exception capture: install the "error-tracking" skill variant that
   matches this project's platform (\`load_skill_menu\` with
   \`category: "error-tracking"\`) and follow it. Set capture up in one place —
   the SDK's own mechanism, never manual capture calls sprinkled across files.

3. When the platform ships minified bundles or stripped binaries (browser JS,
   React Native, iOS, Android, Flutter, Go, Rust), wire up source-map /
   debug-symbol upload too: install the matching
   "error-tracking-upload-source-maps" skill variant and follow it, including
   credentials and CI. Skip this step on platforms with readable stack traces
   (plain Python, Ruby, PHP, Elixir, JVM servers).

The final report is written to ./${ERROR_TRACKING_REPORT_FILE}.`;

export function resolveErrorTrackingRunDefinition(): AgentRunDefinition {
  return {
    integrationLabel: 'error-tracking',
    customPrompt: () => ERROR_TRACKING_PROMPT,
    successMessage: `Error tracking configured! View the report at ./${ERROR_TRACKING_REPORT_FILE}`,
    reportFile: ERROR_TRACKING_REPORT_FILE,
    docsUrl: ERROR_TRACKING_DOCS_URL,
    spinnerMessage: 'Setting up error tracking...',
    estimatedDurationMinutes: 8,
    askTimeoutMs: 30 * 60 * 1000,
  };
}

function warehousePrompt(sources: readonly DetectedSource[]): string {
  if (sources.length === 0)
    return 'Set up a data warehouse source for this project.';

  const lines = sources.map(
    (source) =>
      `- ${source.label} (kind: ${source.kind}, mode: ${source.mode}) — ${source.matchedSignal}`,
  );
  return [
    'The wizard detected the following data warehouse sources in this project:',
    ...lines,
    '',
    'Each signal names the file it came from. Trust that path — the wizard ' +
      'read it. To confirm a key is set, call `check_env_keys` with the key ' +
      'names and no `filePath`; it scans every `.env` file in the project.',
    '',
    'Set these up in PostHog following the skill instructions: create `in-cli` ' +
      'sources directly via the PostHog MCP after collecting credentials; for ' +
      '`deep-link` sources, provide the user the pre-filled new-source URL.',
    'Use the `kind` string exactly as printed above for `source_type` — ' +
      'PostHog rejects the display label.',
  ].join('\n');
}

export function resolveWarehouseSourceRunDefinition(
  sources: readonly DetectedSource[],
): AgentRunDefinition {
  const prompt = warehousePrompt(sources);
  return {
    skillId: 'data-warehouse-source-setup',
    integrationLabel: 'data-warehouse-source-setup',
    customPrompt: () => prompt,
    successMessage: 'Data warehouse source connected!',
    reportFile: WAREHOUSE_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/data-warehouse',
    spinnerMessage: 'Connecting your data source...',
    estimatedDurationMinutes: 5,
    askTimeoutMs: LONGER_ASK_TIMEOUT_MS,
    abortCases: WAREHOUSE_ABORT_CASES,
  };
}

export function resolveSourceMapsRunDefinition(
  selection?: SourceMapsSelection,
): AgentRunDefinition {
  const { variant, displayName, projectPath } = selection ?? {};
  const skillId = variant
    ? `error-tracking-upload-source-maps-${variant}`
    : undefined;
  return {
    integrationLabel: 'error-tracking-upload-source-maps',
    successMessage: 'Source maps wired up!',
    reportFile: SOURCE_MAPS_REPORT_FILE,
    docsUrl: SOURCE_MAPS_DOCS_URL,
    spinnerMessage: 'Wiring up source maps...',
    estimatedDurationMinutes: 3,
    abortCases: SOURCE_MAPS_ABORT_CASES,
    askTimeoutMs: 30 * 60 * 1000,
    customPrompt: (ctx) => {
      if (!skillId || !variant) return SOURCE_MAPS_DETECTION_FAILED_PROMPT;
      const uiHost = ctx.host.appHost.replace(/\/$/, '');
      return buildSourceMapsUploadPrompt({
        displayName,
        variant,
        skillId,
        projectPath,
        projectId: ctx.projectId,
        host: ctx.host.apiHost,
        settingsUrl: `${uiHost}/project/${ctx.projectId}/settings/user-api-keys`,
        uiHost,
        reportFile: SOURCE_MAPS_REPORT_FILE,
      });
    },
  };
}

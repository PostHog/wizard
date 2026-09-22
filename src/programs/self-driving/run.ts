import { join } from 'path';
import { access, rm } from 'node:fs/promises';
import type { AgentRunDefinition, RunHooks } from '@agent/types';
import { OutroKind } from '@agent';
import type { DetectedSource } from '@programs/warehouse-sources/types';
import { SELF_DRIVING_ABORT_CASES } from './detect.js';
import { buildSelfDrivingPrompt } from './prompt.js';
import { resolveSelfDrivingStepKey } from './step-keys.js';
import {
  NO_DEFAULT_LIMIT,
  PRICE_PER_PR_USD,
  PRICING_LONG,
} from '@shared/self-driving-pricing';

export const SELF_DRIVING_SKILL_ID = 'self-driving-setup';
export const REPORT_FILE = 'posthog-self-driving-report.md';
export const DOCS_URL = 'https://posthog.com/docs';
export const SUCCESS_MESSAGE =
  'Self-driving is on. PostHog is scanning your project; first findings ' +
  'hit your inbox within ~30 minutes.';
const WIZARD_MARKER = '.posthog-wizard';

export interface SelfDrivingRunInput {
  installDir: string;
  detectedTools: readonly DetectedSource[];
}

/** Marker-guarded cleanup for the transient setup skill. */
async function removeInstalledSkill(installDir: string): Promise<void> {
  const skillDir = join(installDir, '.claude', 'skills', SELF_DRIVING_SKILL_ID);
  try {
    await access(join(skillDir, WIZARD_MARKER));
  } catch {
    return;
  }
  await rm(skillDir, { recursive: true, force: true }).catch(() => undefined);
}

/** Resolve the agent recipe and completion hooks from caller-owned data. */
export function resolveSelfDrivingRun(input: SelfDrivingRunInput): {
  run: AgentRunDefinition;
  hooks: RunHooks;
} {
  const run: AgentRunDefinition = {
    skillId: SELF_DRIVING_SKILL_ID,
    integrationLabel: SELF_DRIVING_SKILL_ID,
    customPrompt: (ctx) =>
      buildSelfDrivingPrompt(ctx, [...input.detectedTools]),
    successMessage: SUCCESS_MESSAGE,
    reportFile: REPORT_FILE,
    docsUrl: DOCS_URL,
    spinnerMessage: 'Setting up PostHog Self-driving...',
    estimatedDurationMinutes: 10,
    abortCases: SELF_DRIVING_ABORT_CASES,
    maxQuestions: 13,
    richLinks: true,
    askTimeoutMs: 30 * 60 * 1000,
    trackStepProgress: true,
    resolveStepKey: resolveSelfDrivingStepKey,
  };

  const hooks: RunHooks = {
    postRun: async () => {
      await removeInstalledSkill(input.installDir);
    },
    buildOutroData: (credentials) => {
      const uiHost = credentials.host.appHost.replace(/\/$/, '');
      const inboxUrl = `${uiHost}/project/${credentials.projectId}/inbox`;
      return {
        kind: OutroKind.Success,
        message: SUCCESS_MESSAGE,
        primaryLink: { label: 'Your Self-driving inbox', url: inboxUrl },
        nextSteps: {
          heading: 'In your inbox you can:',
          items: [
            'Investigate reports with the agent',
            'Tag teammates to loop them in',
            `Kick off a PR when you like the proposed fix ($${PRICE_PER_PR_USD} flat)`,
            'Cap the spend with a monthly PR limit in the sidebar',
            'Or work from Slack (tag @PostHog) and MCP',
          ],
        },
        body: `${PRICING_LONG} ${NO_DEFAULT_LIMIT}`,
        reportFile: REPORT_FILE,
      };
    },
  };

  return { run, hooks };
}

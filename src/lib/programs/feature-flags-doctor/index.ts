import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { createSkillProgram } from '../agent-skill/index.js';
import { AUDIT_CHECKS_KEY } from '@lib/programs/audit/types';
import { seedAuditLedger } from '@lib/programs/audit/seed';
import { FEATURE_FLAGS_DOCTOR_PROGRAM } from './steps.js';
import { FEATURE_FLAGS_ABORT_CASES } from './detect.js';
import { FEATURE_FLAGS_DOCTOR_SEED_CHECKS } from './seed.js';

const REPORT_FILE = 'posthog-feature-flags-report.md';
const DOCS_URL = 'https://posthog.com/docs/feature-flags';

const baseConfig = createSkillProgram({
  skillId: 'audit-feature-flags',
  command: 'feature-flags',
  id: 'feature-flags-doctor',
  description: 'Verify and fix your PostHog feature flag setup',
  integrationLabel: 'feature-flags-doctor',
  successMessage:
    'Feature flags check complete! You can view the report at ./posthog-feature-flags-report.md',
  reportFile: REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Checking your feature flags...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: FEATURE_FLAGS_ABORT_CASES,
});

const doctorRun = (session: WizardSession): Promise<ProgramRun> => {
  // Seed the ledger so AuditRunScreen has rows to render before the agent
  // emits its first check update. Sweep rows grow via audit_add_checks.
  seedAuditLedger(session.installDir, FEATURE_FLAGS_DOCTOR_SEED_CHECKS);
  session.frameworkContext[AUDIT_CHECKS_KEY] = FEATURE_FLAGS_DOCTOR_SEED_CHECKS;

  if (!baseConfig.run || typeof baseConfig.run === 'function') {
    throw new Error('Feature flags doctor has no static run configuration.');
  }

  return Promise.resolve({
    ...baseConfig.run,
    customPrompt: (ctx) =>
      "Run the audit-feature-flags skill to check this project's PostHog " +
      'feature flag setup. Verify read-only first (static checks, then the ' +
      'live delivery and observability checks), then present the findings ' +
      'with a single wizard_ask multi-select and apply only the fixes the ' +
      'user chooses — editing project code and/or PostHog flags via the ' +
      'MCP — before writing the report. Honor the cleanup interlock: no ' +
      'tenant-side archive/disable options while evaluation reporting is ' +
      'unverified.\n\n' +
      'Project context:\n' +
      `- PostHog Project ID: ${ctx.projectId}\n` +
      `- PostHog public token: ${ctx.projectApiKey}\n` +
      `- PostHog Host: ${ctx.host.apiHost}\n`,
  });
};

export const featureFlagsDoctorConfig: ProgramConfig = {
  ...baseConfig,
  // Top-level reportFile so AuditRunScreen can resolve the report path
  // synchronously without unwrapping the deferred `run` function.
  reportFile: REPORT_FILE,
  steps: FEATURE_FLAGS_DOCTOR_PROGRAM,
  run: doctorRun,
  parentCommand: 'audit',
};

export { FEATURE_FLAGS_DOCTOR_PROGRAM } from './steps.js';
export {
  detectFeatureFlagsPrerequisites,
  FEATURE_FLAGS_ABORT_CASES,
  type FeatureFlagsDetectError,
} from './detect.js';

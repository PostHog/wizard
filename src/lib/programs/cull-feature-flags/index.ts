import * as path from 'path';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { resolveSkillVariantId } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';
import { getSkillsBaseUrl, Integration } from '@lib/constants';
import { detectFramework } from '@lib/detection/index';
import { ErrorCodes } from '@lib/errors';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import {
  AUDIT_CHECKS_FILE,
  AUDIT_CHECKS_KEY,
  coerceAuditChecks,
} from '@lib/programs/audit/types';
import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import type { ProgramId } from '@lib/programs/program-registry';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import type { WizardSession } from '@lib/wizard-session';
import { fetchSkillMenu } from '@lib/wizard-tools';
import { analytics } from '@utils/analytics';
import { readProjectFile } from '@utils/bounded-fs';
import { logToFile } from '@utils/debug';
import { wizardAbort } from '@utils/wizard-abort';
import { classifyFlags } from './classify.js';
import { fetchFeatureFlags } from './fetch.js';
import { buildCullOutro } from './outro.js';
import { scanFlagCallSites } from './scan.js';
import { buildCullPrompt, seedCullLedger } from './seed.js';
import type { FeatureFlag } from './types.js';
import {
  listModifiedTrackedPaths,
  listUncommittedPaths,
} from './working-tree.js';

export const CULL_FEATURE_FLAGS_REPORT_FILE =
  'posthog-feature-flag-cull-report.md';
const CULL_SKILL_GROUP = 'cull-feature-flags';
const PROGRAM_ID: ProgramId = 'cull-feature-flags';
const DOCS_URL = 'https://posthog.com/docs/feature-flags/best-practices';

/** Frameworks the scanner has patterns for; one context-mill variant each. */
export const CULL_FEATURE_FLAGS_SUPPORTED: ReadonlySet<Integration> = new Set([
  Integration.nextjs,
]);

const SCREEN_BY_STEP: Record<string, string> = {
  intro: 'cull-intro',
  run: 'audit-run',
};

const cullSteps: ProgramStep[] = AGENT_SKILL_STEPS.map((step) => {
  const override = SCREEN_BY_STEP[step.id];
  return override ? { ...step, screenId: override } : step;
});

const base = createSkillProgram({
  skillId: `${CULL_SKILL_GROUP}-nextjs`,
  command: 'cull-feature-flags',
  id: PROGRAM_ID,
  description:
    'Find stale PostHog feature flags in this project and remove the ones you pick',
  integrationLabel: 'cull-feature-flags',
  successMessage: `Feature flag cull complete! View the report at ./${CULL_FEATURE_FLAGS_REPORT_FILE}`,
  reportFile: CULL_FEATURE_FLAGS_REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Culling stale feature flags...',
  estimatedDurationMinutes: 5,
});

async function abortDirtyWorkingTree(paths: string[]): Promise<void> {
  const shown = paths.slice(0, 10).map((p) => `  ${p}`);
  const more = paths.length > 10 ? `  ...and ${paths.length - 10} more` : '';
  await wizardAbort({
    code: ErrorCodes.DetectDirtyWorkingTree,
    message:
      'This project has uncommitted changes. Culling edits files, and the undo is a plain git revert, ' +
      'which only works when the tree starts clean.\n\n' +
      'Commit or stash these first, then run the command again:\n' +
      [...shown, more].filter(Boolean).join('\n'),
    error: new Error('cull-feature-flags: dirty working tree'),
  });
}

async function abortUnsupportedPlatform(
  integration: Integration | undefined,
): Promise<void> {
  const name = integration
    ? FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration
    : 'this';
  await wizardAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `Feature flag culling has no scanner for ${name} projects yet. ` +
      'Supported today: Next.js.',
    error: new Error(
      `cull-feature-flags unsupported platform: ${integration ?? 'unknown'}`,
    ),
  });
}

async function resolveVariantSkillId(framework: Integration): Promise<string> {
  const menu = await fetchSkillMenu(getSkillsBaseUrl());
  const entries = menu ? Object.values(menu.categories).flat() : [];
  return (
    resolveSkillVariantId(entries, CULL_SKILL_GROUP, framework) ??
    `${CULL_SKILL_GROUP}-${framework}`
  );
}

async function abortFlagFetchFailed(error: unknown): Promise<void> {
  await wizardAbort({
    code: ErrorCodes.AuthProjectFetchFailed,
    message:
      "Could not read this project's feature flags from PostHog, so there is " +
      'nothing deterministic to propose. Check the token carries ' +
      'feature_flag:read and try again.',
    error: error instanceof Error ? error : new Error(String(error)),
  });
}

// Headless and CI paths resolve `run` before the runner's own auth step, so
// take the same path early; it is a no-op once credentials exist.
async function fetchFlagsOrAbort(
  session: WizardSession,
): Promise<FeatureFlag[]> {
  await authenticate(session, PROGRAM_ID);
  const credentials = session.credentials;
  if (!credentials) {
    await abortFlagFetchFailed(new Error('no credentials after authenticate'));
    return [];
  }
  try {
    return await fetchFeatureFlags(
      credentials.accessToken,
      credentials.host.apiHost,
      credentials.projectId,
    );
  } catch (error) {
    logToFile(`[cull-feature-flags] flag fetch failed: ${String(error)}`);
    analytics.wizardCapture('cull feature flags fetch failed');
    await abortFlagFetchFailed(error);
    return [];
  }
}

function readLedger(installDir: string) {
  const raw = readProjectFile(path.join(installDir, AUDIT_CHECKS_FILE));
  if (raw === null) return [];
  try {
    return coerceAuditChecks(JSON.parse(raw));
  } catch {
    return [];
  }
}

const cullRun = async (session: WizardSession): Promise<ProgramRun> => {
  const { installDir } = session;
  const uncommitted = listUncommittedPaths(installDir);
  if (uncommitted.length > 0) await abortDirtyWorkingTree(uncommitted);

  const framework = await detectFramework(installDir);
  if (!framework || !CULL_FEATURE_FLAGS_SUPPORTED.has(framework)) {
    await abortUnsupportedPlatform(framework);
  }
  const skillId = await resolveVariantSkillId(framework as Integration);

  const flags = await fetchFlagsOrAbort(session);
  const scan = await scanFlagCallSites(
    installDir,
    flags.map((flag) => flag.key),
  );
  const candidates = classifyFlags(flags, scan);
  const checks = seedCullLedger(installDir, candidates);
  session.frameworkContext[AUDIT_CHECKS_KEY] = checks;
  const flagIdByKey = new Map(
    candidates
      .filter((candidate) => candidate.flagId !== undefined)
      .map((candidate) => [candidate.key, candidate.flagId as number]),
  );
  analytics.wizardCapture('cull feature flags seeded', {
    framework,
    flags: flags.length,
    candidates: candidates.length,
    stale: candidates.filter((c) => c.verdict === 'stale').length,
    files_scanned: scan.filesScanned,
    truncated: scan.truncated,
  });

  const baseRun =
    typeof base.run === 'function' ? await base.run(session) : base.run;
  if (!baseRun) throw new Error('cull-feature-flags has no run configuration');

  return {
    ...baseRun,
    skillId,
    customPrompt: () =>
      buildCullPrompt({
        ledgerFile: AUDIT_CHECKS_FILE,
        candidates,
        scan,
      }),
    buildOutroData: (sess) =>
      buildCullOutro({
        checks: readLedger(sess.installDir),
        touchedFiles: listModifiedTrackedPaths(sess.installDir),
        flagIdByKey,
        installDir: sess.installDir,
        reportFile: CULL_FEATURE_FLAGS_REPORT_FILE,
        docsUrl: DOCS_URL,
      }),
  };
};

export const cullFeatureFlagsConfig: ProgramConfig = {
  ...base,
  steps: cullSteps,
  run: cullRun,
};

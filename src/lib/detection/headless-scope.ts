/**
 * Headless project scoping — agentic monorepo detection for headless
 * basic-integration runs.
 *
 * Mirrors self-driving's pattern: the host composes the UNTOUCHED integration
 * program and only decides which directory it runs against. Where self-driving
 * splices `integrationRunStep` into its own steps and supplies `targetDir`,
 * the headless install entry wraps the program config with
 * `withHeadlessAgenticScope`, whose `ciPreRun` preamble re-points
 * `session.installDir` to the project the agent labels `recommended` (the
 * main client/frontend/mobile app) before delegating to the program's own
 * `ciPreRun` — which then detects the framework inside that directory exactly
 * as it does for a single-project repo.
 *
 * Gated on the `basic-integration-agentic-detection` feature flag. Every
 * failure path leaves `session.installDir` untouched, falling back to the
 * unwrapped behavior.
 */

import { resolve, sep } from 'path';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY } from '@lib/constants';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramId } from '@lib/programs/program-registry';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import type { WizardSession } from '@lib/wizard-session';
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import {
  detectProjectsWithAgent,
  type AgenticDetectionReport,
  type AgenticProject,
  type DetectTarget,
} from './agentic.js';

/** Integration framework targets for the agentic detector (id → display name). */
const INTEGRATION_TARGETS: DetectTarget[] = Object.entries(
  FRAMEWORK_REGISTRY,
).map(([id, config]) => ({ id, name: config.metadata.name }));

/**
 * Compose a program config with the agentic scoping preamble: `ciPreRun`
 * first scopes `session.installDir` to the recommended project, then
 * delegates to the program's own `ciPreRun`. The program itself is untouched
 * — apply this at the headless install entry, never inside a program.
 */
export function withHeadlessAgenticScope(config: ProgramConfig): ProgramConfig {
  return {
    ...config,
    ciPreRun: async (session: WizardSession): Promise<void> => {
      await applyAgenticScope(session, config.id);
      await config.ciPreRun?.(session);
    },
  };
}

/**
 * Pick the project a headless run should integrate: the recommended project
 * when it's a supported framework — even if it already has PostHog, since
 * disqualifying the main app would silently instrument a secondary project
 * and the integration handles existing installs — else the first supported
 * project without PostHog, else null (caller keeps the install dir as-is).
 */
export function chooseProject(
  report: AgenticDetectionReport,
): AgenticProject | null {
  const recommended = report.projects.find(
    (p) => p.recommended === true && p.targetId != null,
  );
  if (recommended) return recommended;
  return (
    report.projects.find((p) => p.targetId != null && !p.hasPostHog) ?? null
  );
}

/**
 * Absolute dir for a chosen project path. The path is LLM output; if it
 * resolves outside the repo (defense-in-depth on top of the coerce-layer
 * clamp), fall back to the root rather than run the agent elsewhere.
 */
export function resolveProjectDir(installDir: string, rel: string): string {
  if (rel === '.') return installDir;
  const root = resolve(installDir);
  const dir = resolve(root, rel);
  return dir === root || dir.startsWith(root + sep) ? dir : root;
}

/**
 * Scope the session to the repo's recommended project. No-op unless the
 * `basic-integration-agentic-detection` flag is on for this user. On success
 * only `session.installDir` changes; detection failure or an empty result
 * logs, tags analytics, and returns with the session untouched.
 */
async function applyAgenticScope(
  session: WizardSession,
  programId: ProgramId,
): Promise<void> {
  // The detector needs credentials and the flag must evaluate as the
  // logged-in user; authenticate is idempotent, so bootstrap's later call
  // becomes a no-op instead of a second login.
  await authenticate(session, programId);

  const flags = await analytics.getAllFlagsForWizard();
  if (flags[BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY] !== 'true') return;

  getUI().log.info('Scanning the repo for projects...');
  let report: AgenticDetectionReport;
  try {
    report = await detectProjectsWithAgent(session, {
      targets: INTEGRATION_TARGETS,
      purpose: 'set up a PostHog SDK integration',
      recommend: true,
      onEvent: (line) => logToFile('[headless detect]', line),
    });
  } catch (err) {
    analytics.setTag('agentic_detection', 'error-fallback');
    getUI().log.warn(
      `Project scan failed (${
        err instanceof Error ? err.message : String(err)
      }); continuing with the install dir as-is.`,
    );
    return;
  }

  for (const project of report.projects) {
    const notes = [
      project.hasPostHog ? '(has PostHog)' : '',
      project.recommended ? '[recommended]' : '',
    ]
      .filter(Boolean)
      .join(' ');
    getUI().log.info(
      `Found ${project.path} — ${project.framework}${notes ? ` ${notes}` : ''}`,
    );
  }

  const project = chooseProject(report);
  if (!project) {
    analytics.setTag('agentic_detection', 'none-fallback');
    getUI().log.info(
      'The scan found no supported project; continuing with the install dir as-is.',
    );
    return;
  }

  session.installDir = resolveProjectDir(session.installDir, project.path);
  analytics.setTag(
    'agentic_detection',
    project.recommended ? 'recommended' : 'first-instrumentable',
  );
  getUI().log.info(`Continuing with ${project.path} (${project.framework}).`);
}

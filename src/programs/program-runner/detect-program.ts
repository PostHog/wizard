/** A program's detection, written into the session store before its run. */
import type { RunResult } from '@agent/types';
import { POSTHOG_DOCS_URL } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { WizardError } from '@shared/errors/wizard-error';
import fs from 'fs';
import path from 'path';
import { ProgramAbort } from '@programs/program-contract';
import {
  DISCOVERY_KEY,
  getDiscovery,
  projectFromWorkspaceRoot,
  runDiscovery,
  settleProjects,
} from '@services/project-discovery';
import { DECISIONS_USE_KEY } from '@services/detection/decisions';
import { detectErrorCode } from './detect-map';
import type { ProgramConfig } from '@programs/program-contract';
import type { CiRunnerContext } from '@programs/program-contract';
import type { WizardSession } from '@services/session';
import type { SessionStore } from '@services/session';

/** Whether `target` is a directory at or below `rootDir` once symlinks are resolved. */
function isDirectoryInside(rootDir: string, target: string): boolean {
  try {
    const root = fs.realpathSync(rootDir);
    const real = fs.realpathSync(target);
    return (
      fs.statSync(real).isDirectory() &&
      (real === root || real.startsWith(root + path.sep))
    );
  } catch {
    return false;
  }
}

/**
 * Point the run at one discovered project, the pair's: its directory becomes
 * the install dir and it becomes the run project. Aborts on a path discovery
 * did not find, and on one whose real directory is outside the workspace.
 */
export function scopeToProject(store: SessionStore, project: string): void {
  const { session } = store;
  const noProject = () =>
    new ProgramAbort({
      code: ErrorCodes.DetectBadDirectory,
      message: `No project at "${project}". Projects found: ${
        session.projects.map((found) => found.path).join(', ') || 'none'
      }.`,
    });
  const rootDir = getDiscovery(session)?.rootDir;
  if (!rootDir) {
    // No discovery: the one project is the one the run started in.
    if (project === session.runProject) return;
    throw noProject();
  }
  const target = path.resolve(rootDir, project);
  // A run that started below its project, such as in `apps/web/src`, still moves up to it.
  if (
    project === session.runProject &&
    target === path.resolve(session.installDir)
  ) {
    return;
  }
  if (
    !session.projects.some((found) => found.path === project) ||
    !isDirectoryInside(rootDir, target)
  ) {
    throw noProject();
  }
  // What the run already settled about the repo and its flags stays; what detection read in the old directory goes.
  store.scopeToProject(target, project, [DISCOVERY_KEY, DECISIONS_USE_KEY]);
}

/** Scope the store to the project a run works in: the one the caller names by its path from the workspace root, else the one it started in. */
export function scopeToRunProject(store: SessionStore, project?: string): void {
  scopeToProject(
    store,
    project === undefined
      ? store.session.runProject
      : projectFromWorkspaceRoot(store.session, project),
  );
}

/**
 * Scan the project for `config`: discovery, then the pair's project when the
 * caller names one by its path from the workspace root, then the program's
 * own detection in it. A CI session runs
 * the program's `ciPreRun` when it has one, anything else its `onReady`. Marks
 * detection complete.
 */
export async function detectProgram(
  config: ProgramConfig,
  store: SessionStore,
  runner: CiRunnerContext,
  project?: string,
): Promise<void> {
  await runDiscovery(config, store.readyContext());
  scopeToRunProject(store, project);
  const ciPreRun = config.ciPreRun;
  if (store.session.ci && ciPreRun) {
    await store.edit((draft) =>
      ciPreRun(draft, {
        ...runner,
        // The login lands in the store; the draft needs it too, or a scan of it sees none.
        authenticate: async (programId) => {
          await runner.authenticate(programId);
          const { credentials, apiProject, apiUser, roleAtOrganization } =
            store.session;
          Object.assign(draft, {
            credentials,
            apiProject,
            apiUser,
            roleAtOrganization,
          });
        },
      }),
    );
  } else {
    await config.onReady?.(store.readyContext());
  }
  // Detection has run, so the session's projects take their settled traits.
  settleProjects(store.readyContext());
  store.setDetectionComplete();
}

/** What detection found that stops the run: an unsupported version or an unmet prerequisite. */
export function detectionFailure(
  config: ProgramConfig,
  session: WizardSession,
): NonNullable<RunResult['failure']> | null {
  if (session.unsupportedVersion) {
    const { current, minimum, docsUrl } = session.unsupportedVersion;
    const code = ErrorCodes.DetectUnsupportedVersion;
    return {
      code,
      message:
        `Detected framework version ${current} is not supported. ` +
        `Minimum supported version is ${minimum}.\n\nSee ${docsUrl}`,
      error: new WizardError(
        `${config.id} unsupported framework version`,
        { integration: config.id, current, minimum },
        code,
      ),
    };
  }
  const detectError = session.frameworkContext.detectError as
    | { kind: string; [key: string]: unknown }
    | undefined;
  if (!detectError) return null;
  const code = detectErrorCode(detectError.kind);
  const docsUrl =
    (typeof config.run === 'object' ? config.run.docsUrl : undefined) ??
    POSTHOG_DOCS_URL;
  return {
    code,
    message: `Prerequisites not met: ${detectError.kind}\n\nSee ${docsUrl}`,
    // `kind` stays in the detail: several kinds share one code.
    detail: { ...detectError },
    error: new WizardError(
      `${config.id} prerequisites failed`,
      { integration: config.id, detect_error_kind: detectError.kind },
      code,
    ),
  };
}

/**
 * Full headless e2e — runs the REAL wizard integration flow against prod cloud,
 * driven entirely by WizardCiDriver. No Ink, no browser, no LoggingUI.
 *
 * Unlike classic `--ci` (LoggingUI: runs the agent then exits, skipping the
 * intro / setup / mcp / slack / keep-skills screens and offering only
 * stdout to assert on), this runs the WHOLE interactive flow — the driver makes
 * each human-side decision through the same store setters the Ink UI would, and
 * the run is observed through structured `read_state`.
 *
 *   POSTHOG_PERSONAL_API_KEY=… APP_DIR=/tmp/run-x PROJECT_ID=228144 \
 *     tsx scripts/e2e-full-run.no-jest.ts
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, RunPhase } from '@lib/wizard-session';
import { Program } from '@lib/programs/program-registry';
import { WizardCiDriver } from '@lib/ci-driver/wizard-ci-driver';
import { runAgent } from '@lib/agent/agent-runner';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import type { ScreenName } from '@ui/tui/router';
import {
  decideE2eAction,
  DEFAULT_E2E_PROFILE,
  type WizardE2eProfile,
} from '@lib/ci-driver/e2e-profile';
import { WizardRecorder } from '@lib/ci-driver/recorder';

const log = (m: string) => process.stdout.write(`[e2e] ${m}\n`);

/** Snapshot package.json deps + file list, to diff before/after. */
function snapshot(dir: string): { deps: string[]; files: Set<string> } {
  const files = new Set<string>();
  const walk = (d: string, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else files.add(r);
    }
  };
  walk(dir);
  let deps: string[] = [];
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    /* no package.json (some frameworks) */
  }
  return { deps, files };
}

async function main() {
  const apiKey = (process.env.POSTHOG_PERSONAL_API_KEY ?? '').trim();
  const appDir = process.env.APP_DIR!;
  const projectId = process.env.PROJECT_ID ?? '228144';
  // Happy-path e2e policy: skip MCP + Slack always; KEEP vs DELETE skills is the
  // one knob (default = delete, matching `wizard-ci --e2e`). Health-check issues
  // are always dismissed so a transient outage never blocks the run.
  const keepSkills = process.env.E2E_KEEP_SKILLS === 'true';
  if (!apiKey) throw new Error('Set POSTHOG_PERSONAL_API_KEY');
  if (!appDir || !fs.existsSync(appDir))
    throw new Error(`APP_DIR missing: ${appDir}`);

  const before = snapshot(appDir);
  log(
    `app: ${appDir}  (project ${projectId})  files=${before.files.size} deps=${before.deps.length}`,
  );

  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store)); // real UI, never rendered
  const session = buildSession({
    installDir: appDir,
    ci: true, // OAuth-bypass + ai-opt-in auto-consent; phx key as gateway bearer
    apiKey,
    projectId, // the key's scoped project — required, else bootstrap 403s
    region: 'us',
  });
  store.session = session;

  // Record the run as a timeline of key-moment frames (route changes, task
  // updates, status lines, …) so it can be replayed in the terminal later.
  const recorder = new WizardRecorder(store, {
    program: 'posthog-integration',
    app: path.basename(appDir),
  });
  recorder.start();

  const driver = new WizardCiDriver(store);

  // The program OWNS its e2e UI choices (ProgramConfig.e2e). The harness is
  // generic: it asks decideE2eAction what to commit on each screen. The
  // --keep-skills flag (E2E_KEEP_SKILLS) overrides the profile's skills policy.
  const profile: WizardE2eProfile = {
    ...DEFAULT_E2E_PROFILE,
    ...(posthogIntegrationConfig.e2e ?? {}),
    ...(keepSkills ? { skills: 'keep' as const } : {}),
  };
  log(`e2e profile: ${JSON.stringify(profile)}`);

  // Concurrent driver loop: commits the profile's decision on each screen as it
  // appears, until the run signals skillsComplete.
  const seen: ScreenName[] = [];
  let stop = false;
  const driverLoop = async () => {
    while (!stop && !store.session.skillsComplete) {
      const state = driver.readState();
      const before = state.currentScreen;
      if (seen[seen.length - 1] !== before) {
        seen.push(before);
        log(`screen → ${before}`);
      }
      let acted = false;
      try {
        const decision = decideE2eAction(state, profile);
        if (decision.action) {
          driver.performAction(
            decision.action.id,
            decision.action.params ?? {},
          );
          acted = true;
        }
        if (decision.done) stop = true;
      } catch (e) {
        log(`driver action error on ${before}: ${(e as Error).message}`);
      }
      // If our own commit already advanced the screen (driver-driven sequences
      // like outro→mcp→slack→keep-skills), loop immediately to drive the next
      // one. Only block on waitForChange when we're waiting on an EXTERNAL
      // transition (the health probe, auth bootstrap, or the agent run).
      if (acted && store.currentScreen !== before) continue;
      await driver.waitForChange(600_000);
    }
  };

  const drive = driverLoop();

  // Reproduce run-wizard.ts headlessly: detection → init probe → gates → agent.
  await store.runReadyHooks();
  log(`detected: ${store.session.integration ?? '(none)'}`);
  store.runInitHooks(); // fires the health-check readiness probe
  await store.getGate('intro');
  await store.getGate('health-check');
  log('gates cleared (intro + health) — starting real agent');

  await runAgent(posthogIntegrationConfig, store.session);
  log(`agent run finished: runPhase=${store.session.runPhase}`);

  // Let the driver walk the post-run screens to completion.
  const deadline = Date.now() + 120_000;
  while (!store.session.skillsComplete && Date.now() < deadline) {
    await driver.waitForChange(5_000);
  }
  stop = true;
  await Promise.race([drive, Promise.resolve()]);

  // "Delete skills" is a KeepSkillsScreen side-effect (it `rm`s the
  // wizard-installed skill dirs), not a store setter — so the headless driver's
  // keep_skills{kept:false} only flips the flag. Replicate the deletion here, in
  // the orchestrator, where fs side-effects belong. Mirrors the screen: remove
  // each wizard-marked skill dir, then the skills/ dir if it's left empty.
  let skillsDeleted = false;
  if (profile.skills === 'delete') {
    const skillsDir = path.join(appDir, '.claude', 'skills');
    if (fs.existsSync(skillsDir)) {
      for (const dir of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        if (fs.existsSync(path.join(skillsDir, dir.name, '.posthog-wizard'))) {
          fs.rmSync(path.join(skillsDir, dir.name), {
            recursive: true,
            force: true,
          });
          skillsDeleted = true;
        }
      }
      if (fs.readdirSync(skillsDir).length === 0) {
        fs.rmSync(skillsDir, { recursive: true, force: true });
      }
    }
    log(`skills deleted: ${skillsDeleted}`);
  }

  // Assertions: structured state + real file changes.
  const after = snapshot(appDir);
  const newDeps = after.deps.filter((d) => !before.deps.includes(d));
  const newFiles = [...after.files].filter((f) => !before.files.has(f));
  const hasPosthogDep = after.deps.some((d) =>
    d.toLowerCase().includes('posthog'),
  );
  // Detect a PostHog env file directly on disk (more robust than a file diff:
  // an .env may have pre-existed and only had keys appended).
  const envFile = [...after.files]
    .filter((f) => path.basename(f).startsWith('.env'))
    .find((f) => {
      try {
        return /POSTHOG/i.test(fs.readFileSync(path.join(appDir, f), 'utf8'));
      } catch {
        return false;
      }
    });

  log('');
  log('================ RESULT ================');
  log(`screen path : ${seen.join(' → ')}`);
  log(`runPhase    : ${store.session.runPhase}`);
  log(`skillsComplete: ${store.session.skillsComplete}`);
  log(`new deps    : ${newDeps.join(', ') || '(none)'}`);
  log(`posthog dep : ${hasPosthogDep}`);
  log(`new files   : ${newFiles.join(', ') || '(none)'}`);
  log(`.env written: ${envFile ?? 'no'}`);

  const integrated =
    store.session.runPhase === RunPhase.Completed &&
    (hasPosthogDep || !!envFile);
  log(
    `\n${
      integrated ? '✓ FULL INTEGRATION LANDED' : '✗ integration incomplete'
    }`,
  );
  log('========================================');

  // Structured result for a harness/orchestrator (e.g. the workbench service) to
  // assert on — the control plane's payoff over stdout-grepping classic --ci.
  const result = {
    integrated,
    installDir: appDir,
    screenPath: seen,
    runPhase: store.session.runPhase,
    skillsComplete: store.session.skillsComplete,
    skillsPolicy: profile.skills,
    skillsDeleted,
    newDeps,
    hasPosthogDep,
    newFiles,
    envFile: envFile ?? null,
  };
  const resultPath = process.env.E2E_RESULT_JSON;
  if (resultPath) {
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`result json → ${resultPath}`);
  }

  // Save the run recording and tell the caller how to replay it.
  recorder.stop();
  const recordingPath =
    process.env.E2E_RECORDING_JSON ??
    `/tmp/wizard-e2e-${path.basename(appDir)}.recording.json`;
  fs.writeFileSync(
    recordingPath,
    JSON.stringify(recorder.getRecording(), null, 2),
  );
  log(`recording (${recorder.frameCount} frames) → ${recordingPath}`);
  log(`replay it: tsx scripts/replay-e2e.no-jest.ts ${recordingPath} --step`);

  process.exit(integrated ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\nE2E_FAIL: ${e?.stack ?? e}\n`);
  process.exit(1);
});

// Keep the rsync helper reference so the import isn't dropped by tree-shaking
// in case a caller wants to copy from here later.
export const _copy = (from: string, to: string) =>
  execFileSync('rsync', [
    '-a',
    '--exclude',
    'node_modules',
    '--exclude',
    '.git',
    `${from}/`,
    `${to}/`,
  ]);

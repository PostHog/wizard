/**
 * CI snapshot route. Spawns the real wizard TUI in a PTY with a control socket,
 * self-drives the program's fixed e2e profile over that socket, and writes the
 * real rendered screen to SNAP_OUT/NN-<screen>.ans at every screen change,
 * task update, or run-phase change. Colors are preserved.
 *
 *   SNAP_OUT=/tmp/snaps APP_DIR=/tmp/app PROJECT_ID=… POSTHOG_KEY_FILE=… \
 *     npx tsx scripts/tui-snapshots.no-jest.ts
 *
 * PROGRAM picks the program (default posthog-integration). SNAP_HARNESS,
 * SNAP_SEQUENCE, SNAP_MODEL feed the switchboard overrides. E2E_ASK=true keeps
 * wizard_ask wired so the profile answers questions. E2E_RESULT_JSON, when set,
 * receives the structured result. Never prints the key.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { logToFile } from '@store';
import { getProgramConfig, Program } from '@store/programs';
import { ControlClient } from '@store/control';
import type { ControlState, ProgramId } from '@store/types';
import { captureTui } from '@e2e-harness/tui-capture';
import { buildLaunch, readApiKey, waitForSocket } from '@e2e-harness/launch';
import {
  decideE2eAction,
  type AskAnswerRule,
  type WizardE2eProfile,
} from '@e2e-harness/e2e-profile';
import { profileFor, resolveE2eProfile } from '@e2e-harness/profiles';
import {
  E2eRunRecorder,
  buildE2eResult,
  readReportFile,
} from '@e2e-harness/e2e-result';
import {
  pickIntegrationTarget,
  pickSourceMapsVariant,
} from '@e2e-harness/picks';

const OUT = process.env.SNAP_OUT!;
const APP_DIR = process.env.APP_DIR!;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mark = (m: string) => logToFile(`[tui-snapshots] ${m}`);

/** Extra `askAnswers` rules from `E2E_ANSWERS_FILE`, or none. */
function readAnswersFile(file: string | undefined): AskAnswerRule[] {
  if (!file) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as AskAnswerRule[]) : [];
  } catch (e) {
    mark(`could not read E2E_ANSWERS_FILE ${file}: ${(e as Error).message}`);
    return [];
  }
}

/** Run the app's build, standing in for the human the source-maps skill defers `npm run build` to. */
function runAppBuild(root: string): boolean {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of fs
        .readFileSync(path.join(root, name), 'utf8')
        .split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      /* no env file of this name */
    }
  }
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    env,
  });
  if (r.error || r.status !== 0) {
    mark(
      `app build failed (status=${r.status}): ${(
        r.stderr ||
        r.error?.message ||
        ''
      ).slice(-800)}`,
    );
    return false;
  }
  mark('app build succeeded');
  return true;
}

/** The dependency names an app manifest declares, one pattern per ecosystem. */
function posthogDependencies(appDir: string): string[] {
  const MANIFESTS: Array<[string, RegExp]> = [
    ['pubspec.yaml', /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm],
    ['go.mod', /^\s*([\w./-]+)\s+v[\w.-]+/gm],
    ['Cargo.toml', /^([A-Za-z0-9_-]+)\s*=/gm],
    ['pom.xml', /<artifactId>([^<]+)<\/artifactId>/g],
    ['build.gradle', /['"]([\w.-]+:[\w.-]+)[:'"]/g],
    ['mix.exs', /\{:([a-z_]+)\s*,/g],
  ];
  const deps: string[] = [];
  try {
    const pkg = JSON.parse(
      fs.readFileSync(`${appDir}/package.json`, 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps.push(...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
  } catch {
    /* not a JS project */
  }
  for (const [file, pattern] of MANIFESTS) {
    try {
      const text = fs.readFileSync(`${appDir}/${file}`, 'utf8');
      for (const match of text.matchAll(pattern)) deps.push(match[1]);
    } catch {
      /* app doesn't use this ecosystem */
    }
  }
  return [...new Set(deps.filter((d) => d.toLowerCase().includes('posthog')))];
}

function envFileWithPosthog(appDir: string): string | null {
  try {
    const hit = fs
      .readdirSync(appDir)
      .find(
        (f) =>
          (f.startsWith('.env') || f.endsWith('.env')) &&
          /posthog/i.test(fs.readFileSync(`${appDir}/${f}`, 'utf8')),
      );
    return hit ? `${appDir}/${hit}` : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const programId =
    (process.env.PROGRAM as ProgramId) || Program.PostHogIntegration;
  const programConfig = getProgramConfig(programId);
  const profile: WizardE2eProfile = resolveE2eProfile(profileFor(programId), {
    notice: process.env.E2E_NOTICE,
    extraAskAnswers: readAnswersFile(process.env.E2E_ANSWERS_FILE),
    env: process.env,
  });
  const runBuild = process.env.SOURCE_MAPS_RUN_BUILD === '1';
  const askOverrides: Record<string, Record<string, string | undefined>> = {
    [Program.ErrorTrackingUploadSourceMaps]: {
      'api-key': process.env.SOURCE_MAPS_CLI_KEY,
      'test-affordance': runBuild ? 'yes' : 'no',
    },
  };

  const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-snap-'));
  const socketPath = path.join(socketDir, 'w.sock');
  const launch = buildLaunch({
    programId,
    appDir: APP_DIR,
    socketPath,
    projectId: process.env.PROJECT_ID!,
    region: (process.env.POSTHOG_REGION as 'us' | 'eu' | undefined) ?? 'us',
    apiKey: readApiKey() || undefined,
    e2eAsk: process.env.E2E_ASK === 'true',
    integrate: process.env.INTEGRATE === 'true',
    harness: process.env.SNAP_HARNESS || undefined,
    sequence: process.env.SNAP_SEQUENCE || undefined,
    model: process.env.SNAP_MODEL || undefined,
    // Dumped, never pushed: an e2e run is synthetic, like `--ci`.
    taskStreamLog: process.env.TASK_STREAM_LOG ?? '',
  });
  const cap = captureTui({ ...launch, cwd: process.cwd() });
  let exited = false;
  void cap.exited.then(() => {
    exited = true;
  });
  await waitForSocket(socketPath, 120_000);
  const client = new ControlClient(socketPath);
  mark(`controlling ${programId} on ${socketPath}`);

  const recorder = new E2eRunRecorder();
  const screenPath: string[] = [];
  let seq = 0;
  let lastSig = '';
  let lastState: ControlState | null = null;
  let resultWritten = false;

  // Snapshot on key moments: a screen change, a task-list update, a phase
  // change, or a context value changing in place. Deduped by signature.
  const snap = async (state: ControlState): Promise<void> => {
    const sig = JSON.stringify({
      screen: state.currentScreen,
      overlay: state.hasOverlay,
      tasks: state.tasks.map((t) => [t.label, t.status]),
      phase: state.runPhase,
      ctx: state.frameworkContext.digest,
    });
    if (sig === lastSig) return;
    lastSig = sig;
    const screen = state.currentScreen;
    if (screenPath[screenPath.length - 1] !== screen) screenPath.push(screen);
    await sleep(500); // settle: let the frame finish drawing
    seq += 1;
    const file = path.join(
      OUT,
      `${String(seq).padStart(2, '0')}-${screen}.ans`,
    );
    fs.writeFileSync(file, cap.frameAnsi());
    console.log('snap ->', path.basename(file));
  };

  // Write the structured result once at the outro (terminal programs exit from
  // there) and again at the end, so an abort still leaves a payload behind.
  const writeResult = (state: ControlState | null): void => {
    if (!process.env.E2E_RESULT_JSON || resultWritten || !state) return;
    resultWritten = true;
    const deps = posthogDependencies(APP_DIR);
    fs.writeFileSync(
      process.env.E2E_RESULT_JSON,
      JSON.stringify(
        buildE2eResult({
          base: {
            runPhase: state.runPhase,
            hasPosthogDep: deps.length > 0,
            newDeps: deps,
            envFile: envFileWithPosthog(APP_DIR),
            screenPath,
            skillsComplete: state.session.skillsComplete,
          },
          recorder,
          session: {
            frameworkContext: state.frameworkContext.values,
            outroData: state.outroData,
          },
          tasks: state.tasks,
          reportFile: readReportFile(APP_DIR, programConfig.reportFile),
        }),
        null,
        2,
      ),
    );
  };
  process.on('exit', () => writeResult(lastState));

  // Release the run now: the runner still waits for the intro gate, so the
  // parent confirms setup in its own time, as the host's run_agent did.
  await client.armRun();

  let stop = false;
  while (!stop && !exited) {
    let state: ControlState;
    try {
      state = await client.state();
    } catch {
      break; // the wizard exited between polls
    }
    lastState = state;
    await snap(state);
    recorder.observe(state);
    if (state.currentScreen === 'outro') {
      writeResult(state);
      resultWritten = false; // the tail (keep-skills) rewrites it at the end
    }
    const before = state.currentScreen;

    // Detection picks the real screen resolves interactively.
    if (
      (before === 'self-driving-integration-detect' ||
        before === 'error-tracking-detect') &&
      state.session.integration == null
    ) {
      const pick = await pickIntegrationTarget(APP_DIR);
      if (!pick) {
        mark(`${before} found no framework to set up`);
        process.exit(1);
      }
      await client.performAction('pick_integration_target', pick);
      continue;
    }
    if (
      before === 'source-maps-detect' &&
      !state.frameworkContext.keys.includes('selectedVariant')
    ) {
      const picked = pickSourceMapsVariant(APP_DIR);
      if ('error' in picked) {
        mark(
          `source-maps detect found nothing to instrument: ${JSON.stringify(
            picked.error,
          )}`,
        );
        process.exit(1);
      }
      if (picked.fallback)
        mark(`source-maps detect: native fallback picked ${picked.variant}`);
      await client.performAction('pick_source_maps_project', {
        variant: picked.variant,
        path: '.',
      });
      continue;
    }

    // Program-specific ask answers take precedence over the profile strategy.
    if (before === 'wizard-ask') {
      const q = state.pendingQuestion?.questions[0];
      const override = q ? askOverrides[programId]?.[q.id] : undefined;
      if (q && override !== undefined) {
        await client.performAction('answer_question', {
          answers: { [q.id]: override },
        });
        continue;
      }
      if (
        runBuild &&
        programId === Program.ErrorTrackingUploadSourceMaps &&
        q?.id === 'test-done'
      ) {
        const ok = runAppBuild(APP_DIR);
        await client.performAction('answer_question', {
          answers: { [q.id]: ok ? 'yes' : 'no' },
        });
        continue;
      }
    }

    let acted = false;
    try {
      const decision = decideE2eAction(state, profile);
      if (decision.action) {
        await client.performAction(
          decision.action.id,
          decision.action.params ?? {},
        );
        acted = true;
      }
      if (decision.report) recorder.applyReport(decision.report);
      if (decision.done) stop = true;
    } catch (e) {
      mark(`action error on ${before}: ${(e as Error).message}`);
    }
    if (stop) break;
    try {
      if (acted && (await client.state()).currentScreen !== before) continue;
      state = await client.waitForChange(state.version, 600_000);
    } catch {
      break;
    }
  }

  // The integration flow ends on skillsComplete; the runner exits after that.
  const deadline = Date.now() + 120_000;
  while (!exited && Date.now() < deadline) {
    try {
      lastState = await client.waitForChange(lastState?.version ?? 0, 5_000);
      await snap(lastState);
    } catch {
      break;
    }
    if (lastState.session.skillsComplete) break;
  }
  if (lastState) await snap(lastState);
  resultWritten = false;
  writeResult(lastState);
  console.log(`done; ${seq} snapshots in ${OUT}`);
  cap.kill();
  process.exit(0);
}

main().catch((e: unknown) => {
  mark(`FATAL ${(e as Error)?.stack ?? String(e)}`);
  process.exit(1);
});

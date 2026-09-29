/**
 * Shared real-TUI host — the one primitive both e2e routes use.
 *
 * Runs the real TUI host, `runTui` (the real ink render → this process's
 * stdout, which the PTY parent captures), and drives it by pure state
 * manipulation through its control target, via `WizardCiDriver` — no
 * keystrokes. The run logs in with the phx key (same bearer as an OAuth token).
 *
 *   MODE=fixed  — self-drive the fixed e2e profile, snapshotting each screen
 *                 (the CI snapshot route).
 *   MODE=serve  — listen on CONTROL_SOCK for {read_state, perform_action,
 *                 run_agent} commands (the agent/MCP route).
 *
 * Never writes to stdout (that's the TUI); diagnostics go to the wizard log file.
 */
import fs from 'fs';
import net from 'net';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { Overlay, ScreenId, runTui } from '@tui';
import {
  apiKeyCredentials,
  buildSession,
  detectFramework,
  FRAMEWORK_REGISTRY,
  getProgramConfig,
  Program,
  type ProgramId,
} from '@programs';
import type { CredentialsProvider, SessionArgs } from '@programs/types';
import {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_CONTEXT_KEYS,
} from '@programs/error-tracking-upload-source-maps';
import type { GatewayCredential } from '@shared/api';
import type { Harness, Integration, Sequence } from '@shared/constants';
import type { ControlTarget } from '@shared/control/types';
import { initLocalDev } from '@shared/local-dev';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import { RunPhase } from '@shared/run-state';
import { logToFile } from '@utils/debug';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';
import {
  decideE2eAction,
  type AskAnswerRule,
  type WizardE2eProfile,
} from '@e2e-harness/e2e-profile';
import { profileFor, resolveE2eProfile } from '@e2e-harness/profiles';
import {
  E2eRunRecorder,
  buildE2eResult,
  createE2eResultWriter,
  readReportFile,
  type E2eObservedSession,
} from '@e2e-harness/e2e-result';

/** Cheap 32-bit FNV-1a, to fold framework-context values into a signature. */
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mark = (m: string) => logToFile(`[tui-host] ${m}`);

/** Tri-state: absent ⇒ `undefined`, so `resolveLocalDev` can apply the umbrella. */
function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  return raw === 'true';
}

/**
 * Pick the project to set PostHog up in, headlessly: the repo root if it's a
 * single app, else the first instrumentable sub-app of a monorepo (under
 * `apps/` or `packages/`). Mirrors what the detect screen's picker commits, so
 * the e2e host can drive a monorepo fixture (e.g. a Turborepo) without
 * keystrokes — the store driver can't actuate the interactive picker.
 */
async function pickIntegrationTarget(
  root: string,
): Promise<{ integration: Integration; path: string } | null> {
  // A monorepo: integrate a real sub-app, not the workspace root (which tends
  // to detect as generic node). Scan apps/ then packages/ for the first one
  // with a framework. Fall back to the root for a single-app fixture.
  for (const group of ['apps', 'packages']) {
    let entries: string[];
    try {
      entries = fs.readdirSync(join(root, group)).sort();
    } catch {
      continue; // group dir absent
    }
    for (const name of entries) {
      const rel = `${group}/${name}`;
      if (!fs.statSync(join(root, rel)).isDirectory()) continue;
      const fw = await detectFramework(join(root, rel));
      if (fw && FRAMEWORK_REGISTRY[fw]) return { integration: fw, path: rel };
    }
  }
  const rootFw = await detectFramework(root);
  return rootFw && FRAMEWORK_REGISTRY[rootFw]
    ? { integration: rootFw, path: '.' }
    : null;
}

/**
 * The variant to drive when the static prerequisite detector won't name one.
 *
 * `detectSourceMapsPrerequisites` deliberately does not automate native
 * platforms ("the legacy filesystem detector does not automate native
 * platforms" — detect.ts); the real screen resolves those through the agentic
 * picker, which the store driver cannot actuate. So mirror its verdict here,
 * or the run exits at the detect screen and no native fixture is ever
 * e2e-drivable.
 *
 * Two cases: the detector recognised the platform and only refused to automate
 * it (the name is in `detected`), or it returned "unknown" — Go and Rust,
 * which it never classifies — and the identifying manifest names it.
 */
function nativeVariantFor(root: string, detectError: unknown): string | null {
  const detected = (detectError as { detected?: string } | undefined)?.detected;
  if (detected && detected !== 'unknown') return detected;

  const manifests: ReadonlyArray<readonly [string, string]> = [
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['pubspec.yaml', 'flutter'],
    ['Package.swift', 'ios'],
    ['settings.gradle.kts', 'android'],
    ['settings.gradle', 'android'],
  ];
  for (const [file, variant] of manifests) {
    if (fs.existsSync(join(root, file))) return variant;
  }
  // CocoaPods-style iOS fixtures carry no Package.swift.
  try {
    if (
      fs
        .readdirSync(root)
        .some((f) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))
    ) {
      return 'ios';
    }
  } catch {
    /* unreadable root — the caller reports the original detect error */
  }
  return null;
}

// Run the app's build, returning success — stands in for the human the source-maps skill defers `npm run build` to. Opt in with SOURCE_MAPS_RUN_BUILD=1.
function runAppBuild(root: string): boolean {
  // Load the app's env file: the Next.js posthog plugin reads credentials from process.env at build time (unlike posthog-cli, which self-loads). The app's file wins over any POSTHOG_* the host inherited, else a stray host key shadows the fixture's upload key.
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of fs
        .readFileSync(join(root, name), 'utf8')
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

async function main() {
  const apiKey = (
    process.env.POSTHOG_PERSONAL_API_KEY ??
    (process.env.POSTHOG_KEY_FILE
      ? fs.readFileSync(process.env.POSTHOG_KEY_FILE, 'utf8')
      : '')
  ).trim();
  const projectId = process.env.PROJECT_ID!;
  // Which program to drive — defaults to the integration flow. Set PROGRAM to
  // an id (e.g. `self-driving`) to host a different one.
  const programId =
    (process.env.PROGRAM as ProgramId) || Program.PostHogIntegration;
  const programConfig = getProgramConfig(programId);
  const serving = process.env.MODE === 'serve';

  // This host answers wizard_ask via its e2e driver, so keep the ask bridge
  // wired even though the session is `ci` (which here is only for headless
  // auth). Without it, ask-driven flows like self-driving abort with
  // requires-interactive-mode the moment they need to ask a question.
  process.env.WIZARD_ASK_AUTODRIVE = '1';

  // The bin initializes the local-dev singleton from its yargs middleware;
  // this host bypasses yargs, so `getSkillsBaseUrl()` would silently resolve
  // to production even when the session carries the local flags. Initialize it
  // here from the same env-backed spellings, before anything reads it.
  initLocalDev({
    localDev: process.env.POSTHOG_WIZARD_LOCAL_DEV === 'true',
    localMcp: envFlag('POSTHOG_WIZARD_LOCAL_MCP'),
    localPosthog: envFlag('POSTHOG_WIZARD_LOCAL_POSTHOG'),
  });

  const session: SessionArgs = {
    installDir: process.env.APP_DIR!,
    ci: true,
    // Keep the `wizard_ask` bridge wired despite `ci: true`. The driver loop
    // below is the answerer — without this the agent-in-the-loop layer of a
    // flow (credential questions, the orchestrator's seeded warehouse task) is
    // never exercised. Only this host sets it; see `shouldDisableAsk`.
    e2eAsk: process.env.E2E_ASK === 'true',
    apiKey,
    projectId,
    region: 'us',
    // Same env-backed flags the bin declares. The harness usually wants local
    // skills (:8765) against the production MCP. The session has no
    // context-mill field: skills resolve through `getLocalDev`.
    localDev: process.env.POSTHOG_WIZARD_LOCAL_DEV === 'true',
    localMcp: envFlag('POSTHOG_WIZARD_LOCAL_MCP'),
    localPosthog: envFlag('POSTHOG_WIZARD_LOCAL_POSTHOG'),
    // Switchboard variation overrides (see e2e.json `variations`), threaded by
    // the snapshot driver as one run per variation. Empty ⇒ resolved default.
    harness: (process.env.SNAP_HARNESS || undefined) as Harness | undefined,
    sequence: (process.env.SNAP_SEQUENCE || undefined) as Sequence | undefined,
    model: process.env.SNAP_MODEL || undefined,
    // Dumped, never pushed: an e2e run is synthetic, like `--ci`.
    noTelemetry: true,
  };

  // The phx key logs in as `--ci` does, and the pre-issued gateway token rides on the login.
  const launched = buildSession(session);
  const keyLogin = apiKeyCredentials(apiKey, {
    region: 'us',
    baseUrl: launched.baseUrl,
    localMcp: launched.localMcp,
    projectId: Number(projectId),
  });
  let gateway: GatewayCredential | undefined;
  const login: CredentialsProvider = {
    resolve: async (id, context) => {
      const resolved = await keyLogin.resolve(id, context);
      gateway ??= readCiGatewayCredential('us');
      return { ...resolved, posthog: { ...resolved.posthog, gateway } };
    },
  };
  // Serve mode holds the login until run_agent, so a run with no key stops at auth.
  let releaseLogin = (): void => undefined;
  const loginReleased = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  const credentials: CredentialsProvider = serving
    ? {
        resolve: async (id, context) => {
          await loginReleased;
          return login.resolve(id, context);
        },
      }
    : login;

  const signals = new AbortController();
  process.once('SIGINT', () => signals.abort('SIGINT'));
  process.once('SIGTERM', () => signals.abort('SIGTERM'));

  let onAttach: (target: ControlTarget) => void = () => undefined;
  const attached = new Promise<ControlTarget>((resolve) => {
    onAttach = resolve;
  });
  const run = runTui(programConfig, {
    session,
    taskStreamLog: process.env.TASK_STREAM_LOG ?? '',
    credentials,
    control: {
      attach: (target) => {
        // Optional skip-ahead: pre-resolve the self-driving integration check so
        // its screen never shows (INTEGRATE=true integrates first; false = already set up).
        if (
          process.env.INTEGRATE === 'true' ||
          process.env.INTEGRATE === 'false'
        ) {
          target
            .setters()
            .find((s) => s.name === 'setIntegrate')
            ?.apply({ integrate: process.env.INTEGRATE === 'true' });
        }
        onAttach(target);
      },
    },
    signal: signals.signal,
  });
  // The run can end before the store exists, as when a local service is down.
  const target = await Promise.race([attached, run.then(() => null)]);
  if (!target) return process.exit(await run);
  const driver = new WizardCiDriver(target);

  if (serving) return serve(target, driver);
  return fixed(target, driver);

  // ---- agent route: drive commands over a unix socket ----
  function serve(target: ControlTarget, driver: WizardCiDriver) {
    void run.then((code) => process.exit(code));
    let released = false;
    // After run_agent, the run's phase says whether it is still going.
    const runStatus = (): 'idle' | 'running' | 'done' | 'failed' => {
      if (!released) return 'idle';
      const phase = target.readState().session.runPhase;
      if (phase === RunPhase.Completed) return 'done';
      if (phase === RunPhase.Error) return 'failed';
      return 'running';
    };
    const runError = (): string | null => {
      if (runStatus() !== 'failed') return null;
      const outro = observed(target).outroData;
      return outro?.message ?? outro?.body ?? null;
    };
    const handle = (req: {
      type: string;
      action?: string;
      params?: Record<string, unknown>;
    }) => {
      try {
        switch (req.type) {
          case 'read_state':
            return {
              ok: true,
              state: {
                ...driver.readState(),
                integration: runStatus(),
                integrationError: runError(),
              },
            };
          case 'perform_action':
            return {
              ok: true,
              state: driver.performAction(req.action!, req.params ?? {}),
            };
          case 'run_agent': {
            if (released) return { ok: true, runStatus: runStatus() };
            released = true;
            mark('run_agent: login released');
            releaseLogin();
            return { ok: true, runStatus: 'running' };
          }
          default:
            return { ok: false, error: `unknown command ${req.type}` };
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    };
    const server = net.createServer((sock) => {
      let buf = '';
      sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          sock.write(JSON.stringify(handle(JSON.parse(line))) + '\n');
        }
      });
    });
    const sockPath = process.env.CONTROL_SOCK!;
    try {
      fs.unlinkSync(sockPath);
    } catch {
      /* fresh */
    }
    server.listen(sockPath, () => mark(`serving on ${sockPath}`));
  }

  // ---- CI route: self-drive the fixed profile, snapshot each screen ----
  async function fixed(target: ControlTarget, driver: WizardCiDriver) {
    const CTRL = process.env.SNAP_CTRL!;
    // Fold the run's env inputs into the profile once, here. `decideE2eAction`
    // stays pure, so the same state + profile always yields the same decision.
    const profile: WizardE2eProfile = resolveE2eProfile(profileFor(programId), {
      notice: process.env.E2E_NOTICE,
      extraAskAnswers: readAnswersFile(process.env.E2E_ANSWERS_FILE),
      env: process.env,
    });
    // Source-maps ask answers: the upload key is vaulted to a secretRef; the test build runs only under SOURCE_MAPS_RUN_BUILD=1, else it's declined.
    const runBuild = process.env.SOURCE_MAPS_RUN_BUILD === '1';
    const askOverrides: Record<string, Record<string, string | undefined>> = {
      [Program.ErrorTrackingUploadSourceMaps]: {
        'api-key': process.env.SOURCE_MAPS_CLI_KEY,
        'test-affordance': runBuild ? 'yes' : 'no',
      },
    };
    const recorder = new E2eRunRecorder();
    const screenPath: string[] = [];
    // An abort ends the run from inside the runner, so hook `exit` too — see writeResult.
    process.on('exit', () => writeResult());
    // Snapshot on key moments — a screen change, a task-list update, or a
    // runPhase change — so the run screen's progression (the agent working) is
    // captured, not just screen transitions. The driver loop snaps each screen
    // before acting on it (so transitions are caught as presented); a store
    // subscription catches within-screen changes (the run). Deduped by
    // signature and serialized.
    let lastSig = '';
    let chain: Promise<void> = Promise.resolve();
    // Once the run ends the TUI is gone, so a pending snapshot signals nothing.
    let ended = false;
    const signature = () => {
      const state = driver.readState();
      return JSON.stringify({
        screen: state.currentScreen,
        overlay: state.hasOverlay,
        tasks: state.tasks.map((t) => [t.label, t.status]),
        phase: state.runPhase,
        // Values, not just keys: a screen rerendering from an artifact updated
        // in place (the audit ledger) keeps its key and would snap once, empty.
        ctx: digest(JSON.stringify(observed(target).frameworkContext)),
      });
    };
    const snap = (): Promise<void> => {
      const sig = signature();
      if (sig === lastSig) return chain;
      lastSig = sig;
      const screen = driver.readState().currentScreen;
      if (screenPath[screenPath.length - 1] !== screen) screenPath.push(screen);
      chain = chain.then(async () => {
        await sleep(500); // settle: let the frame finish drawing
        if (ended) return;
        fs.appendFileSync(CTRL, driver.readState().currentScreen + '\n');
        await sleep(300); // let the capturer capture before the screen moves on
      });
      return chain;
    };
    // Log every ask batch and task notice as it opens. The store fires on every
    // commit, so an overlay that opens and closes between two driver-loop turns
    // is still recorded.
    const unsub = target.subscribe(() => {
      recorder.observe(observed(target));
      void snap();
    });

    let stop = false;
    const driverLoop = async () => {
      while (!stop && !driver.readState().session.skillsComplete) {
        await snap(); // capture this screen as presented, before acting
        recorder.observe(observed(target));
        const state = driver.readState();
        const before = state.currentScreen;
        const offers = (id: string) => state.actions.some((a) => a.id === id);

        // Headless detect (self-driving, error tracking): commit the pick the picker would make.
        if (
          offers('pick_integration_target') &&
          state.session.integration == null
        ) {
          const pick = await pickIntegrationTarget(state.session.installDir);
          if (pick) {
            driver.performAction('pick_integration_target', pick);
            continue;
          }
          mark(`${before}: found no framework to set up`);
          if (programId === Program.ErrorTracking) process.exit(1);
          await driver.waitForChange(600_000);
          continue;
        }

        // Headless source-maps detect: the screen's candidate list lives in
        // its own agentic report (React state), so compute the pick here with
        // the static prerequisite detector — right for a single-app fixture —
        // and commit it through the driver the way the picker would.
        if (
          offers('pick_source_maps_project') &&
          observed(target).frameworkContext[
            SOURCE_MAPS_CONTEXT_KEYS.selectedVariant
          ] == null
        ) {
          const ctx: Record<string, unknown> = {};
          detectSourceMapsPrerequisites(state.session, (k, v) => {
            ctx[k] = v;
          });
          const detected = ctx[SOURCE_MAPS_CONTEXT_KEYS.skillVariant];
          const variant =
            typeof detected === 'string'
              ? detected
              : nativeVariantFor(
                  state.session.installDir,
                  ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError],
                );
          if (typeof variant !== 'string') {
            mark(
              'source-maps detect found nothing to instrument: ' +
                JSON.stringify(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]),
            );
            process.exit(1);
          }
          if (typeof detected !== 'string') {
            mark(`source-maps detect: native fallback picked ${variant}`);
          }
          driver.performAction('pick_source_maps_project', {
            variant,
            path: '.',
          });
          continue;
        }

        // Program-specific ask answers take precedence over the generic
        // profile strategy.
        if (state.currentScreen === Overlay.WizardAsk) {
          const q = state.pendingQuestion?.questions[0];
          const override = q ? askOverrides[programId]?.[q.id] : undefined;
          if (q && override !== undefined) {
            driver.performAction('answer_question', {
              answers: { [q.id]: override },
            });
            continue;
          }
          // test-done: run the real build, answer by outcome.
          if (
            runBuild &&
            programId === Program.ErrorTrackingUploadSourceMaps &&
            q?.id === 'test-done'
          ) {
            const ok = runAppBuild(state.session.installDir);
            driver.performAction('answer_question', {
              answers: { [q.id]: ok ? 'yes' : 'no' },
            });
            continue;
          }
        }

        let acted = false;
        try {
          const decision = decideE2eAction(state, profile);
          if (decision.action) {
            // The terminal commit ends the run and releases the terminal: let the capturer take this frame first.
            if (decision.done) await sleep(500);
            driver.performAction(
              decision.action.id,
              decision.action.params ?? {},
            );
            acted = true;
          }
          // Only the decision knows how it resolved an ask or a notice; the
          // report is ids and a verdict, never an answer value.
          if (decision.report) recorder.applyReport(decision.report);
          if (decision.done) stop = true;
        } catch (e) {
          mark(`action error on ${before}: ${(e as Error).message}`);
        }
        if (acted && driver.readState().currentScreen !== before) continue;
        if (!stop) await driver.waitForChange(600_000);
      }
    };
    void driverLoop();

    // Write the structured result the --e2e assertion path reads. Programs whose
    // outro is terminal (self-driving) exit via the outro's ExitScreen before
    // the end-of-run path below, so capture it the moment the outro is reached;
    // integration re-writes it after keep-skills (skillsComplete). Registered
    // on `exit` too: `wizardAbort` renders the error outro and ends the run, and
    // an aborted run would otherwise write nothing at all.
    const buildResult = () => {
      const appDir = process.env.APP_DIR!;
      const state = driver.readState();
      // One dependency-name pattern per ecosystem manifest. A run only needs
      // the names, so a line-level scan beats per-format parsers.
      const MANIFESTS: Array<[string, RegExp]> = [
        ['pubspec.yaml', /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm],
        ['go.mod', /^\s*([\w.\/-]+)\s+v[\w.-]+/gm],
        ['Cargo.toml', /^([A-Za-z0-9_-]+)\s*=/gm],
        ['pom.xml', /<artifactId>([^<]+)<\/artifactId>/g],
        ['build.gradle', /['"]([\w.-]+:[\w.-]+)[:'"]/g],
        ['mix.exs', /\{:([a-z_]+)\s*,/g],
      ];
      const deps: string[] = [];
      try {
        // package.json needs a real parse: a line scan would also match script
        // names, and only the dependency blocks carry dependencies.
        const pkg = JSON.parse(
          fs.readFileSync(`${appDir}/package.json`, 'utf8'),
        );
        deps.push(
          ...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }),
        );
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
      const posthogDeps = [
        ...new Set(deps.filter((d) => d.toLowerCase().includes('posthog'))),
      ];
      let envFile: string | null = null;
      try {
        const hit = fs
          .readdirSync(appDir)
          .find(
            (f) =>
              (f.startsWith('.env') || f.endsWith('.env')) &&
              /posthog/i.test(fs.readFileSync(`${appDir}/${f}`, 'utf8')),
          );
        envFile = hit ? `${appDir}/${hit}` : null;
      } catch {
        /* none */
      }
      return buildE2eResult({
        base: {
          runPhase: state.runPhase,
          hasPosthogDep: posthogDeps.length > 0,
          newDeps: posthogDeps,
          envFile,
          screenPath,
          skillsComplete: state.session.skillsComplete,
        },
        recorder,
        session: observed(target),
        tasks: state.tasks,
        reportFile: readReportFile(appDir, programConfig.reportFile),
      });
    };
    const writeResult = createE2eResultWriter(
      process.env.E2E_RESULT_JSON,
      buildResult,
    );
    const unsubResult = target.subscribe(() => {
      if (target.readState().currentScreen === ScreenId.Outro) writeResult();
    });

    // Once the run settled into its follow-up screens, a stall there gets two minutes.
    const followUp = (screen: string): boolean =>
      FOLLOW_UP_SCREENS.has(screen) || screen.endsWith('-outro');
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = async (code: number, mounted: boolean): Promise<never> => {
      stop = true;
      unsub();
      unsubResult();
      unsubDeadline();
      clearTimeout(deadline);
      if (mounted) {
        await snap(); // the final screen
        await chain; // flush any pending snapshots
      }
      ended = true;
      writeResult(mounted || driver.readState().session.skillsComplete);
      process.exit(code);
    };
    const unsubDeadline = target.subscribe(() => {
      const state = driver.readState();
      const settled =
        (state.runPhase === RunPhase.Completed ||
          state.runPhase === RunPhase.Error) &&
        followUp(state.currentScreen);
      if (!settled) {
        clearTimeout(deadline);
        deadline = undefined;
      } else if (!deadline) {
        deadline = setTimeout(() => void finish(0, true), 120_000);
      }
    });

    await finish(await run, false);
  }
}

/** The screens after a program's last run: its outro and the integration tail. */
const FOLLOW_UP_SCREENS: ReadonlySet<string> = new Set<string>([
  ScreenId.Outro,
  ScreenId.MintFailure,
  ScreenId.Mcp,
  ScreenId.SlackConnect,
  ScreenId.KeepSkills,
  ScreenId.Exit,
]);

/** The session fields the result reads, from the target's projected state. */
function observed(target: ControlTarget): E2eObservedSession {
  return target.readState().session as unknown as E2eObservedSession;
}

/** Extra `askAnswers` rules from `E2E_ANSWERS_FILE`, or none. */
function readAnswersFile(file: string | undefined): AskAnswerRule[] {
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as AskAnswerRule[]) : [];
  } catch (e) {
    mark(`could not read E2E_ANSWERS_FILE ${file}: ${(e as Error).message}`);
    return [];
  }
}

main().catch((e) => {
  mark('FATAL ' + (e?.stack ?? e));
  process.exit(1);
});

/**
 * Shared real-TUI host — the one primitive both e2e routes use.
 *
 * Runs the real `startTUI` (real ink render → this process's stdout, which the
 * PTY parent captures) and drives its store by pure state manipulation via
 * `WizardCiDriver` — no keystrokes. Auth is satisfied by `setCredentials` with
 * the phx key (same bearer as an OAuth token).
 *
 *   MODE=fixed  — self-drive the fixed e2e profile, snapshotting each screen
 *                 (the CI snapshot route).
 *   MODE=serve  — listen on CONTROL_SOCK for {read_state, perform_action,
 *                 set_credentials, run_agent} commands (the agent/MCP route).
 *
 * Never writes to stdout (that's the TUI); diagnostics go to the wizard log file.
 */
import fs from 'fs';
import net from 'net';
import { startTUI } from '@ui/tui/start-tui';
import { VERSION } from '@lib/version';
import {
  Program,
  getProgramConfig,
  type ProgramId,
} from '@lib/programs/program-registry';
import type { Harness, Sequence } from '@lib/constants';
import { buildSession } from '@lib/wizard-session';
import { runAgent } from '@lib/agent/agent-runner';
import { getOrAskForProjectData } from '@utils/setup-utils';
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
  readReportFile,
} from '@e2e-harness/e2e-result';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mark = (m: string) => logToFile(`[tui-host] ${m}`);

/** Tri-state: absent ⇒ `undefined`, so `resolveLocalDev` can apply the umbrella. */
function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  return raw === 'true';
}

async function main() {
  const apiKey = (
    process.env.POSTHOG_PERSONAL_API_KEY ??
    (process.env.POSTHOG_KEY_FILE
      ? fs.readFileSync(process.env.POSTHOG_KEY_FILE, 'utf8')
      : '')
  ).trim();
  const projectId = process.env.PROJECT_ID!;

  // Which program to drive — PROGRAM env from the workbench e2e runner;
  // defaults to the integration flow. getProgramConfig throws on unknown ids.
  const programId = (process.env.PROGRAM ||
    Program.PostHogIntegration) as ProgramId;
  const programConfig = getProgramConfig(programId);

  const { store } = startTUI(VERSION, programId);
  store.session = buildSession({
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
    // skills (:8765) against the production MCP.
    localDev: process.env.POSTHOG_WIZARD_LOCAL_DEV === 'true',
    localMcp: envFlag('POSTHOG_WIZARD_LOCAL_MCP'),
    localContextMill: envFlag('POSTHOG_WIZARD_LOCAL_CONTEXT_MILL'),
    localPosthog: envFlag('POSTHOG_WIZARD_LOCAL_POSTHOG'),
    // Switchboard variation overrides (see e2e.json `variations`), threaded by
    // the snapshot driver as one run per variation. Empty ⇒ resolved default.
    harness: (process.env.SNAP_HARNESS || undefined) as Harness | undefined,
    sequence: (process.env.SNAP_SEQUENCE || undefined) as Sequence | undefined,
    model: process.env.SNAP_MODEL || undefined,
  });
  const driver = new WizardCiDriver(store);

  // Resolve credentials from the phx key (same bearer as an OAuth token) and set
  // them on the store — advances the auth screen with no browser, no keystrokes.
  const authByState = async () => {
    const d = await getOrAskForProjectData({
      signup: false,
      ci: true,
      apiKey,
      projectId: Number(projectId),
      programId,
    });
    store.setCredentials({
      accessToken: d.accessToken,
      projectApiKey: d.projectApiKey,
      host: d.host,
      projectId: d.projectId,
    });
  };

  // Pass the intro and health-check gates and run the program's real agent.
  // The auth and run screens never advance on their own; this is what moves them.
  const runIntegration = async () => {
    await store.getGate('intro');
    await store.getGate('health-check');
    await runAgent(programConfig, store.session);
  };

  if (process.env.MODE === 'serve') return serve();
  return fixed();

  // ---- agent route: drive commands over a unix socket ----
  function serve() {
    let runStatus: 'idle' | 'running' | 'done' | 'failed' = 'idle';
    let runError: string | null = null;
    const handle = async (req: {
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
                integration: runStatus,
                integrationError: runError,
              },
            };
          case 'perform_action':
            return {
              ok: true,
              state: driver.performAction(req.action!, req.params ?? {}),
            };
          case 'set_credentials':
            await authByState();
            return { ok: true, state: driver.readState() };
          case 'run_agent': {
            if (runStatus === 'running' || runStatus === 'done')
              return { ok: true, runStatus };
            runStatus = 'running';
            void (async () => {
              try {
                await runIntegration();
                runStatus = 'done';
              } catch (e) {
                runStatus = 'failed';
                runError = (e as Error).message;
                mark('run_agent error ' + runError);
              }
            })();
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
          void handle(JSON.parse(line)).then((res) =>
            sock.write(JSON.stringify(res) + '\n'),
          );
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
    void store.runReadyHooks(); // detection so the intro screen fills in
  }

  // ---- CI route: self-drive the fixed profile, snapshot each screen ----
  async function fixed() {
    const CTRL = process.env.SNAP_CTRL!;
    // Fold the run's env inputs into the profile once, here. `decideE2eAction`
    // stays pure, so the same state + profile always yields the same decision.
    const profile: WizardE2eProfile = resolveE2eProfile(profileFor(programId), {
      notice: process.env.E2E_NOTICE,
      extraAskAnswers: readAnswersFile(process.env.E2E_ANSWERS_FILE),
      env: process.env,
    });
    const recorder = new E2eRunRecorder();
    const screenPath: string[] = [];
    let resultWritten = false;
    // An abort exits from inside the runner, so hook `exit` too — see writeResult.
    process.on('exit', () => writeResult());
    // Snapshot on key moments — a screen change, a task-list update, or a
    // runPhase change — so the run screen's progression (the agent working) is
    // captured, not just screen transitions. The driver loop snaps each screen
    // before acting on it (so transitions are caught as presented); a store
    // subscription catches within-screen changes (the run). Deduped by
    // signature and serialized.
    let lastSig = '';
    let chain: Promise<void> = Promise.resolve();
    const signature = () =>
      JSON.stringify({
        screen: store.currentScreen,
        overlay: store.router.hasOverlay,
        tasks: store.tasks.map((t) => [t.label, t.status, t.done]),
        phase: store.session.runPhase,
      });
    const snap = (): Promise<void> => {
      const sig = signature();
      if (sig === lastSig) return chain;
      lastSig = sig;
      const screen = store.currentScreen;
      if (screenPath[screenPath.length - 1] !== screen) screenPath.push(screen);
      chain = chain.then(async () => {
        await sleep(500); // settle: let the frame finish drawing
        fs.appendFileSync(CTRL, store.currentScreen + '\n');
        await sleep(300); // let the capturer capture before the screen moves on
      });
      return chain;
    };
    // Log every ask batch and task notice as it opens. The store fires on every
    // commit, so an overlay that opens and closes between two driver-loop turns
    // is still recorded.
    const unsub = store.subscribe(() => {
      recorder.observe(store.session);
      void snap();
    });

    let stop = false;
    const driverLoop = async () => {
      while (!stop && !store.session.skillsComplete) {
        await snap(); // capture this screen as presented, before acting
        recorder.observe(store.session);
        const state = driver.readState();
        const before = state.currentScreen;
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
          // Only the decision knows how it resolved an ask or a notice; the
          // report is ids and a verdict, never an answer value.
          if (decision.report) recorder.applyReport(decision.report);
          if (decision.done) stop = true;
        } catch (e) {
          mark(`action error on ${before}: ${(e as Error).message}`);
        }
        if (acted && store.currentScreen !== before) continue;
        if (!stop) await driver.waitForChange(600_000);
      }
    };
    const drive = driverLoop();

    await store.runReadyHooks();
    await runIntegration();
    const deadline = Date.now() + 120_000;
    while (!store.session.skillsComplete && Date.now() < deadline)
      await driver.waitForChange(5_000);
    // The run reached skillsComplete, so the driver loop is done — but it may be
    // parked in waitForChange, so don't block on it; the process exit ends it.
    stop = true;
    void drive;
    unsub();
    await snap(); // the final screen
    await chain; // flush any pending snapshots

    writeResult();
    process.exit(0);

    // Structured result the --e2e assertion path reads: run phase, posthog deps,
    // env file, the screens walked, and the agent-in-the-loop record (asks,
    // notices, tasks, detected sources, report file, abort reason).
    //
    // Registered on `exit` as well as called on the happy path: `wizardAbort`
    // renders the error outro and then exits the process, so an aborted run
    // would otherwise write nothing at all — and "why did it abort" is exactly
    // what the workbench needs in that case.
    function writeResult() {
      if (!process.env.E2E_RESULT_JSON || resultWritten) return;
      resultWritten = true;
      const appDir = process.env.APP_DIR!;
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
      fs.writeFileSync(
        process.env.E2E_RESULT_JSON,
        JSON.stringify(
          buildE2eResult({
            base: {
              runPhase: store.session.runPhase,
              hasPosthogDep: posthogDeps.length > 0,
              newDeps: posthogDeps,
              envFile,
              screenPath,
              skillsComplete: store.session.skillsComplete,
            },
            recorder,
            session: store.session,
            tasks: store.tasks,
            reportFile: readReportFile(appDir, programConfig.reportFile),
          }),
          null,
          2,
        ),
      );
    }
  }
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

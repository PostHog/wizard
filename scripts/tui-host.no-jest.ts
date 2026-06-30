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
import { buildSession } from '@lib/wizard-session';
import { runAgent } from '@lib/agent/agent-runner';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { logToFile } from '@utils/debug';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';
import {
  decideE2eAction,
  type WizardE2eProfile,
} from '@e2e-harness/e2e-profile';
import { profileFor } from '@e2e-harness/profiles';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mark = (m: string) => logToFile(`[tui-host] ${m}`);

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

  const { store } = startTUI(VERSION, programId);
  store.session = buildSession({
    installDir: process.env.APP_DIR!,
    ci: true,
    apiKey,
    projectId,
    region: 'us',
  });
  // Optional skip-ahead: pre-resolve the self-driving integration check so its
  // screen never shows (INTEGRATE=true integrates first; false = already set up).
  if (process.env.INTEGRATE === 'true' || process.env.INTEGRATE === 'false') {
    store.setIntegrate(process.env.INTEGRATE === 'true');
  }
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

  // Pass the pre-run gates and run the program's real agent. The auth and run
  // screens never advance on their own; this is what moves them. Mirrors
  // run-wizard's flow, including in-program run phases.
  const runProgram = async () => {
    await store.getGate('intro');
    await store.getGate('integration-check');
    await store.getGate('health-check');

    // Mirror run-wizard's composed walk for programs whose steps splice in
    // their own run steps (self-driving: detect → integrate → handoff → run).
    // `authenticate` here resolves the phx key, not OAuth, since the session is
    // built with ci + apiKey.
    if (programConfig.steps.some((s) => s.run)) {
      for (const step of programConfig.steps) {
        if (step.screenId === 'outro') break;
        if (step.show && !step.show(store.session)) continue;
        if (step.screenId === 'auth') {
          await authenticate(store.session, programConfig.id);
        } else if (step.run) {
          const live = store.session;
          const runSession = step.targetDir
            ? {
                ...live,
                installDir: step.targetDir(live),
                frameworkContext: { ...live.frameworkContext },
              }
            : live;
          if (step.onRunPrep) await step.onRunPrep(runSession);
          await step.run(runSession);
          store.completeRunStep(step.id);
        } else if (step.screenId === 'run') {
          await runAgent(programConfig, store.session);
        } else if (step.isComplete) {
          await store.waitUntil(step.isComplete);
        }
      }
    } else {
      await runAgent(programConfig, store.session);
    }
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
                await runProgram();
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
    const profile: WizardE2eProfile = profileFor(programId);
    const screenPath: string[] = [];
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
        // Snap on within-screen state too: when a screen publishes new
        // framework-context (e.g. the detector's projects), so the picker frame
        // is captured, not just the loading state. Generic — keys, not values.
        ctx: Object.keys(store.session.frameworkContext).sort().join(','),
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
    const unsub = store.subscribe(() => void snap());

    let stop = false;
    const driverLoop = async () => {
      while (!stop && !store.session.skillsComplete) {
        await snap(); // capture this screen as presented, before acting
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
          if (decision.done) stop = true;
        } catch (e) {
          mark(`action error on ${before}: ${(e as Error).message}`);
        }
        if (acted && store.currentScreen !== before) continue;
        if (!stop) await driver.waitForChange(600_000);
      }
    };
    const drive = driverLoop();

    // Write the structured result the --e2e assertion path reads. Programs whose
    // outro is terminal (self-driving) exit via the outro's ExitScreen before
    // the end-of-run path below, so capture it the moment the outro is reached;
    // integration re-writes it after keep-skills (skillsComplete).
    const writeResult = (): void => {
      if (!process.env.E2E_RESULT_JSON) return;
      const appDir = process.env.APP_DIR!;
      let deps: string[] = [];
      try {
        const pkg = JSON.parse(
          fs.readFileSync(`${appDir}/package.json`, 'utf8'),
        );
        deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      } catch {
        /* some frameworks have no package.json */
      }
      const posthogDeps = deps.filter((d) => d.includes('posthog'));
      let envFile: string | null = null;
      try {
        const hit = fs
          .readdirSync(appDir)
          .find(
            (f) =>
              f.startsWith('.env') &&
              /posthog/i.test(fs.readFileSync(`${appDir}/${f}`, 'utf8')),
          );
        envFile = hit ? `${appDir}/${hit}` : null;
      } catch {
        /* none */
      }
      fs.writeFileSync(
        process.env.E2E_RESULT_JSON,
        JSON.stringify(
          {
            runPhase: store.session.runPhase,
            hasPosthogDep: posthogDeps.length > 0,
            newDeps: posthogDeps,
            envFile,
            screenPath,
            skillsComplete: store.session.skillsComplete,
          },
          null,
          2,
        ),
      );
    };
    const unsubResult = store.subscribe(() => {
      if (store.currentScreen === 'outro') writeResult();
    });

    await store.runReadyHooks();
    await runProgram();
    const deadline = Date.now() + 120_000;
    while (!store.session.skillsComplete && Date.now() < deadline)
      await driver.waitForChange(5_000);
    // The run reached skillsComplete, so the driver loop is done — but it may be
    // parked in waitForChange, so don't block on it; the process exit ends it.
    stop = true;
    void drive;
    unsub();
    unsubResult();
    await snap(); // the final screen
    await chain; // flush any pending snapshots
    writeResult(); // final write (integration: after keep-skills)
    process.exit(0);
  }
}

main().catch((e) => {
  mark('FATAL ' + (e?.stack ?? e));
  process.exit(1);
});

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
import { Program } from '@lib/programs/program-registry';
import { buildSession } from '@lib/wizard-session';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { runAgent } from '@lib/agent/agent-runner';
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

  const { store } = startTUI(VERSION, Program.PostHogIntegration);
  store.session = buildSession({
    installDir: process.env.APP_DIR!,
    ci: true,
    apiKey,
    projectId,
    region: 'us',
  });
  const driver = new WizardCiDriver(store);

  // Resolve credentials from the phx key (same bearer as an OAuth token) and set
  // them on the store — advances the auth screen with no browser, no keystrokes.
  const authByState = async () => {
    const d = await getOrAskForProjectData({
      signup: false,
      ci: true,
      apiKey,
      projectId,
      programId: Program.PostHogIntegration,
    });
    store.setCredentials({
      accessToken: d.accessToken,
      projectApiKey: d.projectApiKey,
      host: d.host,
      projectId: d.projectId,
    });
  };

  if (process.env.MODE === 'serve') return serve();
  return fixed();

  // ---- agent route: drive commands over a unix socket ----
  function serve() {
    let runStatus: 'idle' | 'running' | 'done' | 'failed' = 'idle';
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
              state: { ...driver.readState(), integration: runStatus },
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
                await store.getGate('intro');
                await store.getGate('health-check');
                await runAgent(posthogIntegrationConfig, store.session);
                runStatus = 'done';
              } catch (e) {
                runStatus = 'failed';
                mark('run_agent error ' + (e as Error).message);
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
    const runFull = process.env.RUN_AGENT === '1';
    const profile: WizardE2eProfile = profileFor(Program.PostHogIntegration);
    const screenPath: string[] = [];
    let lastSnap = '';
    const snap = async () => {
      const s = store.currentScreen;
      if (s === lastSnap) return;
      lastSnap = s;
      screenPath.push(s);
      await sleep(650);
      fs.appendFileSync(CTRL, s + '\n');
      await sleep(400);
    };
    let stop = false;
    const driverLoop = async () => {
      while (!stop && !store.session.skillsComplete) {
        await snap();
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

    await store.runReadyHooks();
    await store.getGate('intro');
    await store.getGate('health-check');

    if (runFull) {
      await runAgent(posthogIntegrationConfig, store.session);
      const deadline = Date.now() + 120_000;
      while (!store.session.skillsComplete && Date.now() < deadline)
        await driver.waitForChange(5_000);
    } else {
      await authByState();
      await sleep(2500);
      await snap(); // the run screen
    }
    stop = true;
    await drive;
    await sleep(400);

    // Structured result for the --e2e assertion path (same shape e2e-full-run had).
    if (process.env.E2E_RESULT_JSON) {
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
    }
    process.exit(0);
  }
}

main().catch((e) => {
  mark('FATAL ' + (e?.stack ?? e));
  process.exit(1);
});

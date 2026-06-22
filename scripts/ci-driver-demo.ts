/**
 * Headless control-plane demo — runs the real wizard store/router/detection
 * flow with NO terminal and NO browser, driven entirely by WizardCiDriver.
 *
 * This is the runnable (tsx) sibling of the jest control-plane test: it proves
 * the same loop works outside a test harness, against real framework detection
 * on a 1-file project. The agent + auth steps are injected (the agent is a
 * separate, token-burning concern proven elsewhere) so this stays fast and
 * offline; every human decision goes through the driver's read/act surface.
 *
 *   POSTHOG_WIZARD_INSTALL_DIR=<dir> tsx scripts/ci-driver-demo.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, RunPhase } from '@lib/wizard-session';
import { Program } from '@lib/programs/program-registry';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { ScreenId, Overlay, type ScreenName } from '@ui/tui/router';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';

function makeOneFileProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-'));
  // The one file: a package.json declaring Next.js. Framework detection keys
  // off this, so the integration program resolves to the Next.js flow.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: 'demo', private: true, dependencies: { next: '15.3.0' } },
      null,
      2,
    ),
  );
  return dir;
}

const log = (msg: string) => process.stdout.write(`  ${msg}\n`);

async function main() {
  const installDir =
    process.env.POSTHOG_WIZARD_INSTALL_DIR ?? makeOneFileProject();
  process.stdout.write(`\nHeadless wizard-ci-tools demo on: ${installDir}\n\n`);

  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store)); // real UI, never rendered → no Ink, no browser
  const session = buildSession({ installDir, ci: true });
  store.session = session;

  const driver = new WizardCiDriver(store);

  // Run the program's onReady hooks — this is REAL framework detection.
  await store.runReadyHooks();

  const seen: ScreenName[] = [];
  const note = (s = driver.readState()) => {
    if (seen[seen.length - 1] !== s.currentScreen) {
      seen.push(s.currentScreen);
      log(`screen → ${s.currentScreen}`);
    }
    return s;
  };

  note();
  log(`detected framework: ${store.session.integration ?? '(none)'}`);

  // Walk the flow. Each branch commits exactly what a user would, via the
  // driver, and reads the resulting screen back.
  for (let i = 0; i < 30; i++) {
    const state = note();
    const screen = state.currentScreen;

    if (screen === ScreenId.Intro) {
      driver.performAction('confirm_setup');
    } else if (screen === ScreenId.HealthCheck) {
      // Simulate the readiness probe coming back clean (offline-safe).
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
    } else if (screen === ScreenId.Setup) {
      const q = state.setupQuestions[0];
      log(`answering setup "${q.key}" → ${q.options[0].value}`);
      driver.performAction('choose', { key: q.key, value: q.options[0].value });
    } else if (screen === ScreenId.Auth) {
      // Inject credentials (the scoped phx key can't fetch project data; the
      // gateway-bearer path is proven separately). accessToken would be the
      // phx key in a real run.
      store.setCredentials({
        accessToken: 'phx_injected_for_demo',
        projectApiKey: 'phc_demo',
        host: 'https://us.posthog.com',
        projectId: 1,
      });
    } else if (screen === ScreenId.Run) {
      // Simulate the agent run completing (real agent proven via the gateway).
      store.setRunPhase(RunPhase.Running);
      store.setRunPhase(RunPhase.Completed);
    } else if (screen === ScreenId.Outro) {
      driver.performAction('dismiss_outro');
    } else if (screen === ScreenId.Mcp) {
      driver.performAction('set_mcp_outcome', { outcome: 'skipped' });
    } else if (screen === ScreenId.McpSuggestedPrompts) {
      driver.performAction('dismiss');
    } else if (screen === ScreenId.SlackConnect) {
      driver.performAction('dismiss_slack');
    } else if (screen === ScreenId.KeepSkills) {
      driver.performAction('keep_skills', { kept: true });
      break; // terminal: skillsComplete is the run's done-signal
    } else if (screen === Overlay.WizardAsk) {
      // Not used by the integration program, but handle it generically.
      const q = state.pendingQuestion!.questions[0];
      driver.performAction('answer_question', {
        answers: { [q.id]: q.options?.[0]?.value ?? 'ok' },
      });
    } else {
      log(`no driver branch for "${screen}" — stopping`);
      break;
    }
  }

  const done = store.session.skillsComplete;
  process.stdout.write(
    `\n${done ? '✓' : '✗'} skillsComplete=${done}  path: ${seen.join(
      ' → ',
    )}\n\n`,
  );
  process.exit(done ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\nDEMO_FAIL: ${e?.stack ?? e}\n`);
  process.exit(1);
});

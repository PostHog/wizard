/**
 * Produce a sample recording offline (no agent, no network) so you can try the
 * replayer. Walks the integration flow with the e2e profile, injecting the
 * external transitions a real run gets (health probe, auth, agent runPhase) and
 * some agent status/tasks, while a WizardRecorder captures each key moment.
 *
 *   tsx scripts/record-demo.no-jest.ts            # writes /tmp/wizard-demo.recording.json
 *   tsx scripts/replay-e2e.no-jest.ts /tmp/wizard-demo.recording.json --step
 */
import { writeFileSync } from 'fs';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, RunPhase } from '@lib/wizard-session';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { Program } from '@lib/programs/program-registry';
import { ScreenId } from '@ui/tui/router';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';
import { decideE2eAction } from '@e2e-harness/e2e-profile';
import { profileFor } from '@e2e-harness/profiles';
import { WizardRecorder } from '@e2e-harness/recorder';

const out = process.env.RECORDING_OUT ?? '/tmp/wizard-demo.recording.json';

const store = new WizardStore(Program.PostHogIntegration);
setUI(new InkUI(store));
const session = buildSession({ installDir: '/tmp/demo-app', ci: true });
session.integration = Integration.nextjs;
session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
store.session = session;

let clock = 0;
const rec = new WizardRecorder(
  store,
  { program: 'posthog-integration', app: 'demo-nextjs' },
  () => (clock += 600),
);
rec.start();

const driver = new WizardCiDriver(store);
const profile = profileFor(Program.PostHogIntegration);

for (let i = 0; i < 40; i++) {
  const state = driver.readState();
  const d = decideE2eAction(state, profile);
  if (d.action) driver.performAction(d.action.id, d.action.params ?? {});

  if (state.currentScreen === ScreenId.HealthCheck) {
    store.setReadinessResult({
      decision: WizardReadiness.Yes,
      health: {} as never,
      reasons: [],
    });
  } else if (state.currentScreen === ScreenId.Auth) {
    store.setCredentials({
      accessToken: 'phx_secret',
      projectApiKey: 'phc_demo',
      host: 'https://us.posthog.com',
      projectId: 1,
    });
  } else if (state.currentScreen === ScreenId.Run) {
    store.pushStatus('Installing posthog-js…');
    store.setTasks([
      { label: 'Install SDK', status: 'completed' as never, done: true },
    ]);
    store.pushStatus('Wiring instrumentation-client.ts…');
    store.setRunPhase(RunPhase.Completed);
  }
  if (d.done || store.session.skillsComplete) break;
}
rec.stop();
writeFileSync(out, JSON.stringify(rec.getRecording(), null, 2));
process.stdout.write(`recorded ${rec.frameCount} frames → ${out}\n`);
process.stdout.write(
  `replay:  npx tsx scripts/replay-e2e.no-jest.ts ${out} --step\n`,
);

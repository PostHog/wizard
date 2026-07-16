import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventPlanWatcher,
  normalizeEventPlan,
} from '@lib/task-stream/event-plan-watcher';
import { EVENT_PLAN_FILE } from '@lib/programs/posthog-integration/constants';
import type { PlannedEvent, WizardStore } from '@ui/tui/store';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createStore(installDir: string) {
  let eventPlan: PlannedEvent[] = [];
  return {
    session: { installDir },
    get eventPlan() {
      return eventPlan;
    },
    setEventPlan(events: PlannedEvent[]) {
      eventPlan = events;
    },
  } as WizardStore;
}

describe('EventPlanWatcher', () => {
  let installDir: string;
  let watcher: EventPlanWatcher | undefined;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'wizard-event-plan-'));
  });

  afterEach(() => {
    watcher?.stop();
    watcher = undefined;
    rmSync(installDir, { recursive: true, force: true });
  });

  it('normalizes canonical fields and legacy fallbacks', () => {
    expect(
      normalizeEventPlan([
        { event_name: 'signed_up', event_description: 'User signs up' },
        { name: 'invited_user', description: 'User sends an invite' },
        { event: 'created_team' },
        { description: 'missing name' },
      ]),
    ).toEqual([
      { name: 'signed_up', description: 'User signs up' },
      { name: 'invited_user', description: 'User sends an invite' },
      { name: 'created_team', description: '' },
    ]);
  });

  it('captures the plan when the file is written after startup', async () => {
    const store = createStore(installDir);
    watcher = new EventPlanWatcher(store, {
      pollIntervalMs: 30,
      attachRetryIntervalMs: 20,
    });
    watcher.start();

    writeFileSync(
      join(installDir, EVENT_PLAN_FILE),
      JSON.stringify([{ event_name: 'completed_onboarding' }]),
    );
    await wait(120);

    expect(store.eventPlan).toEqual([
      { name: 'completed_onboarding', description: '' },
    ]);
  });

  it('keeps the last captured plan after the file is deleted', async () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    writeFileSync(path, JSON.stringify([{ event_name: 'created_report' }]));
    const store = createStore(installDir);
    watcher = new EventPlanWatcher(store, { pollIntervalMs: 30 });
    watcher.start();
    await wait(40);

    unlinkSync(path);
    await wait(80);

    expect(store.eventPlan).toEqual([
      { name: 'created_report', description: '' },
    ]);
  });
});

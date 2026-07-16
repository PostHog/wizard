import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
        { event_name: 42, name: 'valid_fallback' },
        { event_name: 'x'.repeat(401) },
        { event_name: '   ' },
        { description: 'missing name' },
      ]),
    ).toEqual([
      { name: 'signed_up', description: 'User signs up' },
      { name: 'invited_user', description: 'User sends an invite' },
      { name: 'created_team', description: '' },
      { name: 'valid_fallback', description: '' },
    ]);
  });

  it('caps event count and description length', () => {
    const events = Array.from({ length: 60 }, (_, index) => ({
      event_name: `event_${index}`,
      event_description: 'x'.repeat(5000),
    }));

    const normalized = normalizeEventPlan(events);

    expect(normalized).toHaveLength(50);
    expect(normalized?.[0].description).toHaveLength(4000);
  });

  it('captures the plan when the file is written after startup', async () => {
    const store = createStore(installDir);
    const path = join(installDir, EVENT_PLAN_FILE);
    watcher = new EventPlanWatcher(store, path, {
      pollIntervalMs: 30,
    });
    watcher.start();

    writeFileSync(
      path,
      JSON.stringify([{ event_name: 'completed_onboarding' }]),
    );
    await wait(120);

    expect(store.eventPlan).toEqual([
      { name: 'completed_onboarding', description: '' },
    ]);
  });

  it('captures the first non-empty plan once', async () => {
    const store = createStore(installDir);
    const path = join(installDir, EVENT_PLAN_FILE);
    watcher = new EventPlanWatcher(store, path, {
      pollIntervalMs: 30,
    });
    watcher.start();

    writeFileSync(path, JSON.stringify([]));
    await wait(40);
    expect(store.eventPlan).toEqual([]);

    writeFileSync(path, JSON.stringify([{ event_name: 'first_event' }]));
    await wait(40);
    writeFileSync(path, JSON.stringify([{ event_name: 'later_event' }]));
    watcher.refresh();

    expect(store.eventPlan).toEqual([{ name: 'first_event', description: '' }]);
  });

  it('keeps the last captured plan after the file is deleted', async () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    const store = createStore(installDir);
    watcher = new EventPlanWatcher(store, path, {
      pollIntervalMs: 30,
    });
    watcher.start();
    writeFileSync(path, JSON.stringify([{ event_name: 'created_report' }]));
    await wait(40);

    unlinkSync(path);
    await wait(80);

    expect(store.eventPlan).toEqual([
      { name: 'created_report', description: '' },
    ]);
  });

  it('ignores a plan file that predates the current run', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    writeFileSync(path, JSON.stringify([{ event_name: 'stale_event' }]));
    const store = createStore(installDir);
    watcher = new EventPlanWatcher(store, path);

    watcher.start();
    watcher.refresh();

    expect(store.eventPlan).toEqual([]);
  });

  it('rejects oversized and symbolic-link plan files', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    const store = createStore(installDir);
    watcher = new EventPlanWatcher(store, path);
    watcher.start();

    writeFileSync(path, JSON.stringify([{ event_name: 'x'.repeat(300_000) }]));
    watcher.refresh();
    expect(store.eventPlan).toEqual([]);

    unlinkSync(path);
    const target = join(installDir, 'external-plan.json');
    writeFileSync(target, JSON.stringify([{ event_name: 'linked_event' }]));
    symlinkSync(target, path);
    watcher.refresh();
    expect(store.eventPlan).toEqual([]);
  });
});

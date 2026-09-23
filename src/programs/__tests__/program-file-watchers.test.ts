import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProgramStore } from '../program-store';
import { watchAuditLedger } from '../audit/watch-ledger';
import {
  ProgramEventPlanWatcher,
  normalizeEventPlan,
  type PlannedEvent,
} from '../posthog-integration/watch-event-plan';
import { AUDIT_CHECKS_FILE } from '@shared/audit-ledger';
import { EVENT_PLAN_FILE } from '@shared/constants';

describe('program-owned file watchers', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'wizard-program-watchers-'));
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  it('ignores an old audit ledger, then projects this run’s update into ProgramStore until stopped', () => {
    const path = join(installDir, AUDIT_CHECKS_FILE);
    const stale = [
      { id: 'old', area: 'Events', label: 'old', status: 'pending' },
    ];
    const fresh = [{ id: 'new', area: 'Events', label: 'new', status: 'pass' }];
    writeFileSync(path, JSON.stringify(stale));
    const store = new ProgramStore();
    const handle = watchAuditLedger(installDir, AUDIT_CHECKS_FILE, (checks) =>
      store.setFrameworkContext('auditChecks', checks),
    );
    try {
      handle.refresh();
      expect(
        store.readData().detection.frameworkContext.auditChecks,
      ).toBeUndefined();

      writeFileSync(path, JSON.stringify(fresh));
      handle.refresh();
      expect(store.readData().detection.frameworkContext.auditChecks).toEqual(
        fresh,
      );

      handle.stop();
      writeFileSync(path, JSON.stringify([{ ...fresh[0], id: 'later' }]));
      handle.refresh();
      expect(store.readData().detection.frameworkContext.auditChecks).toEqual(
        fresh,
      );
    } finally {
      handle.stop();
    }
  });

  it('keeps the first non-empty event plan in ProgramStore across refresh and stop', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    writeFileSync(path, JSON.stringify([{ event_name: 'stale_event' }]));
    const store = new ProgramStore();
    const watcher = new ProgramEventPlanWatcher(path, (events) =>
      store.setFrameworkContext('eventPlan', events),
    );
    try {
      watcher.start();
      watcher.refresh();
      expect(
        store.readData().detection.frameworkContext.eventPlan,
      ).toBeUndefined();

      writeFileSync(path, JSON.stringify([]));
      watcher.refresh();
      expect(
        store.readData().detection.frameworkContext.eventPlan,
      ).toBeUndefined();

      writeFileSync(path, JSON.stringify([{ event_name: 'first_event' }]));
      watcher.refresh();
      expect(store.readData().detection.frameworkContext.eventPlan).toEqual([
        { name: 'first_event', description: '' },
      ]);

      writeFileSync(path, JSON.stringify([{ event_name: 'later_event' }]));
      watcher.refresh();
      expect(store.readData().detection.frameworkContext.eventPlan).toEqual([
        { name: 'first_event', description: '' },
      ]);
    } finally {
      watcher.stop();
    }
  });

  it('releases an event-plan watcher even when its consumer throws', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    const onEvents = vi.fn(() => {
      throw new Error('store unavailable');
    });
    const watcher = new ProgramEventPlanWatcher(path, onEvents);
    const stop = vi.spyOn(watcher, 'stop');
    try {
      watcher.start();
      writeFileSync(path, JSON.stringify([{ event_name: 'first_event' }]));
      watcher.refresh();

      expect(onEvents).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      watcher.stop();
    }
  });

  it('keeps a captured event plan after the file is deleted', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    let captured: PlannedEvent[] = [];
    const watcher = new ProgramEventPlanWatcher(path, (events) => {
      captured = events;
    });
    try {
      watcher.start();
      writeFileSync(path, JSON.stringify([{ event_name: 'created_report' }]));
      watcher.refresh();
      unlinkSync(path);
      watcher.refresh();

      expect(captured).toEqual([{ name: 'created_report', description: '' }]);
    } finally {
      watcher.stop();
    }
  });

  it('rejects oversized and symbolic-link event plan files', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    const onEvents = vi.fn();
    const watcher = new ProgramEventPlanWatcher(path, onEvents);
    try {
      watcher.start();
      writeFileSync(
        path,
        JSON.stringify([{ event_name: 'x'.repeat(300_000) }]),
      );
      watcher.refresh();

      unlinkSync(path);
      const target = join(installDir, 'external-plan.json');
      writeFileSync(target, JSON.stringify([{ event_name: 'linked_event' }]));
      symlinkSync(target, path);
      watcher.refresh();

      expect(onEvents).not.toHaveBeenCalled();
    } finally {
      watcher.stop();
    }
  });
});

describe('normalizeEventPlan', () => {
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
});

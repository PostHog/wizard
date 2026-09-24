import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchAuditLedger } from '../audit/watch-ledger';
import {
  ProgramEventPlanWatcher,
  normalizeEventPlan,
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

  it('ignores an old audit ledger, then reports this run’s update until stopped', () => {
    const path = join(installDir, AUDIT_CHECKS_FILE);
    const fresh = [{ id: 'new', area: 'Events', label: 'new', status: 'pass' }];
    writeFileSync(path, JSON.stringify([{ ...fresh[0], status: 'pending' }]));
    const onChecks = vi.fn();
    const handle = watchAuditLedger(installDir, AUDIT_CHECKS_FILE, onChecks);
    try {
      handle.refresh();
      writeFileSync(path, JSON.stringify(fresh));
      handle.refresh();
      handle.stop();
      writeFileSync(path, JSON.stringify([{ ...fresh[0], id: 'later' }]));
      handle.refresh();

      expect(onChecks.mock.calls).toEqual([[fresh]]);
    } finally {
      handle.stop();
    }
  });

  it('reports only the first non-empty event plan this run writes', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    writeFileSync(path, JSON.stringify([{ event_name: 'stale_event' }]));
    const onEvents = vi.fn();
    const watcher = new ProgramEventPlanWatcher(path, onEvents);
    try {
      watcher.start();
      watcher.refresh();
      for (const plan of [
        [],
        [{ event_name: 'first' }],
        [{ event_name: 'later_event' }],
      ]) {
        writeFileSync(path, JSON.stringify(plan));
        watcher.refresh();
      }

      expect(onEvents.mock.calls).toEqual([
        [[{ name: 'first', description: '' }]],
      ]);
    } finally {
      watcher.stop();
    }
  });

  it('releases an event-plan watcher even when its consumer throws', () => {
    const path = join(installDir, EVENT_PLAN_FILE);
    const watcher = new ProgramEventPlanWatcher(path, () => {
      throw new Error('store unavailable');
    });
    const stop = vi.spyOn(watcher, 'stop');
    watcher.start();
    writeFileSync(path, JSON.stringify([{ event_name: 'first_event' }]));
    watcher.refresh();

    expect(stop).toHaveBeenCalledOnce();
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

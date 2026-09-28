import { OutroKind } from '@lib/wizard-session';
import { createProgressCollector } from '../runner/shared/progress-collector';
import { MAX_STATUS_MESSAGES } from '@shared/status-history';

it('retains a bounded FIFO of statuses and drops consecutive duplicates', () => {
  const observer = vi.fn();
  const collector = createProgressCollector(observer);
  for (let i = 0; i < MAX_STATUS_MESSAGES + 3; i++) {
    collector.emit({ kind: 'status', message: `status ${i}` });
    collector.emit({ kind: 'status', message: `status ${i}` });
  }
  const statuses = collector.snapshot().statusMessages;
  expect(statuses).toHaveLength(MAX_STATUS_MESSAGES);
  expect(statuses[0]).toBe('status 3');
  expect(statuses.at(-1)).toBe(`status ${MAX_STATUS_MESSAGES + 2}`);
  expect(observer).toHaveBeenCalledTimes((MAX_STATUS_MESSAGES + 3) * 2);
  statuses.push('external mutation');
  expect(collector.snapshot().statusMessages).toHaveLength(MAX_STATUS_MESSAGES);
});

it('isolates nested completion data from a mutating observer', () => {
  const outro = {
    kind: OutroKind.Success,
    message: 'Done',
    nextSteps: { heading: 'Next', items: ['Keep the report'] },
  };
  const collector = createProgressCollector((event) => {
    if (event.kind === 'completion') {
      event.outro.message = 'corrupted';
      event.outro.nextSteps?.items.push('corrupted');
    }
  });
  collector.emit({ kind: 'completion', outro });
  expect(outro).toEqual({
    kind: OutroKind.Success,
    message: 'Done',
    nextSteps: { heading: 'Next', items: ['Keep the report'] },
  });
});

it('keeps the published handoff text in the snapshot', () => {
  const collector = createProgressCollector();
  expect(collector.snapshot().handoffText).toBeUndefined();
  collector.emit({ kind: 'handoff', text: '# Report' });
  collector.emit({ kind: 'handoff', text: '# Report, revised' });
  expect(collector.snapshot().handoffText).toBe('# Report, revised');
});

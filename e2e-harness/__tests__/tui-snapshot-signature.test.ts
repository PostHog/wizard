import { createUiReducer } from '@programs';
import { InkUI } from '@tui/state/ink-ui';
import { WizardStore } from '@tui/state/store';
import { AUDIT_CHECKS_KEY } from '@programs/audit/types';
import { tuiSnapshotSignature } from '../tui-snapshot-signature';

it('captures status-only host progress through the real TUI store', () => {
  const store = new WizardStore();
  const onChange = vi.fn();
  store.subscribe(onChange);
  const reduce = createUiReducer(new InkUI(store));
  const before = tuiSnapshotSignature(store);

  reduce({ kind: 'status', message: 'Inspecting the project' });
  const first = tuiSnapshotSignature(store);
  reduce({ kind: 'status', message: 'Installing the SDK' });
  const second = tuiSnapshotSignature(store);

  expect(store.statusMessages).toEqual([
    'Inspecting the project',
    'Installing the SDK',
  ]);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(first).not.toBe(before);
  expect(second).not.toBe(first);
});

it('captures changed audit checks under the same context key', () => {
  const store = new WizardStore();
  store.setFrameworkContext(AUDIT_CHECKS_KEY, [
    { id: 'first', area: 'Events', label: 'First', status: 'pending' },
  ]);
  const first = tuiSnapshotSignature(store);
  store.setFrameworkContext(AUDIT_CHECKS_KEY, [
    { id: 'first', area: 'Events', label: 'First', status: 'pass' },
  ]);
  expect(tuiSnapshotSignature(store)).not.toBe(first);
});

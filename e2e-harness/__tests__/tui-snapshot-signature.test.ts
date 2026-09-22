import { createUiReducer } from '@ui/agent-progress';
import { InkUI } from '@tui/ink-ui';
import { WizardStore } from '@tui/store';
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

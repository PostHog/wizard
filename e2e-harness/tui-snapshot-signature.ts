/**
 * The fixed-route snapshot signature. `scripts/tui-host.no-jest.ts` takes a
 * frame whenever this string changes: the screen, the overlay, the task list,
 * the status lines, the run phase or the framework context. `ctx` hashes the
 * context values, not only its keys, because audit ledger updates keep the
 * same key and still need a frame.
 */
import type { WizardStore } from '@ui/tui/store';

function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** State changes that should produce a new fixed-route TUI frame. */
export function tuiSnapshotSignature(store: WizardStore): string {
  return JSON.stringify({
    screen: store.currentScreen,
    overlay: store.router.hasOverlay,
    tasks: store.tasks.map((t) => [t.label, t.status, t.done]),
    status: store.statusMessages,
    phase: store.session.runPhase,
    // Include values: audit ledger updates keep the same context key.
    ctx: digest(JSON.stringify(store.session.frameworkContext)),
  });
}

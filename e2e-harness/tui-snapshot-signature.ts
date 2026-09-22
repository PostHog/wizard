import type { WizardStore } from '@tui/store';

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
    ctx: digest(JSON.stringify(store.session.frameworkContext)),
  });
}

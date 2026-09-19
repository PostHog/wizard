import { flowFor } from '../programs/flow-for.js';
import { Program, type ProgramId } from '../programs/program-registry.js';
import { buildSession } from '../session/wizard-session.js';
import { FlowStore } from '../state/store.js';
import { setUI } from '../ui/index.js';
import { StoreUI } from '../ui/store-ui.js';

/** A real store on a real program flow; tests fake nothing below it. */
export function createTestStore(
  programId: ProgramId = Program.PostHogIntegration,
): FlowStore {
  return new FlowStore(flowFor(programId).flow);
}

/** A store behind `StoreUI` with a non-interactive session: what a controlled run drives. */
export function createControlledStore(
  programId: ProgramId = Program.PostHogIntegration,
  session: Partial<Parameters<typeof buildSession>[0]> = {},
): FlowStore {
  const store = createTestStore(programId);
  setUI(new StoreUI(store));
  store.session = buildSession({
    installDir: '/tmp/controlled-store',
    ci: true,
    ...session,
  });
  return store;
}

const SECRET_MARKERS = ['phx_', 'phc_', 'phs_', 'secret:', 'sk_live_'];

/** Fails when any known secret shape appears in text meant for a parent or a log. */
export function expectNoSecrets(text: string, extra: string[] = []): void {
  for (const marker of [...SECRET_MARKERS, ...extra]) {
    if (text.includes(marker)) {
      throw new Error(
        `secret marker "${marker}" leaked into: ${text.slice(0, 120)}`,
      );
    }
  }
}

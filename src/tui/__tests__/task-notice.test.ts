/**
 * The modal shown before an optional step runs. It is the user's only chance to
 * decline a step that will stop and ask them for credentials, so the copy has
 * to reach the screen and both answers have to come back.
 */
import type { TaskNotice } from '@store/session/wizard-session';

vi.mock('@store/shared/analytics', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
  },
  sessionProperties: vi.fn(() => ({})),
}));

import { FlowStore } from '@store/state/store';
import { Overlay } from '../router.js';
import { flowFor } from '@store/programs/flow-for';
import { Program } from '@store/programs/program-registry';

const NOTICE: TaskNotice = {
  title: 'Connect your data sources',
  body: [
    'We detected some warehouse sources we can connect to enrich your PostHog data. This runs at the end, once your code changes are done — we’ll prompt you then for the credentials, so you can leave the setup to run until it asks.',
    "You can select [Skip] if you'd like to do this later in PostHog.",
  ],
  items: ['Postgres', 'Stripe'],
  docsLabel: 'Learn more about warehouse sources',
  docsUrl: 'https://posthog.com/docs/data-warehouse/sources',
  prompt: 'Connect these during setup?',
  confirmLabel: 'Continue [Enter]',
  cancelLabel: 'Skip [Esc]',
};

describe('task notice', () => {
  it('resolves true when kept and false when skipped, closing the overlay', async () => {
    const store = new FlowStore(flowFor(Program.PostHogIntegration).flow);

    const kept = store.showTaskNotice(NOTICE);
    expect(store.currentScreen).toBe(Overlay.TaskNotice);
    store.resolveTaskNotice(true);
    await expect(kept).resolves.toBe(true);
    expect(store.session.taskNotice).toBeNull();
    expect(store.currentScreen).not.toBe(Overlay.TaskNotice);

    const skipped = store.showTaskNotice(NOTICE);
    store.resolveTaskNotice(false);
    await expect(skipped).resolves.toBe(false);
  });

  it('leaves no notice behind for the next step to inherit', () => {
    const store = new FlowStore(flowFor(Program.PostHogIntegration).flow);
    expect(store.session.taskNotice).toBeNull();
  });
});

/**
 * ScreenErrorBoundary — a crashed screen must release the run.
 *
 * The `wizard_ask` overlay is a screen, so a render throw can land while the
 * agent is parked on an ask. The boundary routes to the outro; if it leaves the
 * ask pending, the agent waits on a promise nobody resolves and every later ask
 * is rejected as a duplicate.
 */

import { vi } from 'vitest';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

import { WizardStore } from '@ui/tui/store';
import { handleScreenCrash } from '@ui/tui/primitives/ScreenErrorBoundary';
import { OutroKind, RunPhase } from '@lib/wizard-session';

const pending = {
  id: 'req-1',
  source: 'error-tracking-upload-source-maps',
  questions: [
    { id: 'api-key', prompt: 'Paste your key', kind: 'text' as const },
  ],
};

describe('handleScreenCrash', () => {
  it('releases an in-flight ask and routes to the outro', async () => {
    const store = new WizardStore();
    const answers = store.requestQuestion(pending);

    handleScreenCrash(store, new Error('boom'));

    await expect(answers).resolves.toEqual({ 'api-key': '__cancelled__' });
    expect(store.session.pendingQuestion).toBeNull();
    expect(store.session.runPhase).toBe(RunPhase.Error);
    expect(store.session.outroData?.kind).toBe(OutroKind.Error);
  });

  it('leaves the next ask free to open', () => {
    const store = new WizardStore();
    void store.requestQuestion(pending);

    handleScreenCrash(store, new Error('boom'));

    expect(() =>
      store.requestQuestion({ ...pending, id: 'req-2' }),
    ).not.toThrow();
  });
});

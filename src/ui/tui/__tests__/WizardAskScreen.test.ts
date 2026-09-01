/**
 * WizardAskScreen — Esc-to-skip wiring.
 *
 * The overlay's key handling routes through `handleAskKey`, extracted so the
 * decision can be tested without a live Ink render (the suite stubs `useInput`
 * to a no-op). Pressing Esc must decline the whole request so the task can fall
 * back gracefully — e.g. hand the user a browser setup link.
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
import {
  handleAskKey,
  isRequiredButEmpty,
} from '@ui/tui/screens/WizardAskScreen';

const pending = {
  id: 'req-1',
  source: 'postgres',
  questions: [
    { id: 'host', prompt: 'Database host?', kind: 'text' as const },
    { id: 'port', prompt: 'Port?', kind: 'text' as const },
  ],
};

describe('handleAskKey', () => {
  it('cancels the pending question on Esc', () => {
    const store = { cancelPendingQuestion: vi.fn() };
    handleAskKey({ escape: true }, store);
    expect(store.cancelPendingQuestion).toHaveBeenCalledTimes(1);
  });

  it('ignores every other key', () => {
    const store = { cancelPendingQuestion: vi.fn() };
    handleAskKey({ escape: false }, store);
    handleAskKey({}, store);
    expect(store.cancelPendingQuestion).not.toHaveBeenCalled();
  });

  it('declines the whole request end-to-end so the task can fall back', async () => {
    const store = new WizardStore();
    const answers = store.requestQuestion(pending);

    handleAskKey({ escape: true }, store);

    await expect(answers).resolves.toEqual({
      host: '__cancelled__',
      port: '__cancelled__',
    });
    expect(store.session.pendingQuestion).toBeNull();
  });
});

describe('isRequiredButEmpty', () => {
  it('blocks an empty required text field (required defaults to true)', () => {
    expect(isRequiredButEmpty({}, '')).toBe(true);
    expect(isRequiredButEmpty({}, '   ')).toBe(true);
    expect(isRequiredButEmpty({ required: true }, '')).toBe(true);
  });

  it('allows a non-empty answer', () => {
    expect(isRequiredButEmpty({}, 'db.example.com')).toBe(false);
    expect(isRequiredButEmpty({ required: true }, '5432')).toBe(false);
  });

  it('never blocks an optional field', () => {
    expect(isRequiredButEmpty({ required: false }, '')).toBe(false);
    expect(isRequiredButEmpty({ required: false }, [])).toBe(false);
  });

  it('treats an empty multi-select selection as unanswered when required', () => {
    expect(isRequiredButEmpty({}, [])).toBe(true);
    expect(isRequiredButEmpty({}, ['events'])).toBe(false);
  });
});

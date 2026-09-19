import { describe, expect, it } from 'vitest';
import { ScreenId } from '@tui/router';
import type { ControlState } from '@store/types';
import { DEFAULT_E2E_PROFILE, decideE2eAction } from '@e2e-harness/e2e-profile';

describe('a failed run', () => {
  it('exits from the handoff screen and ends the walk', () => {
    const state = {
      currentScreen: ScreenId.MintFailure,
      pendingQuestion: null,
      taskNotice: null,
      setupQuestions: [],
    } as unknown as ControlState;
    expect(decideE2eAction(state, DEFAULT_E2E_PROFILE)).toEqual({
      action: { id: 'dismiss_outro' },
      done: true,
    });
  });
});

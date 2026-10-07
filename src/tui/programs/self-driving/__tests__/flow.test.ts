import { describe, expect, it } from 'vitest';
import { buildSession } from '@programs';
import type { WizardSession } from '@programs/types';
import { initialTuiState, type TuiState } from '@tui/tui-state';
import { TUI_PROGRAMS } from '../index';

const selfDriving = TUI_PROGRAMS['self-driving'];
if (!selfDriving) throw new Error('self-driving declares its TUI program');

/** A step predicate's input: a fresh session and the TUI's defaults, both writable. */
const tuiView = (): TuiState & { session: WizardSession } => ({
  ...initialTuiState({}),
  session: buildSession({}),
});

describe('self-driving TUI program', () => {
  it('ships its own Learn deck', () => {
    const blocks = selfDriving.deck?.() ?? [];
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('has no keep-skills step — the setup skill is removed in postRun', () => {
    const stepIds = selfDriving.flow.map((s) => s.id);
    expect(stepIds).not.toContain('skills');
    expect(stepIds).toEqual([
      'intro',
      'integration-check',
      'health-check',
      'auth',
      'integrate-detect',
      'integrate-run',
      'self-driving-handoff',
      'self-driving-github',
      'run',
      'outro',
    ]);
  });
});

describe('integrate-detect step', () => {
  const step = selfDriving.flow.find((s) => s.id === 'integrate-detect');

  it('is complete once the user continues with an existing install', () => {
    // integrate=false must complete the step or the orchestrator hangs.
    const view = tuiView();
    view.integrate = false;
    view.session.integration = null;
    expect(step?.isComplete?.(view)).toBe(true);
  });
});

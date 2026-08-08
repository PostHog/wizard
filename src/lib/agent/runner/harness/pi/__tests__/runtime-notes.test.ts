import { Sequence } from '@lib/constants';
import { piRuntimeNotes } from '../runtime-notes';

describe('piRuntimeNotes', () => {
  it('advertises scoped project-file cleanup when bash is available', () => {
    const notes = piRuntimeNotes(Sequence.linear, {
      bash: true,
      posthogMcp: true,
    });

    expect(notes).toContain('rm [-f] <relative-file-inside-project>');
    expect(notes).toContain('.posthog-events.json');
  });

  it('explains that test and start scripts are intentionally unavailable', () => {
    const notes = piRuntimeNotes(Sequence.linear, {
      bash: true,
      posthogMcp: true,
    });

    expect(notes).toContain('`test` and `start` scripts');
    expect(notes).toContain('intentionally not allowed');
  });

  it('omits bash policy guidance when bash is not available', () => {
    const notes = piRuntimeNotes(Sequence.orchestrator, {
      bash: false,
      posthogMcp: true,
    });

    expect(notes).not.toContain('rm [-f] <relative-file-inside-project>');
    expect(notes).not.toContain('`test` and `start` scripts');
  });
});

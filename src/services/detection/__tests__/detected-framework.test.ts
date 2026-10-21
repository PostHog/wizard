import { analytics } from '@utils/analytics';
import type { FrameworkConfig } from '../../framework-config';
import type { ProgramSession } from '../../program-session';
import { noteDetectedFramework } from '../detected-framework';

vi.mock('@utils/analytics', () => ({ analytics: { setTag: vi.fn() } }));

const django = {
  metadata: {
    getDetectedFrameworkLabel: (context: Record<string, unknown>) =>
      context.wagtail ? 'Django with Wagtail CMS' : undefined,
  },
} as unknown as FrameworkConfig;

describe('noteDetectedFramework', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prints a variant label for a CI run and leaves its session alone', () => {
    const session = { ci: true, detectedFrameworkLabel: null };
    const log = { info: vi.fn() };
    noteDetectedFramework(
      session as unknown as ProgramSession,
      django,
      { wagtail: true },
      log,
    );
    expect(log.info).toHaveBeenCalledExactlyOnceWith(
      'Framework: Django with Wagtail CMS',
    );
    expect(session.detectedFrameworkLabel).toBeNull();
    expect(analytics.setTag).not.toHaveBeenCalled();
  });

  it("keeps a variant label on a TUI run's session and analytics tag", () => {
    const session = { ci: false, detectedFrameworkLabel: 'Django' };
    const log = { info: vi.fn() };
    noteDetectedFramework(
      session as unknown as ProgramSession,
      django,
      { wagtail: true },
      log,
    );
    expect(session.detectedFrameworkLabel).toBe('Django with Wagtail CMS');
    expect(analytics.setTag).toHaveBeenCalledWith(
      'detected_framework',
      'Django with Wagtail CMS',
    );
    expect(log.info).not.toHaveBeenCalled();
  });
});

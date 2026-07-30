import { getUI, setUI } from '@ui';
import type { WizardUI } from '@ui/wizard-ui';
import { MAX_HANDOFF_TEXT_CHARS, publishHandoff } from '../handoff';

describe('publishHandoff', () => {
  const captured: string[] = [];
  let previousUI: WizardUI;

  beforeEach(() => {
    captured.length = 0;
    previousUI = getUI();
    setUI({
      ...previousUI,
      setHandoffText: (text: string) => {
        captured.push(text);
      },
    } as WizardUI);
  });

  afterEach(() => {
    setUI(previousUI);
  });

  it('publishes the content through the UI seam', () => {
    const result = publishHandoff('# Setup report\n\nAll done.');
    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Setup report\n\nAll done.']);
  });

  it('rejects a missing or blank content instead of publishing', () => {
    for (const bad of [undefined, null, 42, '', '   \n']) {
      const result = publishHandoff(bad);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('complete report markdown');
    }
    expect(captured).toEqual([]);
  });

  it('truncates oversized content to the backend cap and says so', () => {
    const oversized = 'x'.repeat(MAX_HANDOFF_TEXT_CHARS + 10);
    const result = publishHandoff(oversized);
    expect(result.ok).toBe(true);
    expect(captured[0]).toHaveLength(MAX_HANDOFF_TEXT_CHARS);
    expect(result.message).toContain('truncated');
  });
});

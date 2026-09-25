import { readNeedsAttention } from '@utils/needs-attention';

const report = (block: string) =>
  `# Error tracking report\n\n${block}\n\n## What you still need to do\n\n1. Something\n`;

describe('readNeedsAttention', () => {
  it('returns each bullet of the warning block', () => {
    const markdown = report(
      [
        '> ⚠️ **Needs your attention**',
        '> - Load `.env` in the app, or set `POSTHOG_API_KEY` in its environment.',
        '> * Add the `POSTHOG_CLI_API_KEY` CI secret.',
      ].join('\n'),
    );
    expect(readNeedsAttention(markdown)).toEqual([
      'Load `.env` in the app, or set `POSTHOG_API_KEY` in its environment.',
      'Add the `POSTHOG_CLI_API_KEY` CI secret.',
    ]);
  });

  it('accepts the warning sign without its emoji variant selector', () => {
    const markdown = report('> ⚠ **Needs your attention**\n> - One thing');
    expect(readNeedsAttention(markdown)).toEqual(['One thing']);
  });

  it('ignores other quote blocks and reports without the block', () => {
    expect(readNeedsAttention(report('> - Just a quote'))).toEqual([]);
    expect(readNeedsAttention('# Report\n\nAll done.')).toEqual([]);
  });
});

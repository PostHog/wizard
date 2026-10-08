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

  it('strips terminal control characters from items', () => {
    const markdown = report(
      '> ⚠️ **Needs your attention**\n> - Do \x1b[31mthis\x1b]52;c;ZXZpbA==\x07 now\x9b2J',
    );
    expect(readNeedsAttention(markdown)).toEqual([
      'Do [31mthis]52;c;ZXZpbA== now2J',
    ]);
  });

  it('keeps the tail of a bullet wrapped onto the next quoted line', () => {
    const markdown = report(
      [
        '> ⚠️ **Needs your attention**',
        '> - Set `POSTHOG_API_KEY` in your deploy',
        '>   environment before the next release.',
        '> - Add the CI secret.',
        '>',
        '> A closing note, not part of any item.',
      ].join('\n'),
    );
    expect(readNeedsAttention(markdown)).toEqual([
      'Set `POSTHOG_API_KEY` in your deploy environment before the next release.',
      'Add the CI secret.',
    ]);
  });
});

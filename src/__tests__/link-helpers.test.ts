import {
  osc8Hyperlink,
  extractUrls,
  splitPromptIntoSegments,
} from '@ui/tui/primitives/link-helpers';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const LINEAR_URL =
  'http://localhost:8010/api/environments/1/integrations/authorize?kind=linear';

describe('osc8Hyperlink', () => {
  it('wraps the url in an OSC 8 escape, url as the default label', () => {
    expect(osc8Hyperlink(LINEAR_URL)).toBe(
      `${ESC}]8;;${LINEAR_URL}${BEL}${LINEAR_URL}${ESC}]8;;${BEL}`,
    );
  });

  it('supports a custom label', () => {
    expect(osc8Hyperlink('https://x.test', 'open')).toBe(
      `${ESC}]8;;https://x.test${BEL}open${ESC}]8;;${BEL}`,
    );
  });
});

describe('extractUrls', () => {
  it('finds a single url', () => {
    expect(extractUrls(`open ${LINEAR_URL} now`)).toEqual([LINEAR_URL]);
  });

  it('returns [] when there is no url', () => {
    expect(extractUrls('no links here')).toEqual([]);
  });

  it('finds multiple urls', () => {
    expect(extractUrls('a https://one.test and https://two.test')).toEqual([
      'https://one.test',
      'https://two.test',
    ]);
  });

  it('strips trailing sentence punctuation', () => {
    expect(extractUrls('see https://x.test.')).toEqual(['https://x.test']);
    expect(extractUrls('(https://x.test)')).toEqual(['https://x.test']);
  });
});

describe('splitPromptIntoSegments', () => {
  it('breaks a standalone url line into its own segment, preserving spacing', () => {
    const prompt = `One click connects Linear: open this link —\n\n${LINEAR_URL}\n\nThen come back here.`;
    expect(splitPromptIntoSegments(prompt)).toEqual([
      { type: 'text', value: 'One click connects Linear: open this link —\n' },
      { type: 'url', value: LINEAR_URL },
      { type: 'text', value: '\nThen come back here.' },
    ]);
  });

  it('returns a single text segment when there is no standalone url', () => {
    expect(splitPromptIntoSegments('just some prose')).toEqual([
      { type: 'text', value: 'just some prose' },
    ]);
  });

  it('breaks an inline url onto its own segment, keeping surrounding prose', () => {
    expect(splitPromptIntoSegments('visit https://x.test for details')).toEqual(
      [
        { type: 'text', value: 'visit' },
        { type: 'url', value: 'https://x.test' },
        { type: 'text', value: 'for details' },
      ],
    );
  });

  it('keeps trailing punctuation with the prose, not the url', () => {
    expect(
      splitPromptIntoSegments('open https://x.test. Then return.'),
    ).toEqual([
      { type: 'text', value: 'open' },
      { type: 'url', value: 'https://x.test' },
      { type: 'text', value: '. Then return.' },
    ]);
  });

  it('breaks out multiple inline urls on one line', () => {
    expect(
      splitPromptIntoSegments('a https://one.test b https://two.test c'),
    ).toEqual([
      { type: 'text', value: 'a' },
      { type: 'url', value: 'https://one.test' },
      { type: 'text', value: 'b' },
      { type: 'url', value: 'https://two.test' },
      { type: 'text', value: 'c' },
    ]);
  });

  it('handles a url-only prompt', () => {
    expect(splitPromptIntoSegments(LINEAR_URL)).toEqual([
      { type: 'url', value: LINEAR_URL },
    ]);
  });
});

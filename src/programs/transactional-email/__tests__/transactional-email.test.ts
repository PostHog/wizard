import { config } from '@programs/transactional-email';

const DOCS_URL = 'https://posthog.com/docs/workflows/transactional-emails';

function abortCases() {
  const run = config.run;
  if (!run || typeof run === 'function') {
    throw new Error('expected a static run object');
  }
  return run.abortCases ?? [];
}

describe('transactional-email abort cases', () => {
  it.each(['transactional email api not enabled', 'no server code found'])(
    'links the transactional email docs from the "%s" abort',
    (reason) => {
      const matched = abortCases().filter((c) => c.match.test(reason));

      expect(matched).toHaveLength(1);
      expect(matched[0].docsUrl).toBe(DOCS_URL);
    },
  );
});
